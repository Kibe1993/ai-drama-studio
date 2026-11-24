# MCP Tool Reliability Audit

**Date:** 2026-11-24
**Scope:** All 17 MCP tools in `lib/mcp/server.ts`, traced to their repository and service-layer execution paths.

---

## Reliability Classification

| Class | Meaning |
|-------|---------|
| **Reliable** | Performs the claimed operation correctly |
| **Misleading** | Performs an operation but returns misleading information about the result |
| **Partial** | Persists a record but the operation will not complete as claimed |
| **False success** | Returns success without performing any work |
| **Bypasses gate** | Performs a write but skips a required approval/validation gate |

---

## Tool-by-Tool Assessment

### 1. `project.list` — Reliable ✅

- **Path:** `server.ts:55-69` → `projectRepository.list(clerkUserId, null, limit, status)`
- **Behavior:** Returns owned projects, paginated, optionally filtered by status.
- **Issues:** `status` is not validated against actual `ProjectStatus` enum values. Invalid status returns empty results (safe but silent).
- **Verdict:** Reliable for normal use.

### 2. `project.get` — Reliable ✅

- **Path:** `server.ts:71-84` → `projectRepository.findOwned(clerkUserId, projectId)`
- **Behavior:** Returns the project or throws if not found/unowned.
- **Issues:** `projectId` not format-validated as ObjectId.
- **Verdict:** Reliable.

### 3. `project.create` — Bypasses gate ⚠️

- **Path:** `server.ts:86-112` → `projectRepository.insert({ clerkUserId, ...args, status: "planning" })`
- **Behavior:** Creates a project with `status: "planning"`.
- **Issues:**
  1. Service layer (`projectService.create:111`) sets `status: "draft"`. MCP hardcodes `"planning"`, skipping the draft state.
  2. User upsert (creating a `User` projection document) is skipped.
  3. Idempotency key handling is skipped.
- **Verdict:** Bypasses gate. The project is created but with an incorrect initial status.

### 4. `project.update` — Bypasses gate ⚠️

- **Path:** `server.ts:114-136` → `projectRepository.update(clerkUserId, projectId, patch)`
- **Behavior:** Applies the patch directly.
- **Issues:** Service layer (`projectService.update:119-125`) calls `assertEditable(current.status)` which rejects edits to `archived` or busy statuses. MCP applies unconditionally.
- **Verdict:** Bypasses gate. Can edit archived or in-production projects.

### 5. `project.delete` — Misleading + orphans data 🔴

- **Path:** `server.ts:138-151` → `projectRepository.remove(clerkUserId, projectId)` → `Project.deleteOne(ownedQuery(...))`
- **Description:** *"Delete a project permanently. This also removes all associated stories, scenes, and media."*
- **Reality:** Only the `Project` document is deleted. No cascade.
- **Orphaned collections:** Stories, episodes, scenes, media assets, canon facts, timelines, render jobs, season plans, story bibles, production runs.
- **Also bypasses:** `projectService.remove:174-186` checks `isBusyStatus` — prevents deleting in-production projects. MCP does not.
- **Verdict:** Misleading. Description is false. Data integrity issue.

### 6. `document.get` — Reliable ✅

- **Path:** `server.ts:155-192`
- **Behavior:** Retrieves bible, story, episode, season_plan, or scenes. All branches enforce ownership.
- **Verdict:** Reliable.

### 7. `document.update` — Bypasses gate + no validation 🔴

- **Path:** `server.ts:194-224`
- **Schema:** `data: z.record(z.unknown())` — arbitrary JSON.

- **bible branch:** `storyBibleRepository.saveDraft` — works, but bypasses the bible approval flow. The draft is saved but not approved.
- **story branch:** `storyRepository.updateScreenplay` — the repo filter requires `status: "awaiting_approval"` (`storyRepository.ts:304`). If the story is `approved`, the update silently no-ops and returns `null`. The tool returns `{ message: "Story not found" }` — **misleading**: the story exists but is not editable.
- **episode branch:** `episodeRepository.updateStatus(clerkUserId, projectId, episodeId, data.status, data.currentStoryId)` — sets **any** status string directly. Bypasses `pipelineService.approveStory` which orchestrates canon updates, continuity ledger writes, and run status transitions.

- **Verdict:** Bypasses gate. No data validation. Misleading error for story branch. Episode status can be forced to any value.

### 8. `document.import` — No schema validation ⚠️

- **Path:** `server.ts:226-247`
- **Behavior:** `JSON.parse(args.content)` → `saveDraft` or `updateScreenplay`.
- **Issues:** Parsed content is not validated against `storyBibleContentSchema` or any screenplay schema before persistence. Malformed data is persisted.
- **Also:** Same story-guard misleading-error issue as `document.update`.
- **Verdict:** No schema validation. Malformed imports are persisted.

### 9. `document.export` — Reliable ✅

- **Path:** `server.ts:249-287`
- **Behavior:** Returns document JSON. Read-only.
- **Verdict:** Reliable.

### 10. `canon.query` — Reliable ✅

- **Path:** `server.ts:291-306`
- **Behavior:** Returns latest or versioned canon state. Read-only.
- **Verdict:** Reliable.

### 11. `canon.add` — Bypasses approval + commit 🔴

- **Path:** `server.ts:308-327` → `canonStore.append`
- **Behavior:** Appends a canon fact to the append-only event store immediately.
- **Issues:**
  1. **No approval step.** The fact is committed irrevocably with no human review.
  2. **`narrativeCanonRepository.commit` is never called.** No versioned `CanonState` snapshot is created. No `VersionConflict` detection on the state. `markStaleCanonArtifacts` is never invoked — media provenance/staleness tracking does not update.
  3. `operation: "retract"` can logically remove established facts without approval.
- **Mitigating:** `canonStore.append` does verify ownership, check `expectedSequence` for optimistic concurrency, and validate entry shape via `canonFactEntrySchema.parse()`.
- **Verdict:** Bypasses approval and commit. Facts take effect immediately.

### 12. `canon.validate` — False success (no validation) 🔴

- **Path:** `server.ts:329-351`
- **Description:** *"Validate canon consistency for a project. Checks the latest canon state for contradictions or gaps."*
- **Behavior:** Loads canon state and entities, counts entities by type, **always returns `valid: true`**.
- **Issues:** Zero contradiction detection. Zero gap analysis. The description is misleading — this is a summary, not a validator.
- **Verdict:** False success. Always returns valid.

### 13. `media.list` — Reliable ✅

- **Path:** `server.ts:355-367`
- **Behavior:** Returns project media assets. Read-only.
- **Verdict:** Reliable.

### 14. `media.upload` — Misleading ⚠️

- **Path:** `server.ts:369-398` → `mediaAssetRepository.createVerified`
- **Behavior:** Creates a media asset record.
- **Issues:**
  1. `validationStatus: "verified"` is set for a file that was never validated (no file bytes uploaded).
  2. `reviewStatus: "approved"` is passed by MCP but **overridden to `"pending"`** by `createVerified` (`mediaAssetRepository.ts:58`). The tool claims approval but the repo forces pending.
  3. No `idempotencyKey` passed → no dedup → repeated calls create duplicate assets.
  4. `storageKey` is caller-supplied (not generated server-side like `mediaAssetService` does).
- **Verdict:** Misleading. Asset is created but metadata misrepresents state.

### 15. `media.generate_audio` — Pure false success 🔴

- **Path:** `server.ts:400-417`
- **Description:** *"Trigger audio generation for a project. This queues a TTS job..."*
- **Behavior:** Returns `{ message: "Audio generation queued..." }` **without doing anything**.
- **What is missing:**
  - No `generationJobRepository.insert`
  - No BullMQ `production` queue add
  - No TTS orchestration
  - No job record of any kind
- **Verdict:** Pure false success. The tool does zero work and claims success.

### 16. `render.start` — Partial false success (orphaned job) 🔴

- **Path:** `server.ts:420-444`
- **Behavior:** Creates a `renderJob` document with status `queued`.
- **What is missing vs. service layer** (`renderService.ts:23-107`):

| Step | Service | MCP |
|------|---------|-----|
| Preset validation | ✅ (throws on unknown) | ❌ |
| Timeline approval check | ✅ (`status === "approved"`) | ❌ |
| Collect `inputAssetIds` from clips | ✅ | ❌ (empty array) |
| Populate `renderSettings` from preset | ✅ | ❌ (empty object) |
| Set `idempotencyKey` | ✅ | ❌ |
| Create `generationJob` (`render.final`) | ✅ | ❌ |
| Enqueue to worker | ✅ (`enqueue(job)`) | ❌ |

- **Result:** A render-job DB record is created (not a pure no-op), but the worker has no `generationJob` to process. The render job stays `queued` indefinitely.
- **Verdict:** Partial false success. Persistence is real but the render will never execute.

### 17. `render.status` — Reliable ✅

- **Path:** `server.ts:446-466`
- **Behavior:** Returns render job status. Read-only.
- **Verdict:** Reliable.

---

## Summary

| Category | Count | Tools |
|----------|-------|-------|
| Reliable | 8 | `project.list`, `project.get`, `document.get`, `document.export`, `canon.query`, `media.list`, `render.status`, `document.get` |
| Bypasses gate | 5 | `project.create`, `project.update`, `document.update`, `canon.add`, `render.start` |
| False success | 2 | `media.generate_audio`, `canon.validate` |
| Partial false success | 1 | `render.start` (also bypasses gate) |
| Misleading | 2 | `project.delete`, `media.upload` |
| No validation | 1 | `document.import` |

**Tools requiring correction in Phase 2:**
1. `media.generate_audio` — implement actual enqueue or return unsupported
2. `render.start` — route through `renderService.triggerRender`
3. `canon.add` — add approval flow; call `narrativeCanonRepository.commit`
4. `canon.validate` — implement actual validation or rename to `canon.summary`
5. `document.update` — validate data; remove episode status bypass; fix story error message
6. `document.import` — validate against document schemas
7. `project.delete` — cascade or correct description; add confirmation
8. `project.create` — set correct initial status; route through service
9. `project.update` — enforce `assertEditable`
10. `media.upload` — fix validation/review status; add idempotency key