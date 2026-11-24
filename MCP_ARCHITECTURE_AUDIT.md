# MCP Architecture Audit

**Date:** 2026-11-24
**Scope:** `lib/mcp/server.ts`, `scripts/mcp-server.ts`, `docs/MCP_INTEGRATION.md`, all repositories and services invoked by MCP tools.
**SDK:** `@modelcontextprotocol/sdk@^1.32.2`

---

## 1. Current Architecture

```
External AI Assistant (Claude Desktop, Cursor, etc.)
        │
        │  stdio (local process only)
        ▼
scripts/mcp-server.ts
        │
        │  reads MCP_ACTOR_USER_ID (fixed, single user)
        │  calls connectDB()
        │  creates McpServer via createMcpServer(clerkUserId)
        ▼
lib/mcp/server.ts
        │
        │  17 tools + 6 resources
        │  imports 11 repositories + canonStore
        │  imports ZERO services
        ▼
Repositories ──→ MongoDB
```

**Key architectural property:** The MCP server calls repositories directly, bypassing the service layer entirely. This is documented as intentional (`docs/MCP_INTEGRATION.md:138`): *"The MCP server calls repositories directly (bypassing service-layer business gates)"*.

---

## 2. Transport

| Aspect | Value |
|--------|-------|
| Transport | `StdioServerTransport` only |
| Location | `scripts/mcp-server.ts:25` |
| HTTP/SSE | None — zero matches for `StreamableHTTPServerTransport\|SSEServerTransport` in the codebase |
| Remote endpoint | None |
| Tests | `InMemoryTransport` (`tests/mcp-server.test.ts:3`) |

**Assessment:** stdio is adequate for local development and local clients (Claude Desktop, Cursor). It cannot serve remote clients (Kimi Code, Qwen Code, Cline, ChatGPT connectors, Gemini Connected Apps) without a network transport. Adding HTTP transport is a prerequisite for the MCP-first architecture.

---

## 3. Authentication

| Aspect | Value |
|--------|-------|
| Mechanism | `process.env.MCP_ACTOR_USER_ID` — static env var |
| Location | `scripts/mcp-server.ts:7` |
| Scope | Server-wide; single user for entire process lifetime |
| Validation | None — any non-empty string accepted; not checked against Clerk |
| Per-request auth | None |
| Multi-user | Not supported |
| If unset | Process exits with code 1 (fail-closed) |

**Assessment:** Acceptable for local single-user development. Inadequate for remote multi-user access. A remote MCP server cannot use a fixed user ID — it must authenticate each connecting client and resolve their Clerk identity.

---

## 4. Tools (17)

### 4.1 Tool Inventory

| # | Tool | Category | Service-layer? | Ownership? | False success? |
|---|------|----------|----------------|------------|----------------|
| 1 | `project.list` | Project | No | Yes | No |
| 2 | `project.get` | Project | No | Yes | No |
| 3 | `project.create` | Project | No | Yes | No (but bypasses user upsert + sets wrong status) |
| 4 | `project.update` | Project | No | Yes | No (but bypasses `assertEditable`) |
| 5 | `project.delete` | Project | No | Yes | Description false; orphans child data |
| 6 | `document.get` | Document | No | Yes | No |
| 7 | `document.update` | Document | No | Yes | Episode status bypass; no data validation |
| 8 | `document.import` | Document | No | Yes | No schema validation on parsed content |
| 9 | `document.export` | Document | No | Yes | No |
| 10 | `canon.query` | Canon | No | Yes | No |
| 11 | `canon.add` | Canon | No | Yes | Bypasses approval + canon-state commit |
| 12 | `canon.validate` | Canon | No | Yes | Always returns `valid: true` — no actual validation |
| 13 | `media.list` | Media | No | Yes | No |
| 14 | `media.upload` | Media | No | Yes | Marks unvalidated file as "verified" |
| 15 | `media.generate_audio` | Media | No | N/A | **PURE FALSE SUCCESS** — does nothing |
| 16 | `render.start` | Render | No | Yes | **Orphaned job** — never enqueued, never processed |
| 17 | `render.status` | Render | No | Yes | No |

### 4.2 Service-Layer Bypasses

Every tool calls repositories directly. The following service-layer gates are bypassed:

| Operation | Service bypassed | Gate lost |
|-----------|------------------|-----------|
| `project.create` | `projectService.create` | User upsert, idempotency key, correct initial status (`draft` vs `planning`) |
| `project.update` | `projectService.update` | `assertEditable` — rejects edits to archived/busy projects |
| `project.delete` | `projectService.remove` | `isBusyStatus` check — prevents deleting in-production projects |
| `document.update` (episode) | `pipelineService.approveStory` | Canon update, continuity ledger, run status transition |
| `document.update` (bible) | `storyBibleService` | Bible approval snapshot flow |
| `render.start` | `createRenderService.triggerRender` | Preset validation, timeline approval check, asset collection, render settings, generation job creation, worker enqueue |
| `media.upload` | `mediaAssetService` | File validation, sha256, server-side storageKey, review pipeline |
| `media.generate_audio` | `ttsOrchestrationService` | Everything (pure no-op) |
| `canon.add` | `pipelineService` canon commit flow | Approval, `narrativeCanonRepository.commit`, staleness marking |

---

## 5. Resources (6)

| # | Name | URI Template | Returns | Ownership |
|---|------|--------------|---------|-----------|
| 1 | `project-bible` | `project://{projectId}/bible` | Story Bible JSON | Yes |
| 2 | `project-story` | `project://{projectId}/story` | Story draft JSON | Yes |
| 3 | `project-episodes` | `project://{projectId}/episodes/{n}` | Episode by number | Yes |
| 4 | `project-canon` | `project://{projectId}/canon` | Latest canon state | Yes |
| 5 | `project-assets` | `project://{projectId}/assets` | Media assets array | Yes |
| 6 | `project-timeline` | `project://{projectId}/timeline` | Timelines array | Yes |

All resources are read-only and enforce ownership via repository query filters. No issues found with resources.

---

## 6. Existing Frontend AI Workspace Work

Uncommitted partial work from a previous task exists in `components/assistant/` (13 untracked files):

```
components/assistant/
  types.ts
  AssistantWorkspace.module.css
  ConversationSidebar.tsx + .module.css
  MarkdownRenderer.tsx + .module.css
  MessageBubble.tsx + .module.css
  ModelSelector.module.css
  mock/conversations.ts
  mock/projects.ts
  mock/providers.ts
  mock/responder.ts
```

**Status:** Not referenced by any route or navigation. Not committed. `package.json` modified to add `react-markdown` + `remark-gfm`.

**Assessment:** This work was designed for an embedded API-based chatbot with provider selection — the architecture the user has now rejected. The design and project-context concepts may be partially reusable for an MCP connection status panel, but the provider-selector and mock-chat model should not be pursued. Recommend cleaning up (removing or archiving) in Phase 1.

---

## 7. What Can Be Retained

| Component | Retain? | Reason |
|-----------|---------|--------|
| `lib/mcp/server.ts` tool/resource definitions | Yes | Tool names and schemas are reasonable; need rewiring to services |
| `scripts/mcp-server.ts` | Yes | stdio entry point remains useful for local dev |
| `tests/mcp-server.test.ts` | Yes | Test structure is sound; assertions need updating |
| `docs/MCP_INTEGRATION.md` | Yes | Documentation structure is good; needs updating |
| `components/layout/MCPStatus.tsx` | Yes | Status pill is useful |
| Repository ownership pattern (`ownedQuery`) | Yes | Strong, consistent ownership enforcement |
| `components/assistant/` (uncommitted) | No | Designed for rejected architecture; clean up in Phase 1 |

---

## 8. Target Architecture

```
External AI Assistants
  Claude · Kimi · Qwen · Cline · ChatGPT · Gemini
          │
          │  Streamable HTTP (remote) / stdio (local)
          ▼
  AI Drama Studio MCP Server (remote endpoint)
          │
          │  Per-request auth (OAuth/token → Clerk user)
          │  Project ownership enforcement
          ▼
  Shared Application Services
    projectService · storyBibleService · pipelineService
    renderService · mediaAssetService · canonService
          │
          ▼
  Repositories ──→ MongoDB
```

**Key changes needed:**
1. Add Streamable HTTP transport alongside stdio
2. Add per-request authentication (resolve Clerk user from token)
3. Rewire all 17 tools from repositories → services
4. Correct false-success operations
5. Add approval workflow for canon and document changes
6. Add audit logging