# Implementation Roadmap — Unified AI Chat Interface

**Phase 0 — Read-Only Audit**
**Date:** 2026-11-25
**Status:** Roadmap proposal, pending approval

---

## 1. Overview

This roadmap implements the unified multi-agent conversational interface described in `UNIFIED_AI_CHAT_ARCHITECTURE.md` across 8 phases. Each phase produces a working, testable increment. No phase modifies existing application code (except adding a nav link in Phase 2 and a dependency in Phase 2).

**Constraint:** Do not implement all providers simultaneously before verifying the first provider works. Phase 3 implements one provider (Gemini — free), verifies it, then Phase 5 adds the remaining two.

---

## 2. Phase Summary

| Phase | Title | Deliverable | New Files | Modifies |
|-------|-------|-------------|-----------|----------|
| 0 | Audit | 3 architecture docs | 3 docs | None |
| 1 | Provider abstraction + data model | Types, models, repositories | ~8 files | None |
| 2 | Unified chat UI shell | Assistant page, layout, components | ~10 files | `StudioShell.tsx`, `package.json` |
| 3 | First provider (Gemini) | Gemini chat provider + streaming | ~3 files | None |
| 4 | MCP tool execution | In-process MCP client + tool-use loop | ~3 files | None |
| 5 | Remaining providers | OpenAI + DeepSeek providers | ~3 files | None |
| 6 | Conversation persistence + agent switching | Conversation service, API routes | ~5 files | None |
| 7 | Permissions, approval, testing | Approval workflow, tests, polish | ~5 files | None |

**Total new files:** ~37
**Total modifications:** 2 existing files (`StudioShell.tsx` nav link, `package.json` markdown deps)

---

## 3. Detailed Phases

### Phase 1: Provider Abstraction and Conversation Data Model

**Goal:** Define the types, database models, and repositories for the chat system. No UI, no providers, no API routes yet — just the foundation.

**Tasks:**

1. **Create `lib/assistant/types.ts`** — Core type definitions:
   - `ChatAgentId = "openai" | "gemini" | "deepseek"`
   - `ChatMessage = { role: "user" | "assistant" | "tool"; content: string; toolCalls?: ToolCall[]; usage?: TokenUsage }`
   - `ChatStreamEvent` union (text delta, tool call, tool result, usage, done, error)
   - `ChatAgentProvider` interface (id, displayName, configured, defaultModel, models, streamCompletion, isAvailable)
   - `ConversationRecord`, `MessageRecord` plain types
   - `McpToolSchema` type (name, description, inputSchema)

2. **Create `lib/models/conversation.ts`** — Mongoose model:
   - Schema: `clerkUserId`, `title`, `provider` (enum), `model`, `projectId` (optional), `lastMessageAt`, `messageCount`
   - `timestamps: true`, collection `"conversations"`
   - Indexes: `{ clerkUserId: 1, updatedAt: -1 }`, `{ clerkUserId: 1, provider: 1, updatedAt: -1 }`, `{ clerkUserId: 1, projectId: 1, updatedAt: -1 }`
   - Lazy model factory pattern (same as `lib/models/project.ts`)

3. **Create `lib/models/chatMessage.ts`** — Mongoose model:
   - Schema: `clerkUserId`, `conversationId` (ObjectId ref), `role` (enum), `content`, `provider` (enum), `model`, `toolCalls` (array of subdocs), `usage` (subdoc)
   - `timestamps: true`, collection `"chatMessages"`
   - Indexes: `{ clerkUserId: 1, conversationId: 1, createdAt: 1 }`, `{ clerkUserId: 1, conversationId: 1, role: 1 }`
   - Lazy model factory pattern

4. **Create `lib/repositories/conversationRepository.ts`** — CRUD:
   - `list(clerkUserId, provider?, projectId?, cursor?, limit?)` — cursor pagination
   - `findOwned(clerkUserId, id)` — single conversation
   - `create(clerkUserId, { title, provider, model, projectId? })` — new conversation
   - `update(clerkUserId, id, patch)` — rename, update model
   - `remove(clerkUserId, id)` — delete conversation + all messages
   - `touch(clerkUserId, id)` — update `lastMessageAt` and increment `messageCount`
   - Uses `ownedQuery` pattern, plain record types out

5. **Create `lib/repositories/chatMessageRepository.ts`** — CRUD:
   - `listForConversation(clerkUserId, conversationId)` — all messages in order
   - `create(clerkUserId, conversationId, message)` — new message
   - `createBatch(clerkUserId, conversationId, messages[])` — bulk insert
   - `removeForConversation(clerkUserId, conversationId)` — delete all messages
   - Uses `ownedQuery` pattern

6. **Create `lib/assistant/toolRegistry.ts`** — Curated MCP tool list:
   - `EXPOSED_READ_TOOLS` — array of tool names (project.list, project.get, document.get, entity.list, entity.get, canon.get, canon.facts, scene.list, scene.get, episode.list, episode.get, media.list, timeline.get, activity.recent)
   - `EXPOSED_WRITE_TOOLS` — array of tool names requiring approval (document.update, story.propose, entity.create, entity.update)
   - `ALL_EXPOSED_TOOLS` — concatenation
   - `requiresApproval(toolName)` — boolean check
   - `isExposed(toolName)` — boolean check

**Verification:**
- `npm run typecheck` passes
- `npm test` passes (no new tests yet, existing tests unaffected)

**Files created:** 6
**Files modified:** 0

---

### Phase 2: Unified Chat UI Shell

**Goal:** Create the assistant page layout, sidebar, agent selector, and chat message components. The UI is functional but not yet connected to a real provider — it uses a placeholder/mock for demonstration.

**Tasks:**

1. **Add dependencies to `package.json`:**
   - `react-markdown@^19.0.0`
   - `remark-gfm@^4.0.0`

2. **Add nav link to `components/layout/StudioShell.tsx`:**
   - Add `{ href: "/assistant", label: "AI Assistant", icon: Bot }` to nav links array
   - Import `Bot` from `lucide-react`

3. **Create `app/(studio)/assistant/layout.tsx`:**
   - Server component, `force-dynamic`
   - Auth check (same pattern as `app/(studio)/layout.tsx`)
   - Renders assistant sidebar + main content

4. **Create `app/(studio)/assistant/page.tsx`:**
   - Client component
   - Redirects to most recent conversation or shows "new conversation" state
   - Agent selector (ChatGPT / Gemini / DeepSeek) with configured status
   - Empty state with provider setup instructions

5. **Create `app/(studio)/assistant/[conversationId]/page.tsx`:**
   - Client component
   - Loads conversation + message history
   - Renders chat messages with markdown
   - Message input + send button
   - Tool activity indicators
   - Loading/error states

6. **Create `app/(studio)/assistant/assistant.module.css`:**
   - Dark theme matching existing design system
   - Sidebar, message list, input area, agent selector, tool activity styles
   - Responsive layout (sidebar collapses on mobile)

7. **Create `components/assistant/AssistantSidebar.tsx`:**
   - "New chat" button
   - Agent filter (All / ChatGPT / Gemini / DeepSeek)
   - Conversation list sorted by recency
   - Project filter (optional)
   - Delete conversation

8. **Create `components/assistant/AgentSelector.tsx`:**
   - Dropdown with ChatGPT, Gemini, DeepSeek
   - Each shows configured/not-configured status
   - Free/paid label
   - Model selector sub-dropdown

9. **Create `components/assistant/ChatMessages.tsx`:**
   - Message list with auto-scroll
   - User messages (right-aligned, gold accent)
   - Assistant messages (left-aligned, with markdown rendering)
   - Tool messages (collapsible, with icon)

10. **Create `components/assistant/ChatInput.tsx`:**
    - Textarea with auto-resize
    - Send button (disabled when empty or loading)
    - Enter to send, Shift+Enter for newline
    - Cancel button during streaming

11. **Create `components/assistant/ToolActivity.tsx`:**
    - Tool call indicator (spinner + tool name)
    - Expandable to show arguments and result
    - Approval prompt for write operations

12. **Create `components/assistant/MarkdownRenderer.tsx`:**
    - `react-markdown` + `remark-gfm` wrapper
    - Code blocks with syntax highlighting (CSS-only, no heavy deps)
    - Links open in new tab
    - Styled to match dark theme

**Verification:**
- `npm run typecheck` passes
- `npm run dev` — assistant page renders at `/assistant`
- Nav link visible in sidebar
- Agent selector shows three providers with configured status
- New conversation button works (creates local state, no persistence yet)

**Files created:** 10
**Files modified:** 2 (`StudioShell.tsx`, `package.json`)

---

### Phase 3: First Working Provider (Gemini)

**Goal:** Implement the Gemini chat provider with streaming and tool-use support. Verify the end-to-end flow works before adding other providers.

**Tasks:**

1. **Create `lib/providers/chat/geminiChatProvider.ts`:**
   - Class `GeminiChatProvider implements ChatAgentProvider`
   - `id = "gemini"`, `displayName = "Google Gemini"`
   - `configured` — checks `GEMINI_API_KEY` is present
   - `defaultModel = "gemini-3.8-flash"` (free tier)
   - `models = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.0-flash", "gemini-flash-latest"]`
   - `streamCompletion()` — uses `@google/genai` SDK:
     - `ai.models.generateContentStream({ model, contents, tools, config: { temperature, maxOutputTokens } })`
     - Yields `ChatStreamEvent` events from the async iterable
     - Handles `functionCall` parts → `tool_call` events
     - Handles `text` parts → `text` delta events
     - Handles usage metadata → `usage` event
     - Supports `AbortSignal` for cancellation
   - `isAvailable()` — returns `configured`
   - Tool schema translation: MCP JSON Schema → Gemini `functionDeclarations`

2. **Create `lib/providers/chat/registry.ts`:**
   - `AgentProviderRegistry` class
   - Holds all provider instances (only Gemini in this phase)
   - `getProvider(id)` — returns provider or throws
   - `listProviders()` — returns all providers with metadata
   - `isProviderConfigured(id)` — boolean

3. **Create `app/api/assistant/chat/route.ts`:**
   - `POST` handler with SSE streaming
   - Auth via `readActor()`
   - Input validation: `provider`, `conversationId`, `message`, `model?`, `temperature?`
   - Creates `ReadableStream` that emits SSE events
   - Calls `conversationService.chat()` (created in Phase 6; for now, a minimal inline implementation)
   - Returns `Response` with `content-type: text/event-stream`

4. **Create minimal `lib/services/conversationService.ts`:**
   - `chat(clerkUserId, { provider, conversationId, message, model, temperature, signal })` — async generator
   - Loads conversation history (from repository, or empty if new)
   - Gets provider from registry
   - Runs simplified loop (no MCP tools yet — just text completion)
   - Yields `ChatStreamEvent` events
   - Persists messages (user + assistant) to database

5. **Wire up the UI:**
   - `ChatInput` sends POST to `/api/assistant/chat`
   - `ChatMessages` renders SSE events in real-time
   - `AgentSelector` shows Gemini as configured/not-configured
   - Error handling for missing API key, rate limits, network errors

**Verification:**
- Set `GEMINI_API_KEY` in `.env.local`
- `npm run dev` — go to `/assistant`, select Gemini, send a message
- Response streams in real-time
- Message persists across page refreshes (if conversation persistence is wired)
- `npm run typecheck` passes
- `npm test` passes

**Files created:** 4
**Files modified:** 0

---

### Phase 4: MCP Tool Execution

**Goal:** Connect the chat agents to the MCP server so they can read project data and perform operations through tool-use.

**Tasks:**

1. **Create `lib/assistant/mcpToolExecutor.ts`:**
   - Class `McpToolExecutor`
   - `initialize(clerkUserId)` — creates `McpServer` + `Client` + `InMemoryTransport` pair
   - `listExposedTools()` — calls `client.listTools()`, filters to `ALL_EXPOSED_TOOLS`
   - `callTool(name, args)` — calls `client.callTool({ name, arguments: args })`
   - `getToolSchemas(provider)` — translates MCP tool schemas to provider-specific format
   - `close()` — disconnects client and server
   - Error handling: tool not found, execution error, timeout

2. **Update `lib/services/conversationService.ts`:**
   - Add MCP tool-use loop:
     1. Get tool schemas from `McpToolExecutor`
     2. Pass tools to provider's `streamCompletion()`
     3. When provider yields `tool_call` event:
        a. Check if tool requires approval (write operation)
        b. If yes, yield `approval_required` event, pause until approval received
        c. Execute tool via `McpToolExecutor.callTool()`
        d. Add tool result to message history
        e. Yield `tool_result` event
     4. Continue loop until provider yields `done` event
   - Max iterations: 10 (prevent infinite tool loops)
   - Log all tool calls via `logActivity()`

3. **Update `app/api/assistant/chat/route.ts`:**
   - Add SSE event types: `tool_call`, `tool_result`, `approval_required`
   - Handle approval: client sends approval via separate endpoint, server resumes

4. **Create `app/api/assistant/approve/route.ts`:**
   - `POST` handler for tool call approval
   - Body: `{ conversationId, toolCallId, approved: boolean }`
   - Resolves the pending approval in the conversation service

5. **Update UI components:**
   - `ToolActivity` component shows tool calls with expand/collapse
   - `ApprovalDialog` component for write operations
   - `ChatMessages` renders tool activity between messages
   - Tool activity shows: tool name, arguments (JSON), result (JSON), status (pending/success/error)

**Verification:**
- With `GEMINI_API_KEY` set, ask the assistant: "List my projects"
- Assistant calls `project.list` MCP tool, displays results conversationally
- Ask: "Show me the Story Bible for project X"
- Assistant calls `document.get` with `documentType: "bible"`, renders the bible content
- Ask: "Update the Story Bible title to 'New Title'"
- Assistant calls `document.update` → approval dialog appears → approve → update executes
- `npm run typecheck` passes
- `npm test` passes

**Files created:** 2
**Files modified:** 3 (`conversationService.ts`, `chat/route.ts`, UI components)

---

### Phase 5: Remaining Providers (OpenAI + DeepSeek)

**Goal:** Add the OpenAI (ChatGPT) and DeepSeek providers. Each is independent and follows the same interface as Gemini.

**Tasks:**

1. **Create `lib/providers/chat/openaiChatProvider.ts`:**
   - Class `OpenAIChatProvider implements ChatAgentProvider`
   - `id = "openai"`, `displayName = "ChatGPT (OpenAI)"`
   - `configured` — checks `OPENAI_API_KEY` is present
   - `defaultModel = "gpt-4o"`
   - `models = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]`
   - `streamCompletion()` — uses `openai` SDK:
     - `client.chat.completions.create({ model, messages, tools, stream: true, temperature, max_tokens })`
     - Yields `ChatStreamEvent` events from the async iterable
     - Handles `delta.content` → `text` delta events
     - Handles `delta.tool_calls` → `tool_call` events
     - Handles `usage` → `usage` event
     - Supports `AbortSignal` via `signal` option
   - Tool schema: OpenAI function calling format (native, minimal translation from MCP)

2. **Create `lib/providers/chat/deepSeekChatProvider.ts`:**
   - Class `DeepSeekChatProvider implements ChatAgentProvider`
   - `id = "deepseek"`, `displayName = "DeepSeek"`
   - `configured` — checks `DEEPSEEK_API_KEY` is present
   - `defaultModel = "deepseek-chat"`
   - `models = ["deepseek-chat", "deepseek-reasoner"]`
   - `streamCompletion()` — uses `openai` SDK with `baseURL: "https://api.deepseek.com"`:
     - Same streaming pattern as OpenAI (DeepSeek is OpenAI-compatible)
     - Same tool-use format (DeepSeek supports OpenAI function calling)
   - Tool schema: Same as OpenAI (no translation needed)

3. **Update `lib/providers/chat/registry.ts`:**
   - Register all three providers: `GeminiChatProvider`, `OpenAIChatProvider`, `DeepSeekChatProvider`
   - `listProviders()` returns all three with configured status

4. **Update UI:**
   - `AgentSelector` shows all three providers
   - Each shows configured/not-configured status with setup instructions
   - Provider switching works mid-conversation (starts new conversation with selected provider)
   - Provider-specific error messages (e.g., "OPENAI_API_KEY not set — get a key at platform.openai.com")

**Verification:**
- With `GEMINI_API_KEY` set (free): Gemini works, others show "not configured"
- With `OPENAI_API_KEY` set: ChatGPT works, streaming + tool-use functional
- With `DEEPSEEK_API_KEY` set: DeepSeek works, streaming + tool-use functional
- Switch between providers — each maintains separate conversation history
- `npm run typecheck` passes
- `npm test` passes

**Files created:** 2
**Files modified:** 2 (`registry.ts`, `AgentSelector.tsx`)

---

### Phase 6: Conversation Persistence and Agent Switching

**Goal:** Full conversation persistence — create, list, open, rename, delete conversations. Agent switching preserves separate histories.

**Tasks:**

1. **Create `app/api/assistant/conversations/route.ts`:**
   - `GET` — list conversations (with provider and projectId filters, cursor pagination)
   - `POST` — create new conversation (provider, model, title?, projectId?)

2. **Create `app/api/assistant/conversations/[id]/route.ts`:**
   - `GET` — single conversation with messages
   - `PATCH` — update title, model
   - `DELETE` — delete conversation + all messages

3. **Update `lib/services/conversationService.ts`:**
   - Full conversation lifecycle management
   - `createConversation()` — new conversation with provider + model
   - `getConversation()` — load with messages
   - `listConversations()` — paginated list
   - `renameConversation()` — update title
   - `deleteConversation()` — delete conversation + messages
   - `chat()` — loads history, runs tool-use loop, persists all new messages

4. **Update UI:**
   - `AssistantSidebar` loads conversation list from API
   - "New chat" creates conversation via API, navigates to it
   - Click conversation → navigate to `/assistant/[id]`
   - Rename conversation (inline edit)
   - Delete conversation (with confirmation)
   - Agent switching: when switching provider, show option to start new conversation or open existing for that provider
   - Conversation list filters by provider (All / ChatGPT / Gemini / DeepSeek)
   - Project-linked conversations show project name

5. **Auto-title generation:**
   - After first assistant response, generate a title from the first user message (truncate to 50 chars)
   - Update conversation title via API

**Verification:**
- Create conversation with Gemini → send messages → refresh page → conversation persists
- Switch to OpenAI → start new conversation → OpenAI conversation is separate
- Switch back to Gemini → previous Gemini conversation is in the list
- Rename conversation → title updates in sidebar
- Delete conversation → removed from list, messages deleted
- `npm run typecheck` passes
- `npm test` passes

**Files created:** 2
**Files modified:** 3 (`conversationService.ts`, `AssistantSidebar.tsx`, `[conversationId]/page.tsx`)

---

### Phase 7: Permissions, Approval Workflows, and Testing

**Goal:** Security hardening, write-operation approval, comprehensive tests, and polish.

**Tasks:**

1. **Approval workflow:**
   - Write operations (`document.update`, `story.propose`, `entity.create`, `entity.update`) require explicit user approval
   - UI shows `ApprovalDialog` with tool name, arguments (formatted JSON), and Approve/Reject buttons
   - If rejected, a rejection message is sent to the LLM as the tool result
   - If approved, the tool executes and the result is sent to the LLM
   - Approval timeout: 5 minutes (auto-reject if no response)

2. **Audit trail:**
   - Every tool call logged via `logActivity(clerkUserId, "assistant_tool_call", { tool, args, result, conversationId })`
   - Activity log visible at `/api/mcp/activity` (existing endpoint)

3. **Conflict detection:**
   - Before executing `document.update`, check the document's `updatedAt` timestamp
   - If the document was modified after the conversation started, warn the user
   - The LLM receives a "document was modified externally" message and can re-read

4. **Rate limiting:**
   - Per-user rate limit on chat completions (e.g., 20 messages/minute)
   - Use existing `lib/http/rateLimit.ts` if available, or implement simple in-memory limiter

5. **Error handling polish:**
   - Provider unavailable → clear error message with setup instructions
   - Rate limited → retry with exponential backoff (up to 3 retries)
   - Tool execution failure → error message to LLM, conversation continues
   - Network error → retry button in UI
   - Max tool iterations → "I've reached the tool call limit. Please ask me something else."

6. **Tests:**
   - `tests/assistant/conversation-service.test.ts` — conversation CRUD, message persistence
   - `tests/assistant/mcp-tool-executor.test.ts` — in-process MCP client, tool execution
   - `tests/assistant/gemini-chat-provider.test.ts` — streaming, tool-use, error handling (mocked SDK)
   - `tests/assistant/openai-chat-provider.test.ts` — streaming, tool-use (mocked SDK)
   - `tests/assistant/deepseek-chat-provider.test.ts` — streaming, tool-use (mocked SDK)
   - `tests/assistant/approval-workflow.test.ts` — write operation approval flow
   - `tests/assistant/api-routes.test.ts` — API endpoint tests

7. **UI polish:**
   - Loading skeletons for conversation list and messages
   - Empty states with helpful guidance
   - Error states with retry buttons
   - Responsive layout (mobile-friendly sidebar collapse)
   - Keyboard shortcuts (Cmd/Ctrl+Enter to send, Cmd/Ctrl+K for new chat)
   - Copy button on assistant messages
   - Token usage display per message

**Verification:**
- `npm run typecheck` passes
- `npm test` passes with new tests
- `npm run lint` passes
- Manual testing: all three providers work, tool-use works, approval works, persistence works
- No existing tests broken

**Files created:** ~7
**Files modified:** ~3

---

## 4. Dependency Graph

```
Phase 0 (audit) ✅
    ↓
Phase 1 (types + models + repos)
    ↓
Phase 2 (UI shell) ← can start in parallel with Phase 1
    ↓
Phase 3 (Gemini provider + minimal service + SSE route) ← depends on Phase 1
    ↓
Phase 4 (MCP tool execution) ← depends on Phase 3
    ↓
Phase 5 (OpenAI + DeepSeek providers) ← depends on Phase 4
    ↓
Phase 6 (full persistence + agent switching) ← depends on Phase 5
    ↓
Phase 7 (permissions + approval + tests) ← depends on Phase 6
```

**Critical path:** Phase 1 → Phase 3 → Phase 4 → Phase 6 → Phase 7
**Parallelizable:** Phase 2 (UI shell) can start once Phase 1 types are defined.

---

## 5. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| MCP server instance per conversation causes memory pressure | Reuse a single `McpToolExecutor` per user (cached by `clerkUserId`), not per conversation |
| LLM enters infinite tool-call loop | Max 10 tool iterations per message, then stop |
| Tool execution takes too long | 30s timeout per tool call, configurable |
| Streaming response is very long | No special handling needed — SSE streams incrementally |
| Provider API is down | Error message to user, retry button, no silent failure |
| User switches provider mid-conversation | Not allowed — switching provider starts a new conversation |
| Write operation modifies wrong document | Approval dialog shows exact arguments before execution |
| API key leaked to browser | All provider calls are server-side (SSE route), keys never sent to client |
| Existing Gemini/SuperAssistant connection broken | No changes to `lib/providers/llm/`, `lib/mcp/server.ts`, or `superassistant-config.json` |

---

## 6. Reuse Summary

### Reused from existing codebase (no changes):
- MCP server (`lib/mcp/server.ts`) — tool definitions, execution, per-user instantiation
- MCP SDK (`@modelcontextprotocol/sdk`) — `Client`, `InMemoryTransport`
- OpenAI SDK (`openai@^7.47.0`) — OpenAI + DeepSeek providers
- Google GenAI SDK (`@google/genai@^2.32.0`) — Gemini provider
- Database connection (`lib/db/connect.ts`) — same Mongoose connection
- Model pattern (`lib/models/`) — `clerkUserId`, `timestamps: true`, lazy factories
- Repository pattern (`lib/repositories/`) — `ownedQuery`, cursor pagination
- HTTP helpers (`lib/http/`) — `logged`, `readActor`, `readJson`, `jsonData`, `errorResponse`
- API hook (`hooks/api.ts`) — client-side fetch (extended for SSE)
- CSS Modules pattern — dark theme, component styles
- Lucide icons — UI icons
- Clerk auth (`lib/auth/session.ts`) — user identification
- Activity log (`lib/mcp/activityLog.ts`) — audit trail

### New dependencies:
- `react-markdown@^19.0.0` — markdown rendering (~50KB)
- `remark-gfm@^4.0.0` — GitHub-flavored markdown (~30KB)

### New code only — no existing code modified (except):
- `components/layout/StudioShell.tsx` — add "AI Assistant" nav link (1 line)
- `package.json` — add 2 markdown dependencies

---

## 7. Success Criteria

1. **User can open `/assistant` and see a ChatGPT-like interface.**
2. **User can select between ChatGPT, Gemini, and DeepSeek.**
3. **User can send messages and receive streamed responses.**
4. **User can have the assistant read project data via MCP tools (e.g., "Show me the Story Bible").**
5. **Write operations require explicit user approval.**
6. **Conversations persist across page refreshes.**
7. **Switching agents preserves separate conversation histories.**
8. **Gemini works for free with `GEMINI_API_KEY` from Google AI Studio.**
9. **OpenAI and DeepSeek work when their API keys are configured.**
10. **Unconfigured providers show clear setup instructions.**
11. **No existing application features are broken.**
12. **All tests pass, typecheck passes, lint passes.**