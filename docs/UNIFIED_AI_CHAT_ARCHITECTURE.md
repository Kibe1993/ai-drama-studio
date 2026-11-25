# Unified AI Chat Architecture

**Phase 0 — Read-Only Audit**
**Date:** 2026-11-25
**Status:** Architecture proposal, pending approval

---

## 1. Objective

Build a unified conversational AI chat interface inside AI Drama Studio that allows the user to communicate with three external AI agents — **ChatGPT (OpenAI)**, **Google Gemini**, and **DeepSeek** — from within the application. The agents must be able to access project data through the existing MCP infrastructure. The user never writes MCP tool calls manually.

---

## 2. Existing Infrastructure (Audit Summary)

### 2.1 MCP Server

| Component | Location | Details |
|-----------|----------|---------|
| MCP server | `lib/mcp/server.ts` (2046 lines) | ~75 tools, 9 resources, 19 registration functions |
| HTTP transport | `lib/mcp/httpServer.ts` (58 lines) | `WebStandardStreamableHTTPServerTransport`, per-user server pool |
| HTTP endpoint | `app/api/mcp/route.ts` (97 lines) | `POST/GET/DELETE /api/mcp`, dual auth (Bearer token or Clerk session) |
| Activity log | `app/api/mcp/activity/route.ts` | `GET /api/mcp/activity` |
| CORS gateway | `scripts/mcp-gateway.mjs` | Port 8787, forwards to `:3000/api/mcp` |
| Auth bridge | `mcp-auth-bridge.cjs` (37 lines) | Port 3007, injects Bearer token, single-user |
| SuperAssistant config | `superassistant-config.json` | Points to `:3007/api/mcp` |
| Stdio server | `scripts/mcp-server.ts` | `npm run mcp:server`, requires `MCP_ACTOR_USER_ID` |

**Key findings:**
- The MCP HTTP server runs on the Next.js port (3000) at `/api/mcp` — no dedicated port.
- Port 3006 (mentioned in the spec) does not exist anywhere in the codebase.
- The SuperAssistant is an **external client**, not a proxy implemented in this repo. The config file is the only artifact.
- The auth bridge (port 3007) is a single-user, single-token shim — not per-user.
- **No production MCP client code exists.** Only test-side `Client` + `InMemoryTransport` in `tests/mcp-server.test.ts`.

### 2.2 LLM Provider System (Story Generation)

| Provider | File | SDK | Default Model | Free Tier |
|----------|------|-----|---------------|-----------|
| OpenAI | `lib/providers/llm/openai.ts` | `openai` SDK via `chatJson` | `gpt-6-luna` | No (paid) |
| Gemini | `lib/providers/llm/gemini.ts` | `@google/genai` SDK | `gemini-flash-latest` | Yes (`gemini-3.8-flash`) |
| DeepSeek | `lib/providers/llm/deepseek.ts` | `openai` SDK via `chatJson` (OpenAI-compatible) | `deepseek-flash` | No (paid, very cheap) |

- 10 providers registered in `lib/providers/llm/registry.ts` with sequential failover.
- Free policy (`lib/providers/llm/freePolicy.ts`): `LLM_FREE_ONLY=true` by default. OpenAI, Anthropic, DeepSeek, Kimi are classified as paid.
- `LLMProvider` interface (`lib/providers/llm/types.ts:184-223`): story-generation methods (`generateStory`, `generateCharacters`, `generateScenes`, etc.). Not suitable for conversational chat.

### 2.3 Chat Service (Ad-Hoc Chat)

| Component | Location | Details |
|-----------|----------|---------|
| Chat providers | `lib/providers/llm/chatProviders.ts` (207 lines) | 10 free-tier OpenAI-compatible providers |
| Chat service | `lib/services/chatService.ts` (185 lines) | Generic chat completion via OpenAI SDK |
| Chat API | `app/api/tools/chat/route.ts` (50 lines) | `GET/POST /api/tools/chat` |
| Chat UI | `app/(studio)/settings/tools/chat/page.tsx` (237 lines) | Provider grid + chat interface |
| MCP chat tools | `lib/mcp/server.ts:425-475` | `chat.providers`, `chat.models`, `chat.complete` |

**The 10 existing chat providers:** Cerebras, SambaNova, Together AI, Fireworks AI, SiliconFlow, GLM (Zhipu AI), Novita AI, Hugging Face, GitHub Copilot, Cloudflare Workers AI.

**Notably absent from the chat providers list:** OpenAI (ChatGPT), Gemini, DeepSeek — the three agents requested by this spec. The chat service uses the OpenAI SDK for all providers, which means OpenAI and DeepSeek can be added trivially (both OpenAI-compatible). Gemini requires the `@google/genai` SDK (already installed).

### 2.4 Database

- **Connection:** `lib/db/connect.ts` — Mongoose `createConnection` (named, cached), database `DramaStudio`, `clerkUserId` ownership on all user-scoped models.
- **Model pattern:** `timestamps: true`, explicit `collection` name, `clerkUserId: { type: String, required: true }`, compound indexes leading with `clerkUserId`, lazy model factories.
- **Repository pattern:** Plain record types out, `ownedQuery(clerkUserId, id?)` enforces ownership on every query, cursor pagination with stable `_id` tie-break, idempotent inserts.
- **No conversation/message models exist.** Chat history is ephemeral component state.

### 2.5 UI & Frontend

- **CSS Modules** (not Tailwind) for new pages. Dark theme (`#0f0e0c` / `#f3efe6` / `#c4a574` gold accent).
- **Lucide icons** (`lucide-react@^0.552.0`) — available and in use.
- **API hook** (`hooks/api.ts`): `api<T>(path, init?)` fetch wrapper with `{ data }` / `{ error }` envelope.
- **No markdown rendering** libraries installed.
- **No streaming infrastructure** for chat. `chatService.complete()` does not use `stream: true`. No SSE route handlers exist.
- **React Query** (`@tanstack/react-query@^5.90.5`) is installed but not used on the chat page.
- **Navigation:** `StudioShell` (`components/layout/StudioShell.tsx`) with sidebar nav. No top-level "AI Assistant" link exists.

### 2.6 Installed AI SDKs

| Package | Version | Used By |
|---------|---------|---------|
| `openai` | `^7.47.0` | `chatJson`, `chatService`, OpenAI/DeepSeek/Groq/OpenRouter/Mistral providers |
| `@google/genai` | `^2.32.0` | Gemini provider |
| `@anthropic-ai/sdk` | `^1.3.0` | Anthropic provider |
| `@modelcontextprotocol/sdk` | `^1.32.2` | MCP server + test client |

---

## 3. Integration Strategy

### 3.1 The Core Question: How Do Agents Access MCP Tools?

The spec requires agents to access project data through MCP. Three options were considered:

**Option A — HTTP MCP Client (over localhost)**
- The chat orchestration layer creates an MCP `Client` connected to `http://localhost:3000/api/mcp`.
- Tool calls go over HTTP to the MCP server, which calls services, which query the database.
- **Pros:** True MCP protocol, reuses auth bridge, works with any MCP server.
- **Cons:** HTTP overhead per tool call, auth complexity (need to pass Clerk session or Bearer token), circular request path (Next.js → MCP → Next.js).

**Option B — In-Process MCP Client (InMemoryTransport)**
- The chat orchestration layer creates an MCP `Client` connected to an `McpServer` instance via `InMemoryTransport` (same pattern as `tests/mcp-server.test.ts`).
- Tool calls execute in-process — no HTTP overhead.
- **Pros:** Efficient, reuses MCP tool definitions and execution logic, no network hop.
- **Cons:** Creates a second `McpServer` instance per conversation (the HTTP server pool already has one per user).

**Option C — Direct Service Calls**
- The chat orchestration layer calls services directly (e.g., `projectService.get()`, `storyBibleRepository.findOwned()`).
- **Pros:** Simplest, most efficient, no MCP protocol overhead.
- **Cons:** Bypasses MCP infrastructure (spec says "reuse existing MCP"), duplicates tool schemas.

**Recommended: Option B (In-Process MCP Client)**

Option B is the best balance:
- Reuses the existing MCP server — no duplicate tool definitions or execution logic.
- No HTTP overhead — tool calls execute in-process.
- The `InMemoryTransport` pattern is already proven in the test suite.
- The `createMcpServer(clerkUserId)` factory is already designed for per-user instantiation.
- Tool schemas can be extracted from the MCP server's `listTools()` response and passed to LLM function-calling.

### 3.2 The Tool-Use Loop

The conversational agent follows the standard LLM tool-use loop:

```
1. User sends message
2. Orchestration layer builds the message history + MCP tool schemas
3. LLM provider receives the request with function definitions
4. LLM either:
   a. Returns a text response → stream to user, done
   b. Returns a tool call → execute via MCP client, add tool result to history, go to step 3
5. Repeat until LLM returns a text response or max iterations reached
```

Each provider handles tool-use natively:
- **OpenAI:** `tools` parameter in Chat Completions API, `tool_calls` in response.
- **Gemini:** `tools` parameter in `generateContent`, `functionCall` parts in response.
- **DeepSeek:** OpenAI-compatible — same `tools`/`tool_calls` format as OpenAI.

### 3.3 MCP Tool Selection

Not all ~75 MCP tools should be exposed to the chat agents. A curated subset focuses on read-heavy, conversation-relevant operations:

**Exposed tools (read):**
- `project.list`, `project.get`
- `document.get` (bible, story, episode, season_plan, scenes)
- `entity.list`, `entity.get` (characters)
- `canon.get`, `canon.facts`
- `scene.list`, `scene.get`
- `episode.list`, `episode.get`
- `media.list`
- `timeline.get`
- `activity.recent`

**Exposed tools (write — require user approval):**
- `document.update` (bible, story, episode)
- `story.propose`
- `entity.create`, `entity.update`

**Not exposed:** Render, pipeline, media generation, tool config, ComfyUI, Veo, and other infrastructure tools. These are not relevant to conversational analysis and would clutter the tool schema.

### 3.4 Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            AI Assistant Page (/assistant)             │ │
│  │  ┌───────────┐  ┌──────────────────────────────────┐ │ │
│  │  │  Sidebar   │  │       Chat Main Area             │ │ │
│  │  │  - New     │  │  ┌──────────────────────────┐    │ │ │
│  │  │  - History │  │  │  Agent selector           │    │ │ │
│  │  │  - Projects│  │  │  Messages + tool activity │    │ │ │
│  │  │            │  │  │  Input + send             │    │ │ │
│  │  └───────────┘  │  └──────────────────────────┘    │ │ │
│  └─────────────────┴────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP (SSE for streaming)
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 Next.js Server (Port 3000)                │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            /api/assistant/chat (SSE Route)            │ │
│  │  - Auth (Clerk session)                               │ │
│  │  - Input validation (Zod)                             │ │
│  │  - Delegates to ConversationService                   │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                          │                                │
│  ┌───────────────────────▼──────────────────────────────┐│
│  │              ConversationService                       ││
│  │  - Loads conversation + message history                ││
│  │  - Gets provider from AgentProviderRegistry            ││
│  │  - Runs tool-use loop (see §3.2)                      ││
│  │  - Persists messages                                  ││
│  └──────────────────────┬──────────────────────────────┘│
│                          │                                │
│  ┌───────────────────────▼──────────────────────────────┐│
│  │           AgentProviderRegistry                        ││
│  │  ├── OpenAIChatProvider   (openai SDK, streaming)     ││
│  │  ├── GeminiChatProvider   (@google/genai, streaming)  ││
│  │  └── DeepSeekChatProvider (openai SDK, streaming)     ││
│  └──────────────────────┬──────────────────────────────┘│
│                          │                                │
│  ┌───────────────────────▼──────────────────────────────┐│
│  │              MCP Tool Executor                        ││
│  │  - Creates in-process MCP client                      ││
│  │  - Connected to McpServer via InMemoryTransport       ││
│  │  - listTools() → function schemas for LLM             ││
│  │  - callTool(name, args) → tool result                 ││
│  └──────────────────────┬──────────────────────────────┘│
│                          │                                │
│  ┌───────────────────────▼──────────────────────────────┐│
│  │           Existing MCP Server                         ││
│  │  (lib/mcp/server.ts — 75+ tools, 9 resources)        ││
│  │  → Services → Repositories → MongoDB                  ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

---

## 4. Provider Abstraction

### 4.1 ChatAgentProvider Interface

```typescript
interface ChatAgentProvider {
  readonly id: "openai" | "gemini" | "deepseek";
  readonly displayName: string;
  readonly configured: boolean;
  readonly defaultModel: string;
  readonly models: string[];

  /** Stream a chat completion with tool-use support. */
  streamCompletion(params: {
    model: string;
    messages: ChatMessage[];
    tools?: McpToolSchema[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent>;

  /** Check if the provider is ready (API key present). */
  isAvailable(): boolean;
}

type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; result: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: string }
  | { type: "error"; error: string };
```

### 4.2 Provider Independence

Each provider is a separate class with its own:
- **Configuration:** API key from environment variables.
- **Authentication:** Provider-specific auth (OpenAI/DeepSeek: Bearer token, Gemini: API key).
- **Model selection:** Provider-specific model lists and defaults.
- **Request handling:** Provider-specific SDK calls.
- **Streaming:** Provider-specific streaming implementation.
- **Error handling:** Provider-specific error classification.
- **Tool format:** Provider-specific tool schema format (OpenAI/DeepSeek: function calling, Gemini: function declarations).

The `AgentProviderRegistry` holds all three providers and lets the user switch between them. Switching providers does not merge conversation histories.

### 4.3 Provider Implementations

**OpenAIChatProvider:**
- SDK: `openai` (already installed, `^7.47.0`).
- Auth: `OPENAI_API_KEY` environment variable.
- Streaming: `client.chat.completions.create({ stream: true })` → async iteration.
- Tool format: OpenAI function calling (`tools: [{ type: "function", function: {...} }]`).
- Default model: `gpt-4o` (or user-configurable via `OPENAI_CHAT_MODEL`).

**GeminiChatProvider:**
- SDK: `@google/genai` (already installed, `^2.32.0`).
- Auth: `GEMINI_API_KEY` environment variable (free tier available).
- Streaming: `ai.models.generateContentStream({...})` → async iteration.
- Tool format: Gemini function declarations (`tools: [{ functionDeclarations: [...] }]`).
- Default model: `gemini-3.8-flash` (free tier).

**DeepSeekChatProvider:**
- SDK: `openai` (OpenAI-compatible, already installed).
- Auth: `DEEPSEEK_API_KEY` environment variable.
- Base URL: `https://api.deepseek.com` (hardcoded in existing provider).
- Streaming: Same as OpenAI (`stream: true`).
- Tool format: OpenAI function calling (DeepSeek supports it).
- Default model: `deepseek-chat` (or user-configurable).

---

## 5. Conversation Data Model

### 5.1 Conversation Model

```typescript
// lib/models/conversation.ts
{
  clerkUserId: { type: String, required: true },
  title: { type: String, required: true, default: "New Conversation" },
  provider: { type: String, enum: ["openai", "gemini", "deepseek"], required: true },
  model: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, default: null },  // optional project link
  lastMessageAt: { type: Date, default: Date.now },
  messageCount: { type: Number, default: 0 },
  // timestamps: true → createdAt, updatedAt
}
```

**Indexes:**
- `{ clerkUserId: 1, updatedAt: -1 }` — conversation list sorted by recency.
- `{ clerkUserId: 1, provider: 1, updatedAt: -1 }` — filter by provider.
- `{ clerkUserId: 1, projectId: 1, updatedAt: -1 }` — filter by project.

### 5.2 Message Model

```typescript
// lib/models/chatMessage.ts
{
  clerkUserId: { type: String, required: true },
  conversationId: { type: Schema.Types.ObjectId, required: true, ref: "Conversation" },
  role: { type: String, enum: ["user", "assistant", "tool"], required: true },
  content: { type: String, required: true },
  provider: { type: String, enum: ["openai", "gemini", "deepseek"], required: true },
  model: { type: String, default: "" },
  toolCalls: [{
    id: String,
    name: String,
    args: Schema.Types.Mixed,
    result: String,
    status: { type: String, enum: ["pending", "success", "error"] },
  }],
  usage: {
    promptTokens: Number,
    completionTokens: Number,
    totalTokens: Number,
  },
  // timestamps: true → createdAt, updatedAt
}
```

**Indexes:**
- `{ clerkUserId: 1, conversationId: 1, createdAt: 1 }` — message history in order.
- `{ clerkUserId: 1, conversationId: 1, role: 1 }` — filter by role.

### 5.3 Storage Strategy

- Uses the **existing MongoDB connection** (`lib/db/connect.ts`) — no second database.
- Follows the **existing model pattern**: `clerkUserId` ownership, `timestamps: true`, explicit collection names, lazy model factories.
- Follows the **existing repository pattern**: plain record types, `ownedQuery` enforcement, cursor pagination.
- Conversations are **per-user** — `clerkUserId` on every document prevents cross-user access.

---

## 6. MCP Tool Execution Layer

### 6.1 In-Process MCP Client

```typescript
// lib/assistant/mcpToolExecutor.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/lib/mcp/server";

class McpToolExecutor {
  private client: Client;

  async initialize(clerkUserId: string) {
    const server = createMcpServer(clerkUserId);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    this.client = new Client({ name: "assistant", version: "1.0.0" });
    await this.client.connect(clientTransport);
  }

  async listTools() {
    const result = await this.client.listTools();
    return result.tools;  // Filter to exposed subset
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return await this.client.callTool({ name, arguments: args });
  }
}
```

### 6.2 Tool Schema Translation

MCP tool schemas (JSON Schema) must be translated to provider-specific function-calling formats:

- **OpenAI/DeepSeek:** `tools: [{ type: "function", function: { name, description, parameters } }]`
- **Gemini:** `tools: [{ functionDeclarations: [{ name, description, parameters }] }]`

The translation is a thin mapping — both use JSON Schema for parameters.

### 6.3 Approval Workflow

For write operations (e.g., `document.update`, `entity.create`), the tool-use loop pauses and asks the user for explicit approval before executing the tool call. The UI shows:
- The tool name and arguments.
- An "Approve" / "Reject" button pair.
- If rejected, a rejection message is sent back to the LLM as the tool result.

### 6.4 Audit Trail

Every tool call is logged via the existing `logActivity` function (`lib/mcp/activityLog.ts`), creating an audit trail of:
- Tool name, arguments, result.
- User ID, conversation ID, timestamp.
- Approval status (for write operations).

---

## 7. Streaming Architecture

### 7.1 Server-Sent Events (SSE)

The chat API route (`/api/assistant/chat`) returns a `ReadableStream` that emits SSE events:

```
event: text
data: {"delta": "The Story Bible for"}

event: text
data: {"delta": " this project contains..."}

event: tool_call
data: {"id": "call_1", "name": "document.get", "args": {"documentType": "bible"}}

event: tool_result
data: {"id": "call_1", "result": "{\"title\": \"...\"}"}

event: text
data: {"delta": "I found an inconsistency in..."}

event: done
data: {"finishReason": "stop", "usage": {"totalTokens": 1234}}
```

### 7.2 Provider Streaming

- **OpenAI/DeepSeek:** `client.chat.completions.create({ stream: true })` returns an async iterable. Each chunk yields `delta.content` (text) or `delta.tool_calls` (tool call).
- **Gemini:** `ai.models.generateContentStream({...})` returns an async iterable. Each chunk yields `text` (text) or `functionCall` (tool call).

### 7.3 Cancellation

The SSE route accepts an `AbortSignal` (via `request.signal`). When the client disconnects, the signal aborts the provider's streaming request. The OpenAI and Google GenAI SDKs both support `signal` in their request options.

---

## 8. UI Architecture

### 8.1 Route Structure

```
app/(studio)/assistant/
  page.tsx              — Main assistant page (redirects to most recent or new)
  layout.tsx            — Assistant layout (sidebar + main)
  assistant.module.css  — Styles
  [conversationId]/
    page.tsx            — Specific conversation
```

### 8.2 Components

```
components/assistant/
  AssistantSidebar.tsx     — New chat, conversation history, project filter
  AgentSelector.tsx        — ChatGPT / Gemini / DeepSeek dropdown
  ChatMessages.tsx         — Message list with markdown rendering
  ChatMessage.tsx          — Single message (user/assistant/tool)
  ChatInput.tsx            — Message input + send button
  ToolActivity.tsx         — Tool call indicator with expand/collapse
  ApprovalDialog.tsx       — Write operation approval prompt
  MarkdownRenderer.tsx     — Lightweight markdown rendering
```

### 8.3 Navigation

Add a top-level "AI Assistant" link to `StudioShell.tsx` nav (between "MCP Server" and "Settings"), with a `Bot` or `MessageSquare` Lucide icon.

### 8.4 Markdown Rendering

Add `react-markdown` (`^19.0.0`) + `remark-gfm` (`^4.0.0`) for GitHub-flavored markdown rendering. These are small, standard, well-maintained libraries. The assistant responses frequently contain markdown (code blocks, lists, bold, etc.) — plain text rendering is inadequate for a ChatGPT-like experience.

---

## 9. What Can Be Reused vs. What Requires New Development

### 9.1 Reusable (No Changes Needed)

| Component | Location | Reuse |
|-----------|----------|-------|
| MCP server | `lib/mcp/server.ts` | Tool definitions, execution logic, per-user instantiation |
| MCP SDK | `@modelcontextprotocol/sdk` | `Client`, `InMemoryTransport` for in-process client |
| OpenAI SDK | `openai@^7.47.0` | OpenAI + DeepSeek providers (both OpenAI-compatible) |
| Google GenAI SDK | `@google/genai@^2.32.0` | Gemini provider |
| Database connection | `lib/db/connect.ts` | Same Mongoose connection |
| Model/repository pattern | `lib/models/`, `lib/repositories/` | Pattern for new conversation/message models |
| HTTP helpers | `lib/http/` | `logged`, `readActor`, `readJson`, `jsonData`, `errorResponse` |
| API hook | `hooks/api.ts` | Client-side API calls (with SSE extension) |
| CSS Modules pattern | Existing pages | Dark theme, component styles |
| Lucide icons | `lucide-react` | UI icons |
| Clerk auth | `lib/auth/session.ts` | User identification |
| Activity log | `lib/mcp/activityLog.ts` | Audit trail for tool calls |

### 9.2 New Development Required

| Component | Purpose |
|-----------|---------|
| `lib/assistant/types.ts` | ChatAgentProvider interface, ChatStreamEvent, ChatMessage types |
| `lib/assistant/mcpToolExecutor.ts` | In-process MCP client + tool schema translation |
| `lib/assistant/toolRegistry.ts` | Curated list of exposed MCP tools + approval requirements |
| `lib/providers/chat/openaiChatProvider.ts` | OpenAI streaming + tool-use |
| `lib/providers/chat/geminiChatProvider.ts` | Gemini streaming + tool-use |
| `lib/providers/chat/deepSeekChatProvider.ts` | DeepSeek streaming + tool-use |
| `lib/providers/chat/registry.ts` | AgentProviderRegistry |
| `lib/models/conversation.ts` | Conversation Mongoose model |
| `lib/models/chatMessage.ts` | Message Mongoose model |
| `lib/repositories/conversationRepository.ts` | Conversation CRUD |
| `lib/repositories/chatMessageRepository.ts` | Message CRUD |
| `lib/services/conversationService.ts` | Conversation management + tool-use loop |
| `app/api/assistant/conversations/route.ts` | GET list, POST create |
| `app/api/assistant/conversations/[id]/route.ts` | GET, PATCH, DELETE |
| `app/api/assistant/chat/route.ts` | POST streaming chat (SSE) |
| `app/(studio)/assistant/` | UI pages + layout |
| `components/assistant/` | UI components |
| `react-markdown` + `remark-gfm` | Markdown rendering (new dependency) |

### 9.3 Modifications to Existing Code

| File | Change |
|------|--------|
| `components/layout/StudioShell.tsx` | Add "AI Assistant" nav link |
| `package.json` | Add `react-markdown`, `remark-gfm` |

**No changes to:** MCP server, LLM registry, existing providers, existing models, existing services, existing API routes. The unified chat interface is purely additive.

---

## 10. Security & Safety

- **API keys never exposed to browser.** All provider calls happen server-side in the SSE route handler. The browser only sees streamed text and tool activity.
- **User isolation.** Every conversation and message has `clerkUserId`. The `ownedQuery` pattern prevents cross-user access.
- **Write approval.** Write operations require explicit user approval before execution. The tool-use loop pauses until the user approves or rejects.
- **Audit trail.** Every tool call is logged via `logActivity` with user ID, tool name, arguments, and result.
- **No new auth surface.** The SSE route uses the existing Clerk session via `readActor()`. No new tokens or credentials.
- **MCP server isolation.** The in-process MCP client uses `InMemoryTransport` — no network exposure. The MCP server instance is created with the user's `clerkUserId`, so all ownership checks apply.

---

## 11. Cheapest Practical Integration Strategy

See `AI_PROVIDER_COMPATIBILITY.md` for the full cost analysis. Summary:

1. **Gemini** — Free API tier via `GEMINI_API_KEY` from Google AI Studio. Free model: `gemini-3.8-flash`. **Zero cost.**
2. **DeepSeek** — Paid API, but extremely cheap (~$0.01-0.03 per million tokens). Requires `DEEPSEEK_API_KEY`. **Near-free cost.**
3. **OpenAI (ChatGPT)** — Paid API, no free tier. Requires `OPENAI_API_KEY`. Alternative: GitHub Copilot free tier (already in `chatProviders.ts`) provides GPT-4o access at no cost for up to 50 chat messages/month.

**Recommendation:** Start with Gemini (free) as the first working provider. Add DeepSeek (near-free) and OpenAI (paid) as the user provides API keys. Each provider shows a clear "configured" / "not configured" status in the UI.