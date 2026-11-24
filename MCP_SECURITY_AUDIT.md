# MCP Security Audit

**Date:** 2026-11-24
**Scope:** `lib/mcp/server.ts`, `scripts/mcp-server.ts`, `lib/auth/session.ts`, `lib/repositories/ownership.ts`, all repositories invoked by MCP tools.

---

## 1. Authentication

### 1.1 Current Mechanism

| Aspect | Finding |
|--------|---------|
| Source | `process.env.MCP_ACTOR_USER_ID?.trim()` at `scripts/mcp-server.ts:7` |
| Type | Static env var, read once at startup |
| Scope | Server-wide; single user for entire process lifetime |
| Validation | **None** — any non-empty string accepted; not checked against Clerk user directory |
| Per-request auth | **None** |
| Multi-user | **Not supported** |
| If unset | Process exits code 1 (fail-closed) |
| Override | None at runtime; rotation requires restart |

**Risk:** Anyone who can set `MCP_ACTOR_USER_ID` to another user's Clerk ID gains full read/write access to that user's projects, documents, canon, and media. The variable is documented in `.env.example:111-113` and `docs/MCP_INTEGRATION.md:12`. Treat as a credential.

### 1.2 Remote Authentication (Not Implemented)

A remote MCP server cannot use a fixed user ID. It must:
1. Authenticate each connecting client (OAuth flow or bearer token)
2. Resolve the client's Clerk user identity
3. Enforce project ownership per-request
4. Support token expiration and revocation
5. Keep local development auth separate from production auth

**Status:** No HTTP transport, no OAuth flow, no token validation exists. This is a Phase 1 deliverable.

---

## 2. Project Ownership Enforcement

**Verdict: Strong and consistent for the current single-user model.**

Every repository method called by MCP filters by `clerkUserId`. The central helper:

- `lib/repositories/ownership.ts:11-15` — `ownedQuery(clerkUserId, id?)` returns `{ clerkUserId, _id?: id }` and **throws if `clerkUserId` is empty**.

Verified per tool: all 17 tools and all 6 resources pass `clerkUserId` into repository calls. Cross-user access is not possible through the current MCP server.

**Minor inconsistency:** `episodeRepository` (`:34-43`) and `canonicalEntityRepository.listByProject` (`:56-66`) build `{ clerkUserId, projectId }` inline rather than via `ownedQuery()`. Functionally equivalent but bypasses the empty-id guard. Low risk since the MCP actor ID is validated non-empty at startup.

---

## 3. Authorization Gaps

### 3.1 CRITICAL: `render.start` bypasses the render gate

- **Location:** `lib/mcp/server.ts:420-444`
- **Issue:** Does not check `timeline.status === "approved"`. The service layer (`lib/services/renderService.ts:34-35`) enforces this.
- **Impact:** An external assistant can start a render on an unapproved timeline, violating the render gate that AGENTS.md explicitly forbids bypassing.

### 3.2 CRITICAL: `document.update` (episode) bypasses story approval

- **Location:** `lib/mcp/server.ts:216-220`
- **Issue:** `args.data` is `z.record(z.unknown())` — no validation. `args.data.status` is cast `as never` and passed directly to `episodeRepository.updateStatus`, which sets any status string.
- **Impact:** An assistant can force an episode to `story_approved` or `completed`, skipping the entire approval workflow (canon update, continuity ledger, run transition).

### 3.3 HIGH: `canon.add` bypasses approval and commit workflow

- **Location:** `lib/mcp/server.ts:308-327`
- **Issue:** Appends canon facts immediately and irrevocably. No proposal, no review, no approval. `narrativeCanonRepository.commit` (which creates versioned canon state and marks stale artifacts) is never called.
- **Impact:** An assistant can inject or retract canon facts without human review, corrupting narrative continuity.

### 3.4 HIGH: `media.upload` hardcodes verification status

- **Location:** `lib/mcp/server.ts:369-398`
- **Issue:** Sets `validationStatus: "verified"` and `reviewStatus: "approved"` for a file that was never validated. The repository overrides `reviewStatus` to `"pending"`, but `validationStatus` remains `"verified"`.
- **Impact:** An asset record claims verification for a non-existent file.

### 3.5 HIGH: `project.delete` orphans child data

- **Location:** `lib/mcp/server.ts:138-151` → `lib/repositories/projectRepository.ts:167-171`
- **Issue:** Description claims cascade deletion; implementation only deletes the `Project` document. Stories, episodes, scenes, media, canon, timelines, render jobs, season plans, and bibles become orphans.
- **Impact:** Data integrity defect; orphaned documents accumulate.

---

## 4. Input Validation

| Field | Location | Issue |
|-------|----------|-------|
| `document.update` `data` | `server.ts:201` | `z.record(z.unknown())` — no shape validation |
| `canon.add` `fact` | `server.ts:313` | `z.record(z.unknown())` — validated only at `canonStore.append` |
| `document.import` `content` | `server.ts:232` | `z.string()` with no `max()` — unbounded payload |
| `media.upload` `type` | `server.ts:374` | `z.string()` not `z.enum([...])` |
| `media.upload` `mimeType`, `fileName`, `storageKey` | `server.ts:376-379` | Bare `z.string()` — no whitelist/sanitization |
| `render.start` `presetId` | `server.ts:427` | `z.string()` — not validated against actual presets |
| `project.update` `genre`, `language`, etc. | `server.ts:119-125` | `z.string()` — no enum validation |
| `projectId` args | various | `z.string()` — no ObjectId format check |

**TypeScript safety:** 15+ `as never` casts in `lib/mcp/server.ts` suppress compile-time checking of payload shapes.

---

## 5. Secrets Exposure

**Verdict: Clean. No secrets leak through tools or resources.**

- No tool returns env vars, API keys, `MONGODB_URI`, `CLERK_SECRET_KEY`, or storage credentials.
- Resources expose only project data (bible, story, episodes, canon, assets, timeline), all filtered by ownership.
- `MCP_ACTOR_USER_ID` is logged at startup (`scripts/mcp-server.ts:20`) — this is a Clerk user ID, not a secret, but should be redacted if logs are shipped to shared destinations.

---

## 6. Transport Security

### Current (stdio)
- `StdioServerTransport` — no network surface. Security depends on process spawn permissions and env file access. Appropriate for local development.

### If HTTP transport is added naively
- `createMcpServer(clerkUserId)` takes a fixed user ID with no per-request auth hook.
- An HTTP transport built on this would be **completely unauthenticated** — any network client could act as the configured user.
- Required before exposing remotely:
  1. Per-request authentication (token → Clerk user ID)
  2. TLS/HTTPS
  3. CORS origin restrictions
  4. Rate limiting per client
  5. Reject non-localhost origins unless explicitly configured

---

## 7. Session Management

**Verdict: None. Single-actor, single-connection model.**

- No session concept. No per-client identity. No logout.
- stdio is inherently single-connection. Multiple simultaneous clients would share the same actor with no isolation.
- **No rate limiting.** `lib/http/rateLimit.ts` exists but is not imported by MCP code. A runaway assistant loop could hammer MongoDB unthrottled.
- No concurrent-operation locking (canon sequence conflicts throw `CanonFactConflict` — safe but not user-friendly).

---

## 8. Destructive Operations

| Tool | Destructive? | Confirmation | Audit log |
|------|-------------|--------------|-----------|
| `project.delete` | Yes — permanent | **None** | **None** |
| `document.update` | Overwrites content | None | None |
| `document.import` | Overwrites document | None | None |
| `canon.add` | Append-only (but `retract` removes) | None | None |
| `media.upload` | Can shadow existing assets | None | None |
| `render.start` | Creates queued job | None | None |

**No audit logging** for any tool invocation. The `run()` wrapper (`server.ts:34-36`) catches errors but does not log tool calls, arguments, or outcomes. Destructive operations leave no trace of which assistant performed them.

---

## 9. Findings Summary by Severity

| Severity | Finding | Location |
|----------|---------|----------|
| **CRITICAL** | `render.start` bypasses timeline-approval render gate | `server.ts:420-444` |
| **CRITICAL** | `document.update` (episode) allows arbitrary status writes | `server.ts:216-220` |
| **HIGH** | `canon.add` bypasses approval and canon commit workflow | `server.ts:308-327` |
| **HIGH** | `media.upload` hardcodes `verified`/`approved` for unvalidated file | `server.ts:369-398` |
| **HIGH** | `project.delete` does not cascade; description is false; orphans data | `server.ts:138-151` |
| **MEDIUM** | `render.start` does not validate `episodeId` against timeline's project | `server.ts:429-443` |
| **MEDIUM** | No audit logging for destructive operations | `server.ts:34-36` |
| **MEDIUM** | Unbounded/unvalidated complex payloads | `server.ts:201,232,313` |
| **MEDIUM** | No rate limiting on MCP tools | `rateLimit.ts` not imported |
| **LOW** | `as never` casts suppress TypeScript validation | throughout `server.ts` |
| **LOW** | `projectId` args not format-validated as ObjectId | `server.ts:75,142` |
| **INFO** | `MCP_ACTOR_USER_ID` is an unvalidated impersonation token | `scripts/mcp-server.ts:7` |
| **INFO** | HTTP transport would be unauthenticated if added naively | `server.ts:38` |

---

## 10. Recommended Remediations

1. **Route MCP through the service layer** — single fix that closes findings 3.1–3.5
2. **Add per-request authentication** for remote transport (OAuth/token → Clerk user)
3. **Validate all inputs** with concrete Zod schemas (replace `z.record(z.unknown())`)
4. **Fix `project.delete`** — cascade or correct description; add confirmation safeguard
5. **Add audit logging** in the `run()` wrapper for destructive tools
6. **Add rate limiting** to MCP tool invocations
7. **Document `MCP_ACTOR_USER_ID` as a secret** — recommend secret-manager injection
8. **Remove `as never` casts** — let TypeScript enforce payload types
9. **If HTTP transport is added**, require TLS, CORS allowlist, per-request auth, and rate limiting before exposing remotely