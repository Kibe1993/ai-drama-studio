# Persistent Conversational Memory — Architecture Audit Report

## Executive Summary

The assistant **does persist messages to MongoDB** and **does load full history** on each
request. However, there are **three critical defects** causing context loss, plus **no
context-window management** or **persistent memory** of any kind.

---

## 1. Why the Assistant Currently Forgets

### CRITICAL DEFECT 1: Tool results are NOT persisted as separate messages

**File:** `lib/services/conversationService.ts:194-203`

During the tool-use loop, `role: "assistant"` and `role: "tool"` messages are appended
to the in-memory `allMessages` array but **never written to MongoDB**. Only the final
assistant message (with tool calls embedded in its `toolCalls` array) is saved at
line 209-216.

When the conversation is resumed, `chatMessageRepository.listForConversation()` loads
messages from the DB. The `role: "tool"` messages are **missing** — they only existed
in memory during the original request. The provider therefore cannot see what tools
were called or what they returned in previous turns.

**Impact:** After any tool call, resuming the conversation loses all tool context.
The model doesn't know it already called `project.get` or what the result was.

### CRITICAL DEFECT 2: No context-window management

**File:** `lib/services/conversationService.ts:95-98`

```ts
const allMessages: ChatMessage[] = [
  { role: "user", content: SYSTEM_PROMPT },
  ...history,  // ← ALL messages, no limit
];
```

Every message from the conversation is passed to the provider. There is **no token
counting, no truncation, no budgeting**. Long conversations exceed the model's context
window, causing API errors or silent truncation by the provider.

**Impact:** Conversations with 50+ messages will fail on most models (4K-32K context
windows). No graceful degradation exists.

### CRITICAL DEFECT 3: System prompt injected as `user` role

**File:** `lib/services/conversationService.ts:96`

```ts
{ role: "user", content: SYSTEM_PROMPT }  // ← should be "system"
```

The system prompt is sent as a user message, not a system message. Some providers
(Gemini, Groq) may not give it proper system-level priority, and it consumes user-turn
space in the context window.

### DEFECT 4: Interrupted responses are lost

**File:** `lib/services/conversationService.ts:143-149, 209-216`

If the stream is interrupted (user cancels, network drops, provider error), the
`chatMessageRepository.create()` call for the assistant message is never reached.
The user message is saved (line 84) but the assistant's partial response is lost.
The conversation appears to have a user message with no response.

### DEFECT 5: No persistent memory or summarization

There is no:
- Conversation summarization
- Project-level memory
- Cross-conversation memory
- Context assembly service
- Token counting utility

---

## 2. Conversation History Persistence — Confirmed

### Are messages saved? ✅ YES
- User messages: `chatMessageRepository.create()` at line 84
- Assistant messages: `chatMessageRepository.create()` at line 143 or 209
- Tool calls: embedded in assistant message's `toolCalls` array

### Is history retrieved? ✅ YES
- `chatMessageRepository.listForConversation()` at line 66
- Sorted by `createdAt: 1` (chronological order)
- Uses `ownedQuery(clerkUserId)` for ownership

### Is history passed to the model? ⚠️ PARTIALLY
- All DB messages are loaded and passed
- BUT `role: "tool"` messages from previous turns are missing (Defect 1)
- AND no truncation is applied (Defect 2)

### Is context truncation occurring? ❌ NO
- No truncation, no token budget, no message limit

### Does provider switching preserve history? ✅ YES
- Messages are loaded regardless of which provider created them
- The `conversationId` stays the same across provider switches
- Message `provider` field is inaccurate after switching but doesn't affect history loading

### Does opening a conversation restore context? ⚠️ PARTIALLY
- All DB messages are loaded (line 66)
- But tool results from previous turns are missing (Defect 1)

---

## 3. Existing MongoDB Models and Services

### Reusable Models

| Model | File | Collection | Can Reuse |
|-------|------|------------|-----------|
| Conversation | `lib/models/conversation.ts` | `conversations` | ✅ Add `summary` field |
| ChatMessage | `lib/models/chatMessage.ts` | `chatMessages` | ✅ Add `role: "system"` to enum |

### Reusable Repositories

| Repository | File | Key Methods |
|------------|------|-------------|
| conversationRepository | `lib/repositories/conversationRepository.ts` | list, findOwned, create, update, touch, remove |
| chatMessageRepository | `lib/repositories/chatMessageRepository.ts` | listForConversation, create, removeForConversation |

### Reusable Services

| Service | File | Role |
|---------|------|------|
| conversationService | `lib/services/conversationService.ts` | Orchestration (needs fixes) |
| ChatAgentProvider | `lib/assistant/types.ts` | Provider interface |

### Existing Indexes
- `chatMessages`: `{ clerkUserId, conversationId, createdAt }` and `{ clerkUserId, conversationId, role }`
- `conversations`: implicit `{ clerkUserId }` via `ownedQuery`

---

## 4. Proposed Memory Architecture

### Layer 1: Fix Thread-Level Memory (Phase 1)

**Changes to `conversationService.ts`:**
1. Save `role: "tool"` messages to DB during the tool-use loop
2. Save assistant messages after each tool iteration (not just at the end)
3. Fix system prompt to use `role: "system"`
4. Add interrupted-response handling (save partial content on abort/error)

**Changes to `chatMessage.ts` model:**
1. Add `"system"` to the `role` enum
2. Add `"rejected"` to the `toolCalls.status` enum (already in types but not in model)

### Layer 2: Context-Window Management (Phase 1)

**New file: `lib/assistant/tokenEstimator.ts`**
- Lightweight token estimation (~4 chars per token)
- No external dependencies
- Function: `estimateTokens(messages: ChatMessage[]): number`

**Changes to `conversationService.ts`:**
1. Before calling the provider, estimate total tokens
2. If exceeding budget (model-specific, default 80% of context window):
   - Keep system prompt + last N messages
   - Replace older messages with a conversation summary (if available)
3. Reserve tokens for model response (default 25% of context window)

### Layer 3: Rolling Conversation Summaries (Phase 2)

**New field on Conversation model:**
```ts
summary: {
  text: String,
  updatedAt: Date,
  messageCountAtSummary: Number,  // how many messages were summarized
  tokenEstimate: Number,
}
```

**New file: `lib/services/summaryService.ts`**
- `generateSummary(messages, existingSummary, provider): Promise<string>`
- Uses the same chat provider to summarize
- Triggered when conversation exceeds 60% of context window
- Preserves: decisions, facts, rejected ideas, pending tasks, project references
- Summary is stored on the conversation document, not as a separate message

**Context assembly with summary:**
1. System prompt
2. Conversation summary (if exists, as system message)
3. Recent messages (after the summarized ones)
4. Current user message

### Layer 4: Persistent Project Memory (Phase 3)

**New model: `lib/models/projectMemory.ts`**
```ts
{
  clerkUserId: String,
  projectId: ObjectId,
  category: String,  // "identity" | "story" | "development" | "technical"
  key: String,       // e.g., "protagonist", "genre", "current_stage"
  value: String,
  source: String,    // "user_decision" | "assistant_proposal" | "mcp_result" | "canon"
  status: String,    // "confirmed" | "proposed" | "rejected" | "superseded"
  conversationId: ObjectId | null,
  messageIds: [ObjectId],  // references to source messages
  createdAt: Date,
  updatedAt: Date,
}
```

**New repository: `lib/repositories/projectMemoryRepository.ts`**
- CRUD with ownership + project scoping
- `listByProject(clerkUserId, projectId, category?)`
- `upsert(clerkUserId, projectId, key, value, source, status)`
- `reject(clerkUserId, projectId, key)` — mark as rejected, don't delete
- `supersede(clerkUserId, projectId, key, newValue)` — mark old as superseded, create new

**Key principle:** Project memory stores **references and decisions**, not copies of
the Story Bible or canon. The Story Bible and canon registry remain the source of truth.

### Layer 5: Semantic Retrieval (Phase 4)

**Recommendation: Use MongoDB text search first, not a vector database.**

MongoDB already supports:
- `$text` search on message content
- Regex search on specific fields
- Aggregation pipelines for complex queries

**New file: `lib/services/memoryRetrievalService.ts`**
- `searchHistory(clerkUserId, conversationId, query, limit)` — text search on messages
- `searchProjectMemory(clerkUserId, projectId, query, limit)` — text search on project memory
- `searchAcrossConversations(clerkUserId, projectId, query, limit)` — find related discussions

**Add text indexes:**
- `chatMessages`: `{ content: "text" }`
- `projectMemory`: `{ value: "text", key: "text" }`

**Only recommend a vector database if** text search proves insufficient for the
assistant's retrieval needs after testing with real conversations.

### Layer 6: Context Assembly Service (Phase 5)

**New file: `lib/services/contextAssemblyService.ts`**

```ts
function assembleContext(params: {
  clerkUserId: string;
  conversationId: string;
  projectId: string | null;
  provider: ChatAgentId;
  model: string;
  newMessage: string;
}): Promise<ChatMessage[]>
```

Assembly order:
1. System instructions (role: "system")
2. Project identity (if projectId) — from project memory + MCP `project.get`
3. Conversation summary (if exists) — as system message
4. Retrieved relevant memories — from project memory + text search
5. Recent conversation messages — from DB, token-budgeted
6. Current user message

Token budget:
- Reserve 25% for model response
- Reserve 10% for system + project context
- Remaining 65% for conversation history
- If history exceeds budget: summarize older portion, keep recent window

---

## 5. Proposed Data Schema Changes

### Conversation Model — Add Summary Field
```ts
summary: {
  text: { type: String, default: null },
  updatedAt: { type: Date, default: null },
  messageCountAtSummary: { type: Number, default: 0 },
  tokenEstimate: { type: Number, default: 0 },
}
```

### ChatMessage Model — Fix Enums
```ts
role: { type: String, enum: ["user", "assistant", "tool", "system"], required: true }
// toolCalls.status:
enum: ["pending", "success", "error", "awaiting_approval", "rejected"]
```

### New: ProjectMemory Model
```ts
{
  clerkUserId: { type: String, required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, required: true, index: true },
  category: { type: String, enum: ["identity", "story", "development", "technical"], required: true },
  key: { type: String, required: true },
  value: { type: String, required: true },
  source: { type: String, enum: ["user_decision", "assistant_proposal", "mcp_result", "canon", "correction"], required: true },
  status: { type: String, enum: ["confirmed", "proposed", "rejected", "superseded"], default: "proposed" },
  conversationId: { type: Schema.Types.ObjectId, default: null },
  messageIds: [{ type: Schema.Types.ObjectId }],
}
// Indexes:
// { clerkUserId: 1, projectId: 1, category: 1, key: 1 }
// { clerkUserId: 1, projectId: 1, status: 1 }
// { value: "text" }
```

---

## 6. Context Assembly Strategy

```
┌─────────────────────────────────────────────┐
│           Context Assembly Service           │
├─────────────────────────────────────────────┤
│  1. System instructions           (~500 tok) │
│  2. Project identity + memory     (~1000 tok)│
│  3. Conversation summary          (~500 tok) │
│  4. Retrieved relevant memories   (~500 tok) │
│  5. Recent messages (token-budgeted)         │
│  6. Current user message                     │
└─────────────────────────────────────────────┘
         │
         ▼
  Provider Adapter (Groq/Gemini/OpenAI/DeepSeek)
         │
         ▼
    Provider API
```

**Token budget allocation** (for a 32K context model):
- Model response reserve: 8K (25%)
- System + project context: 4K (12.5%)
- Conversation summary + memories: 2K (6.25%)
- Recent messages: 18K (56.25%)

**When budget exceeded:**
1. Summarize messages older than the recent window
2. Store summary on conversation document
3. Pass summary + recent window to provider
4. Full history remains in MongoDB

---

## 7. Summarization Strategy

**Trigger:** When `estimateTokens(allMessages) > 60% of model context window`

**Process:**
1. Identify messages to summarize (all but last N, where N keeps recent window under budget)
2. Send summarization prompt to the same provider:
   ```
   Summarize this conversation, preserving:
   - Project being discussed
   - Important facts and decisions
   - Accepted and rejected ideas
   - Pending tasks and approvals
   - Tool operations performed and their outcomes
   - Current task and remaining work
   ```
3. Store summary on conversation document
4. On next request, use summary + recent window instead of full history

**Summary update:** When new messages push past the threshold again, re-summarize
incorporating the previous summary + new messages.

---

## 8. Retrieval Strategy

**No vector database initially.** Use MongoDB's built-in capabilities:

1. **Text search:** `$text` index on `chatMessages.content` and `projectMemory.value`
2. **Recent messages:** Chronological query with limit
3. **Project memory:** Query by `clerkUserId + projectId + status: "confirmed"`
4. **Cross-conversation:** Text search across all conversations for same user + project

**Escalation path:** If text search relevance is insufficient:
1. Add MongoDB Atlas Search (if on Atlas)
2. Or add a lightweight embedding store (e.g., `mongodb` with `$vectorSearch`)
3. Vector database only if justified by actual retrieval quality issues

---

## 9. Provider Integration Requirements

All providers already implement `ChatAgentProvider.streamCompletion()` which accepts
`ChatMessage[]`. The context assembly service produces `ChatMessage[]`, so **no provider
adapter changes are needed** for basic context assembly.

For summarization, providers need to support a non-streaming completion call (or
collect the stream into a single string). The existing `streamCompletion` can be
consumed fully to get the summary text.

**No new provider interface methods needed.**

---

## 10. UI Changes

### Phase 1-2 (Minimal)
- No UI changes needed — fixes are backend-only
- The typing indicator and cancel button already exist

### Phase 7 (Memory Interface)
- Add "Project Context" panel to the assistant page
- Show: current summary, project memory items, pending decisions
- Allow users to: correct memories, approve proposals, reject ideas
- Show which memories were used in the last response

---

## 11. Testing Plan

### Unit Tests (mocked providers)
1. Token estimator accuracy
2. Context assembly with various message counts
3. Summary generation and updates
4. Project memory CRUD and conflict detection
5. Tool result persistence (the critical fix)
6. Interrupted response handling

### Integration Tests (mocked DB)
7. 10-message conversation — full history passed
8. 50-message conversation — truncation + summary
9. 100-message conversation — summary updates
10. Context budget exceeded — graceful degradation
11. Provider switching — history preserved
12. Cross-user isolation — no leakage
13. Cross-project isolation — no leakage
14. MCP tool results persisted and restored

### Existing Tests to Update
- `tests/assistant-providers.test.ts` — add system role tests
- `tests/groq-assistant.test.ts` — add context assembly tests

---

## 12. Implementation Phases

| Phase | Scope | Files Changed | New Files | Effort |
|-------|-------|---------------|-----------|--------|
| 1a | Fix tool result persistence | conversationService.ts, chatMessage.ts | — | Small |
| 1b | Fix system prompt role | conversationService.ts | — | Trivial |
| 1c | Interrupted response handling | conversationService.ts | — | Small |
| 1d | Token estimator + context budget | conversationService.ts | tokenEstimator.ts | Medium |
| 2 | Rolling summaries | conversationService.ts, conversation.ts | summaryService.ts | Medium |
| 3 | Project memory | — | projectMemory.ts, projectMemoryRepository.ts, memoryService.ts |B | Medium |
| 4 | Semantic retrieval | — | memoryRetrievalService.ts | Medium |
| 5 | Context assembly | conversationService.ts | contextAssemblyService.ts | Medium |
| 6 | Memory integrity | memoryService.ts | — | Small |
| 7 | Memory UI | — | ProjectContextPanel.tsx | Medium |
| 8 | Tests | — | memory-tests.ts | Medium |

**Recommended order:** 1a → 1b → 1c → 1d → 2 → 5 → 3 → 4 → 6 → 7 → 8

Phase 1 fixes the critical defects. Phase 2+5 enables long conversations.
Phase 3+4 adds cross-conversation memory. Phase 7 is the UI.

---

## 13. Performance and Cost Implications

### Token Usage
- Summarization adds 1 extra provider call per summary update (~500-1000 tokens)
- Context assembly reduces tokens by truncating history (net savings)
- Project memory adds ~1000 tokens to context (one-time per request)

### Database
- Project memory: 1 new collection, indexed by user + project
- Summary: 1 new field on conversation documents
- Text indexes on chatMessages and projectMemory
- No schema migration needed (new fields are optional)

### Latency
- Summary generation: +1-3 seconds when triggered (infrequent)
- Memory retrieval: +50-100ms (indexed text search)
- Context assembly: +10-20ms (in-memory)

---

## 14. Confirmed Defects vs Recommendations

### Confirmed Defects (must fix)
1. **Tool results not persisted** — `role: "tool"` messages lost on resume
2. **System prompt as user role** — should be `role: "system"`
3. **No interrupted response handling** — partial responses lost
4. **`"rejected"` missing from ChatMessage model enum** —(will cause validation error)

### Recommendations (should implement)
5. Token estimation and context-window budgeting
6. Rolling conversation summaries
7. Persistent project memory
8. Semantic retrieval via MongoDB text search
9. Context assembly service
10. Memory management UI

---

## 15. Exact Files and Functions

### Files to Modify
| File | Changes |
|------|---------|
| `lib/services/conversationService.ts:96` | Fix system prompt role to "system" |
| `lib/services/conversationService.ts:161-204` | Persist tool messages to DB |
| `lib/services/conversationService.ts:95-98` | Add context budgeting before provider call |
| `lib/services/conversationService.ts:143-149` | Add interrupted response handling |
| `lib/models/chatMessage.ts:28` | Add "system" to role enum |
| `lib/models/chatMessage.ts:40` | Add "rejected" to toolCalls.status enum |
| `lib/models/conversation.ts` | Add summary field |

### New Files
| File | Purpose |
|------|---------|
| `lib/assistant/tokenEstimator.ts` | Token counting without external deps |
| `lib/services/summaryService.ts` | Conversation summarization |
| `lib/services/contextAssemblyService.ts` | Provider-independent context assembly |
| `lib/services/memoryRetrievalService.ts` | Text search across messages + memory |
| `lib/models/projectMemory.ts` | Project memory model |
| `lib/repositories/projectMemoryRepository.ts` | Project memory CRUD |
| `components/assistant/ProjectContextPanel.tsx` | Memory management UI |

---

## STOP — Awaiting Approval

This is a read-only audit. No files were modified.
Implementation requires explicit approval before proceeding.