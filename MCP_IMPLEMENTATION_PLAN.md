# MCP Implementation Plan

**Date:** 2026-11-24
**Objective:** Transform AI Drama Studio from a local stdio MCP server with direct repository access into a secure, remote-capable MCP server that routes through shared application services, supports multiple external AI assistants, and enforces approval workflows.

---

## Current State Summary

| Aspect | Current | Target |
|--------|---------|--------|
| Transport | stdio only | stdio + Streamable HTTP |
| Auth | Fixed `MCP_ACTOR_USER_ID` | Per-request OAuth/token → Clerk user |
| Service boundaries | Direct repository access (0 services) | All tools route through services |
| False-success ops | 2 pure, 1 partial, 2 misleading | Zero — all report actual outcomes |
| Approval workflow | None for canon/document changes | All changes require approval |
| Audit logging | None | All destructive operations logged |
| Rate limiting | None | Per-client rate limiting |
| Clients tested | None | Claude, Kimi, Qwen, Cline minimum |

---

## Phase 1 — Secure Remote MCP Connectivity

**Goal:** Add Streamable HTTP transport with per-request authentication, preserving stdio for local development.

### 1.1 Streamable HTTP Transport

- Add `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`
- Create an MCP route handler at `app/api/mcp/route.ts` (or similar)
- Support both stdio (`scripts/mcp-server.ts`) and HTTP (`app/api/mcp/`) entry points
- Refactor `createMcpServer` to accept a `clerkUserId` per-request instead of per-process
- Ensure HTTPS deployment compatibility (Next.js handles TLS termination)
- Add CORS headers for permitted origins

### 1.2 Authentication

- Investigate OAuth 2.0 authorization flow compatible with MCP clients
- Options:
  - **OAuth 2.0 Authorization Code with PKCE** — standard for MCP per spec
  - **Bearer token** — simpler, less standard
- Implement token validation that resolves to a Clerk user ID
- Reject unauthenticated requests with 401
- Support token expiration and revocation
- Keep `MCP_ACTOR_USER_ID` for local stdio development only
- Document: local dev uses env var; production uses OAuth

### 1.3 Project Ownership Enforcement

- Verify that per-request `clerkUserId` is threaded into all repository calls
- Add a middleware/guard that rejects requests without a valid user identity
- Test: user A cannot access user B's projects through MCP

### 1.4 Connection Lifecycle

- Handle connection establishment, tool discovery, and disconnection
- Add health check endpoint (`GET /api/mcp/health`)
- Add meaningful error responses for auth failures, rate limits, and server errors

### 1.5 Cleanup

- Remove or archive uncommitted `components/assistant/` files (embedded chatbot UI from rejected architecture)
- Revert `package.json` changes (react-markdown, remark-gfm) if not needed elsewhere

### 1.6 Testing

- Test with MCP Inspector (standards-compliant)
- Test with at least one actual client (Claude Desktop via stdio)
- Test auth flow end-to-end
- Test ownership enforcement

### 1.7 Deliverables

- `app/api/mcp/route.ts` — HTTP transport endpoint
- Updated `lib/mcp/server.ts` — per-request user identity
- Updated `scripts/mcp-server.ts` — stdio preserved for local dev
- `docs/MCP_REMOTE_SETUP.md` — remote connection instructions
- Updated `docs/MCP_INTEGRATION.md`

**STOP — Report results. Wait for approval before Phase 2.**

---

## Phase 2 — Correct MCP Tool Execution

**Goal:** Rewire all 17 tools from repositories to shared application services. Correct all false-success operations. Implement validation and approval.

### 2.1 Service Layer Routing

For each tool, replace direct repository calls with the corresponding service:

| Tool | Current (repository) | Target (service) |
|------|---------------------|------------------|
| `project.create` | `projectRepository.insert` | `projectService.create` |
| `project.update` | `projectRepository.update` | `projectService.update` |
| `project.delete` | `projectRepository.remove` | `projectService.remove` + cascade |
| `document.update` (bible) | `storyBibleRepository.saveDraft` | `storyBibleService.saveDraft` + approval |
| `document.update` (story) | `storyRepository.updateScreenplay` | `storyService.updateScreenplay` + status check |
| `document.update` (episode) | `episodeRepository.updateStatus` | Remove status override; route through `pipelineService` |
| `document.import` | `saveDraft` / `updateScreenplay` | Add schema validation before persistence |
| `canon.add` | `canonStore.append` | `canonService.propose` → approval → `canonStore.append` + `narrativeCanonRepository.commit` |
| `canon.validate` | Always `true` | Implement actual validation or rename to `canon.summary` |
| `media.upload` | `createVerified` | `mediaAssetService.storeVerified` with proper validation |
| `media.generate_audio` | No-op | `ttsOrchestrationService.enqueue` or return `unsupported` |
| `render.start` | `renderJobRepository.create` | `renderService.triggerRender` |

### 2.2 Approval Workflow

- Introduce a `ProposedChange` concept for write operations:
  - `canon.add` → propose fact → user approves → fact is appended + canon state committed
  - `document.update` → propose update → user approves → update is applied
  - `document.import` → propose import → user approves → import is applied
- MCP tools return proposed changes; the external assistant presents them to the user
- Add `change.approve` and `change.reject` MCP tools
- Changes expire after a configurable TTL

### 2.3 Input Validation

- Replace all `z.record(z.unknown())` with concrete Zod schemas
- Add `.max()` to string inputs (prevent DoS)
- Validate `projectId` as ObjectId
- Validate enums (`media.upload` type, `render.start` presetId, `project.update` genre)
- Remove all `as never` casts

### 2.4 False-Success Corrections

| Tool | Correction |
|------|------------|
| `media.generate_audio` | Either implement actual TTS enqueue or return `{ supported: false, reason: "TTS worker not configured" }` |
| `render.start` | Route through `renderService.triggerRender` which enforces all gates |
| `canon.validate` | Implement actual contradiction/gap detection or rename to `canon.summary` and update description |
| `project.delete` | Implement cascade or correct description; add `confirmProjectName` parameter |

### 2.5 Audit Logging

- Log all tool invocations: tool name, actor, project ID, arguments, outcome, timestamp
- Log destructive operations at WARN level
- Store logs in MongoDB or structured log output

### 2.6 Testing

- Unit tests for each tool's service-layer path
- Integration tests for approval workflow
- Tests for false-success corrections
- Tests for input validation
- Tests for ownership enforcement

### 2.7 Deliverables

- Updated `lib/mcp/server.ts` — all tools route through services
- New `lib/mcp/proposedChanges.ts` — proposed change tracking
- New MCP tools: `change.approve`, `change.reject`, `change.list`
- Updated `tests/mcp-server.test.ts`
- Updated `docs/MCP_INTEGRATION.md`

**STOP — Report results. Wait for approval before Phase 3.**

---

## Phase 3 — External Client Integration Testing

**Goal:** Test the remote MCP server with actual external AI assistants.

### 3.1 Primary Targets (test first)

1. **Claude Desktop** (stdio, local) — configure `mcpServers` entry
2. **Claude Code** (stdio, local) — configure `.mcp.json`
3. **Kimi Code** (stdio local + HTTP remote) — test both transports
4. **Qwen Code** (stdio local + HTTP remote) — test both transports
5. **Cline** (stdio local + HTTP remote) — test both transports

### 3.2 Additional Targets (investigate)

6. **ChatGPT** (HTTP remote) — test custom connector; document plan restrictions
7. **Gemini** (HTTP remote) — test Connected Apps; document regional/eligibility restrictions

### 3.3 Test Matrix

For each client, test and document:

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| Connection | | |
| Authentication | | |
| Tool discovery (17 tools listed) | | |
| `project.list` returns projects | | |
| `project.get` returns project detail | | |
| `document.get` returns Story Bible | | |
| `document.get` returns story draft | | |
| `canon.query` returns approved canon | | |
| Propose a document update | | |
| Approve the proposed change | | |
| Verify change persisted | | |
| Reject a proposed change | | |
| Verify change NOT persisted | | |
| Unauthorized access (other user's project) | | |
| Connection failure handling | | |

### 3.4 Setup Instructions

Produce setup instructions for each supported client:
- Exact configuration file location and format
- Environment variables needed
- Authentication setup
- Supported operations (read vs. write)
- Known limitations

### 3.5 Deliverables

- `docs/MCP_CLIENT_SETUP.md` — per-client setup instructions
- Updated `MCP_CLIENT_COMPATIBILITY.md` — with actual test results
- Recorded test results for each client

**STOP — Report results. Wait for approval before Phase 4.**

---

## Phase 4 — Multi-Assistant Production Workflow

**Goal:** Verify that multiple assistants can work on the same project without conflicts.

### 4.1 Test Scenarios

1. **Shared project data:** Assistant A creates a project; Assistant B lists and retrieves it
2. **Latest approved canon:** Assistant A adds a canon fact (approved); Assistant B queries canon and sees it
3. **Revision history:** Assistant A updates a document; Assistant B retrieves it and sees the latest version
4. **Conflict detection:** Assistant A and B propose incompatible changes; system detects conflict
5. **Approval enforcement:** Assistant A proposes a change; it is not visible as approved until the user approves
6. **No silent overwrites:** Assistant A's change does not overwrite Assistant B's uncommitted work
7. **No duplicate data:** Both assistants read from the same project record, not copies

### 4.2 Version and Conflict Detection

- Document version numbers on all entities
- Optimistic concurrency control (expectedVersion check)
- Conflict detection when two assistants propose changes to the same document
- User resolution flow for conflicts

### 4.3 Deliverables

- Multi-assistant test results
- Conflict detection documentation
- Updated `docs/MCP_INTEGRATION.md` with multi-assistant guidance

**STOP — Report results.**

---

## Constraints (All Phases)

- Preserve existing working features
- Do not delete production data
- Do not change database schemas without documented reason and approval
- Do not introduce mandatory paid services
- Do not introduce model API dependencies
- Do not download large models
- Do not expose secrets
- Do not bypass authentication
- Do not bypass application services
- Do not use TypeScript `any`
- Use CSS Modules, not Tailwind (for any UI changes)
- Run relevant tests, typecheck, and lint
- Clearly separate pre-existing failures from new failures
- Do not proceed to the next phase without explicit user approval

---

## Existing AI Workspace Work (Phase 0 Note)

Uncommitted files in `components/assistant/` (13 files) from a previous task designed an embedded API-based chatbot with provider selection. This architecture has been rejected in favor of MCP-first external assistants.

**Recommendation:** Remove these files and revert `package.json` changes in Phase 1. The project-context selection concept may be partially reusable for a future MCP connection status panel, but the provider-selector and mock-chat model should not be pursued.