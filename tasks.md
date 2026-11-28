# MCP Pipeline State Fix — Implementation Tasks

**Source design:** `docs/MCP_PIPELINE_STATE_FIX_DESIGN.md`
**Scope:** Three confirmed code defects — Fix B (workflow step states), Fix C (actionable error + tool descriptions), Fix D (read side effect).
**Hard constraints (carry forward):**
- Do NOT modify project `6b0ad8322a2fc3703d530906` or bible `6b0ad8ae5bfa0b00c806923b` except to correct state, and only after telling the user.
- Do NOT call `pipeline.start`, any generation tool, or anything that renders/generates audio/video or consumes paid credits.
- Keep changes minimal and focused on B, C, D. No unrelated refactors.
- No `any` type. TypeScript strict mode. kebab-case dot-notation filenames. dot-notation log event names.

**Task ordering rationale:** Type changes precede logic changes precede wiring precede tests precede full verification. Fix B is sequenced first because its type extension (`WorkflowSignals` adds 5 required fields) breaks compilation until every caller is updated, so all Fix B source tasks (T1–T4) must land before the test suite can typecheck. Fix C and Fix D source changes are independent of Fix B and of each other, so they follow. Test tasks are grouped after all source changes they depend on. A final verification task runs `npm run typecheck` and `npm test`.

---

## Phase 1 — Fix B: Workflow Step States Reflect Real Artifacts (Source)

### T1 — Extend `WorkflowStepState` and `WorkflowSignals` types in `lib/domain/workflow.ts`
**Description:** Add the `"skipped"` member to the `WorkflowStepState` union and add 5 required fields to the `WorkflowSignals` type. Add the `ProductionMode` type import. These are the foundational type changes that every subsequent Fix B task depends on.

**Files / functions to modify:**
- `lib/domain/workflow.ts`
  - Line 1: add `import type { ProductionMode } from "@/lib/domain/projectCatalog";` (alongside the existing `ProjectStatus` import).
  - Lines 79–83 (`WorkflowStepState` type): add `| "skipped"` to the union.
  - Lines 107–133 (`WorkflowSignals` type): add 5 required fields — `charactersApproved: boolean`, `scenesApproved: boolean`, `episodesExist: boolean`, `productionMode: ProductionMode`, `canonCommitted: boolean` — each with a JSDoc comment describing its source (per design §3.2.1).

**Acceptance criteria:**
- `WorkflowStepState` is a 5-member union: `"completed" | "awaiting_approval" | "current" | "upcoming" | "skipped"`.
- `WorkflowSignals` has all original fields plus the 5 new required fields (none optional).
- `ProductionMode` is imported from `@/lib/domain/projectCatalog` (values: `"standalone" | "serialized" | "anthology"`).
- No `any` type used.

**Dependencies:** None.

---

### T2 — Add `isStageSkipped()`, `isStageCompleted()`, and `deriveStepState()` pure functions in `lib/domain/workflow.ts`
**Description:** Add three new pure functions that implement the per-stage artifact-existence predicates and the state-derivation orchestration. These replace the index-based logic currently inside `workflowSteps()`.

**Files / functions to modify:**
- `lib/domain/workflow.ts` (add new exported functions after the existing `isAwaitingApproval` function, before `workflowSteps`):
  - `isStageSkipped(stage: WorkflowStage, signals: WorkflowSignals): boolean` — returns `true` for `episodes` and `planning` when `signals.productionMode === "standalone"`; `false` for all other stages (per design §3.2.2).
  - `isStageCompleted(stage: WorkflowStage, signals: WorkflowSignals): boolean` — per-stage predicate table from design §3.2.2: `project_setup → true`; `planning → signals.bibleApproved`; `bible → signals.bibleApproved`; `episodes → signals.planApproved && signals.episodesExist`; `characters → signals.charactersApproved`; `scenes → signals.scenesApproved`; `story → storyIsApproved(signals)`; `canon → signals.canonCommitted`; `production_design → signals.productionActive`; `audio → signals.productionActive`; `video → signals.productionActive`; `timeline → signals.productionActive`; `rendering → signals.productionActive && signals.projectStatus === "completed"`.
  - `deriveStepState(stage: WorkflowStage, current: WorkflowStage, signals: WorkflowSignals): WorkflowStepState` — evaluation order: (1) `isStageSkipped` → `"skipped"`; (2) `stage === current` → `isAwaitingApproval(stage, signals) ? "awaiting_approval" : "current"`; (3) `isStageCompleted` → `"completed"`; (4) otherwise → `"upcoming"`.

**Acceptance criteria:**
- All three functions are pure (no side effects, no I/O).
- `isStageSkipped` returns `true` only for `episodes` and `planning` in standalone mode.
- `isStageCompleted` covers all 13 stages in `WORKFLOW_STAGES` (exhaustive switch or lookup).
- `deriveStepState` implements the exact evaluation order: skipped → current/awaiting → completed → upcoming.
- Functions are exported (so they can be unit-tested directly).

**Dependencies:** T1 (uses the extended `WorkflowSignals` and `WorkflowStepState` types).

---

### T3 — Rewrite `workflowSteps()` to use `deriveStepState()` in `lib/domain/workflow.ts`
**Description:** Replace the index-based state-assignment logic in `workflowSteps()` with a call to `deriveStepState()` for each stage. Remove the `currentIndex` computation and the `index < currentIndex` / `index > currentIndex` branches.

**Files / functions to modify:**
- `lib/domain/workflow.ts`, lines 195–211 (`workflowSteps` function):
  - Keep `const current = deriveWorkflowStage(signals);`.
  - Remove `const currentIndex = WORKFLOW_STAGES.indexOf(current);`.
  - Replace the `WORKFLOW_STAGES.map((stage, index) => { ... })` body with: `WORKFLOW_STAGES.map((stage) => ({ stage, label: WORKFLOW_STAGE_LABELS[stage], state: deriveStepState(stage, current, signals) }))`.

**Acceptance criteria:**
- `workflowSteps()` no longer references array indices for state derivation.
- The function signature is unchanged: `workflowSteps(signals: WorkflowSignals): WorkflowStep[]`.
- Returns exactly `WORKFLOW_STAGES.length` (13) entries.
- For the reported project state (standalone, bible approved, no run, no story, no episodes, no characters, no scenes): `planning` and `episodes` are `"skipped"`; `characters` and `scenes` are `"upcoming"`; `story` is `"current"` (per design §3.2.6 expected-outcome table).

**Dependencies:** T2 (calls `deriveStepState`).

---

### T4 — Compute the 5 new signals in `workflowService.get()` in `lib/services/workflowService.ts`
**Description:** Extend the `signals` object construction in `workflowService.get()` to provide the 5 new required `WorkflowSignals` fields, computed from data already fetched by the method (the run, episodes, project). No new database reads are needed.

**Files / functions to modify:**
- `lib/services/workflowService.ts`, lines 152–164 (the `signals: WorkflowSignals = { ... }` object literal):
  - Add `charactersApproved: Boolean(run?.stageResults.characters?.approved)`.
  - Add `scenesApproved: Boolean(run?.stageResults.scenes?.approved)`.
  - Add `episodesExist: episodes.length > 0`.
  - Add `productionMode: project.productionMode`.
  - Add `canonCommitted: Boolean(run?.stageResults.story?.approved && run.stageResults.story?.sourceCanonVersion)`.

**Acceptance criteria:**
- The `signals` object satisfies the full `WorkflowSignals` type (all 5 new fields present).
- No new repository calls or database reads are added — all 5 values are derived from `run`, `episodes`, and `project` which are already fetched earlier in the method.
- `project.productionMode` is passed through directly (it already exists on `ProjectRecord`).

**Dependencies:** T1 (the `WorkflowSignals` type now requires these fields; without T4 the file will not typecheck).

---

## Phase 2 — Fix C: Actionable Error Message and Accurate Tool Descriptions (Source)

### T5 — Rewrite `ownedRun()` error message in `lib/services/pipelineService.ts`
**Description:** Replace the vague error message in `ownedRun()` with an actionable message that names the missing prerequisite ("no production run") and the exact action ("call pipeline.start"). The error code and HTTP status remain unchanged.

**Files / functions to modify:**
- `lib/services/pipelineService.ts`, line 28 (inside `ownedRun`):
  - Old: `throw new StudioError("Start a production before this step", 409, "run_required");`
  - New: `throw new StudioError("No production run exists for this project. Call pipeline.start first to create a production run at the story stage.", 409, "run_required");`

**Acceptance criteria:**
- The error message contains both "No production run exists" and "Call pipeline.start".
- The error code is still `"run_required"` and the HTTP status is still `409`.
- No other behavior in `ownedRun` changes (still calls `deps.runs.findLatest`, still returns the run when found).

**Dependencies:** None.

---

### T6 — Correct 4 MCP tool descriptions in `lib/mcp/server.ts`
**Description:** Rewrite the descriptions of `pipeline.start`, `pipeline.generateStory`, `pipeline.approve`, and `pipeline.advance` to accurately describe their behavior, prerequisites, and gate semantics. These are string-literal documentation changes only — no logic changes.

**Files / functions to modify:**
- `lib/mcp/server.ts`:
  - Line 903 (`pipeline.start` description): replace with the exact text from design §4.2.2 — state that it creates a `ProductionRun` with `currentStage='story'` and `status='running'` but does NOT enqueue any generation job; document guided vs automatic gate behavior.
  - Line 924 (`pipeline.generateStory` description): replace with the exact text from design §4.2.3 — mention the run prerequisite and the `run_required` error code.
  - Line 957 (`pipeline.approve` description): replace with the exact text from design §4.2.4 — clarify that the story gate uses `pipeline.approveStory`.
  - Line 974 (`pipeline.advance` description): replace with the exact text from design §4.2.5 — clarify it is equivalent to `pipeline.approve` with `skipAutoAdvance=true`.

**Acceptance criteria:**
- `pipeline.start` description no longer claims it "kicks off the story → characters → scenes → render workflow"; it explicitly states no job is enqueued.
- `pipeline.generateStory` description mentions the `run_required` error code and the `pipeline.start` prerequisite.
- `pipeline.approve` description references `pipeline.approveStory` for the story gate.
- `pipeline.advance` description states equivalence to `pipeline.approve` with `skipAutoAdvance=true`.
- No tool handler logic is changed — only the description string literals.

**Dependencies:** None.

---

## Phase 3 — Fix D: Remove Read Side Effect from `storyBibleService.get()` (Source)

### T7 — Make `storyBibleService.get()` a pure read returning `null` in `lib/services/storyBibleService.ts`
**Description:** Remove the `saveDraft()` fallback from `get()` so it becomes a pure read. Change the return type to `Promise<StoryBibleRecord | null>`. The `not_found` error is no longer thrown from `get()` — `null` is the signal for absence.

**Files / functions to modify:**
- `lib/services/storyBibleService.ts`, lines 43–52 (`get` method):
  - Remove the `?? await repository.saveDraft(...)` fallback.
  - Remove the `if (!bible) throw new StudioError("Project not found", 404, "not_found");` line.
  - Change to: `async get(actor: RequestAuth, projectId: string): Promise<StoryBibleRecord | null> { requireId(projectId); return repository.findOwned(actor.userId, projectId); }`.

**Acceptance criteria:**
- `get()` performs no database writes (no `saveDraft` call).
- `get()` returns `null` when no bible exists (does not throw `not_found`).
- `get()` still throws `StudioError("That project id is not valid", 400, "invalid_id")` for invalid IDs (via `requireId`).
- The return type is `Promise<StoryBibleRecord | null>`.

**Dependencies:** None.

---

### T8 — Add `storyBibleService.ensureExists()` explicit create-if-absent method in `lib/services/storyBibleService.ts`
**Description:** Add a new `ensureExists()` method that encapsulates the create-if-absent behavior previously hidden inside `get()`. It returns the existing bible if one exists; otherwise creates an empty bible via `saveDraft()` and returns it. It does NOT call `editableProject()` (matching the previous `get()` side-effect behavior, so creating an empty bible is allowed even when the project is busy).

**Files / functions to modify:**
- `lib/services/storyBibleService.ts` (add a new method in the returned service object, after `get`):
  - `async ensureExists(actor: RequestAuth, projectId: string): Promise<StoryBibleRecord>` — calls `requireId(projectId)`, then `repository.findOwned(...)`. If an existing bible is found, return it. Otherwise call `repository.saveDraft(actor.userId, projectId, { premise: "", worldRules: [], themes: [], boundaries: [], canonFacts: [] })`. If `saveDraft` returns null, throw `StudioError("Project not found", 404, "not_found")`. Return the created record.

**Acceptance criteria:**
- `ensureExists()` returns a `StoryBibleRecord` (never null).
- When a bible already exists, `ensureExists()` returns it without calling `saveDraft()`.
- When no bible exists, `ensureExists()` creates an empty one with `draftRevision: 1` and returns it.
- `ensureExists()` does not call `editableProject()` (does not reject busy projects).
- The method is part of the object returned by `createStoryBibleService`.

**Dependencies:** T7 (same file; `get()` must already be a pure read so the two methods have distinct, clear responsibilities).

---

### T9 — Update UI GET route to handle `null` bible in `app/api/projects/[projectId]/story-bible/route.ts`
**Description:** Update the GET handler so it returns `{ bible: null }` when no bible exists, instead of relying on `get()` to create one. The response shape becomes `{ data: { bible: null } }` when absent.

**Files / functions to modify:**
- `app/api/projects/[projectId]/story-bible/route.ts`, line 14 (inside `GET`):
  - Change to: `const bible = await storyBibleService.get(actor, projectId); return jsonData({ bible });` — `bible` may now be `null`, and `jsonData` serializes it as `null`.

**Acceptance criteria:**
- The GET route performs no database writes on a plain page load.
- When no bible exists, the response is `{ data: { bible: null } }` (HTTP 200, not 404).
- When a bible exists, the response is unchanged: `{ data: { bible: <record> } }`.
- The PATCH and POST handlers are not modified.

**Dependencies:** T7 (the route depends on `get()` returning `null` instead of creating/throwing).

---

### T10 — Update `useStoryBible` hook query type to accept `null` in `hooks/useStoryBible.ts`
**Description:** Update the `queryFn` type annotation so the `bible` field is typed as `StoryBibleRecord | null`. The `refetchInterval` logic already handles `undefined` safely via optional chaining, so only the type annotation changes.

**Files / functions to modify:**
- `hooks/useStoryBible.ts`, line 12:
  - Change `api<{ bible: StoryBibleRecord }>` to `api<{ bible: StoryBibleRecord | null }>`.

**Acceptance criteria:**
- The query type allows `bible` to be `null`.
- The `refetchInterval` callback continues to compile (optional chaining `query.state.data?.bible.generationStatus` yields `undefined` when `bible` is `null`, so no polling occurs — no logic change needed).
- No other hook in the file is modified.

**Dependencies:** T7 (the hook type must match the new `get()` return type).

---

## Phase 4 — Fix B: Workflow Tests

### T11 — Update and extend `tests/workflow.test.ts` for Fix B
**Description:** Update the `signals()` test helper to provide the 5 new required `WorkflowSignals` fields with safe defaults. Update existing step-state assertions that change under the new artifact-based logic. Add new tests covering skipped stages, artifact-based completion, and the predicate functions.

**Files / functions to modify:**
- `tests/workflow.test.ts`:
  - Lines 18–32 (`signals()` helper): add defaults `charactersApproved: false`, `scenesApproved: false`, `episodesExist: false`, `productionMode: "serialized"`, `canonCommitted: false`.
  - Lines 111–115 ("marks bible as completed and story as current once bible is approved"): with default `productionMode: "serialized"`, `planning` is completed (not skipped), and `episodes`/`characters`/`scenes` are now `"upcoming"` (not `"completed"`). Add assertions: `episodes.state === "upcoming"`, `characters.state === "upcoming"`, `scenes.state === "upcoming"`.
  - Lines 131–137 ("marks earlier stages as completed when production is active"): set `charactersApproved: true`, `scenesApproved: true`, `episodesExist: true`, `canonCommitted: true` in the signals. Recompute the expected completed-stage count using the new per-stage predicates (with `productionMode: "serialized"`, `productionActive: true`, `projectStatus: "draft"`: completed = project_setup, planning, bible, episodes, characters, scenes, story, canon, audio, video, timeline = 11; `production_design` is current; `rendering` is upcoming because `projectStatus !== "completed"`). Update `toHaveLength(11)`.
  - Add a new describe block "per-stage state derivation (Fix B)" with the 11 tests from design §6.1.1: skipped episodes/planning in standalone mode; episodes upcoming when no artifacts; characters upcoming when no artifacts; scenes upcoming when no artifacts; characters completed when `charactersApproved`; scenes completed when `scenesApproved`; episodes not completed when `planApproved` but no episodes; episodes completed when `planApproved && episodesExist`; rendering completed only when `projectStatus === "completed"`; rendering upcoming when production active but not completed; skipped takes precedence over completed.
  - Add a new describe block "isStageCompleted and isStageSkipped predicates" with direct unit tests for each predicate function (true and false cases for each stage), per design §6.1.2. Import `isStageCompleted` and `isStageSkipped` from `@/lib/domain/workflow`.

**Acceptance criteria:**
- The `signals()` helper satisfies the full `WorkflowSignals` type (compiles without errors).
- All updated existing assertions match the new artifact-based logic.
- The 11 new step-state tests pass.
- The predicate unit tests pass.
- `npm test -- tests/workflow.test.ts` passes.

**Dependencies:** T1, T2, T3 (tests use the new types, predicates, and rewritten `workflowSteps`).

---

### T12 — Update `tests/workflow-stepper-regression.test.ts` for Fix B
**Description:** Update the `signals()` helper with the 5 new fields. Update the mock run in the "fully completed" test to include `approved: true` on `stageResults.characters` and `stageResults.scenes` so the new signals are realistic. The generic array-length and type-of-string assertions do not need logic changes.

**Files / functions to modify:**
- `tests/workflow-stepper-regression.test.ts`:
  - Lines 43–57 (`signals()` helper): add the same 5 defaults as T11 (`charactersApproved: false`, `scenesApproved: false`, `episodesExist: false`, `productionMode: "serialized"`, `canonCommitted: false`).
  - Lines 122–141 (mock `run` in "fully completed" test): add `approved: true` to `stageResults.characters` and `stageResults.scenes` (currently empty objects `{}`) so the `charactersApproved`/`scenesApproved` signals compute to `true` for a fully completed project. Also add `sourceCanonVersion` to `stageResults.story` if needed for `canonCommitted` realism.
  - The "always returns an array with one entry per stage" test (lines 60–70) needs no change — it only checks `typeof step.state === "string"`, which remains true for `"skipped"`.

**Acceptance criteria:**
- The `signals()` helper satisfies the full `WorkflowSignals` type.
- The mock run in the "fully completed" test has realistic `approved` flags on character and scene stage results.
- `npm test -- tests/workflow-stepper-regression.test.ts` passes.

**Dependencies:** T1, T3, T4 (the regression test exercises `workflowSteps` with the new types and the `workflowService.get()` signal computation).

---

## Phase 5 — Fix D: Story Bible Tests

### T13 — Update and extend `tests/story-bible.test.ts` for Fix D
**Description:** Replace the 3 tests that relied on `service.get()` creating a record with `service.ensureExists()`. Update the owner-scope test to expect `null` instead of `not_found`. Add 4 new tests covering the pure-read behavior and `ensureExists()`.

**Files / functions to modify:**
- `tests/story-bible.test.ts`:
  - Line 92 ("keeps saved drafts out of generation context until explicit approval"): replace `const initial = await service.get(owner, projectId)` with `const initial = await service.ensureExists(owner, projectId)`.
  - Line 108 ("rejects stale approvals after the draft changes"): replace `const initial = await service.get(owner, projectId)` with `const initial = await service.ensureExists(owner, projectId)`.
  - Line 120 ("retains prior approved snapshots as history"): replace `const initial = await service.get(owner, projectId)` with `const initial = await service.ensureExists(owner, projectId)`.
  - Line 133 ("scopes reads, saves, and approvals to the project owner"): change the `service.get(other, projectId)` assertion from `.rejects.toMatchObject({ code: "not_found" })` to `.resolves.toBeNull()` (the repo returns `null` for non-owners, and `get()` no longer throws). Keep the `service.save(other, ...)` assertion unchanged (save still throws `not_found` via `editableProject`).
  - Add 4 new tests per design §6.1.4:
    1. "get returns null when no bible exists" — call `service.get(owner, projectId)` on an empty store; assert returns `null` and `store.row` is `null` (no write).
    2. "get does not create a record as a side effect" — call `service.get` twice; assert `repo.saveDraft` was never called (track via a call counter in the mock).
    3. "ensureExists creates a record when none exists" — call `service.ensureExists(owner, projectId)` on an empty store; assert returns a `StoryBibleRecord` with `draftRevision: 1` and `store.row` is not null.
    4. "ensureExists returns existing record without creating a duplicate" — create a bible via `service.save`, then call `ensureExists`; assert it returns the existing record and `saveDraft` was not called a second time.

**Acceptance criteria:**
- All 3 migrated tests use `ensureExists()` for setup and pass.
- The owner-scope test expects `null` from `get()` for non-owners and passes.
- The 4 new tests pass and verify that `get()` is side-effect-free and `ensureExists()` creates exactly once.
- `npm test -- tests/story-bible.test.ts` passes.

**Dependencies:** T7, T8 (tests exercise the pure `get()` and the new `ensureExists()`).

---

## Phase 6 — Fix C: Pipeline Test

### T14 — Add actionable error message test in `tests/pipeline.test.ts`
**Description:** Add a test that verifies `ownedRun()` (exercised via `generateStory`) throws the new actionable error message when no production run exists. The existing `tests/pipeline.test.ts` already imports `createPipelineService` and has mock infrastructure.

**Files / functions to modify:**
- `tests/pipeline.test.ts` (add a new test in a new or existing describe block):
  - Test name: "ownedRun throws actionable message when no run exists".
  - Setup: create a `createPipelineService` with mock deps where `deps.runs.findLatest` returns `null` (no run) and `deps.projects.findOwned` returns a project with `status: "planning"`.
  - Action: call `service.generateStory(owner, projectId)`.
  - Assert: the rejection message contains "No production run exists" and "Call pipeline.start"; the error `code` is `"run_required"`; the HTTP status is `409`.

**Acceptance criteria:**
- The test verifies both the message content and the error code.
- The test does not call `pipeline.start` or any generation tool (no paid credits, no real LLM).
- `npm test -- tests/pipeline.test.ts` passes.

**Dependencies:** T5 (the test asserts the new error message text).

---

## Phase 7 — Full Verification

### T15 — Run typecheck and full test suite, report results
**Description:** Run the TypeScript type checker to confirm all callers of the changed types (`WorkflowSignals`, `storyBibleService.get()` return type) are updated, then run the complete test suite to confirm no regressions.

**Commands to run (sequentially):**
1. `npm run typecheck` — confirms the compiler finds no errors. This is the primary gate for verifying that all callers of `workflowSteps()` / `WorkflowSignals` / `storyBibleService.get()` have been updated.
2. `npm test` — runs the full Vitest suite. All existing tests (with the updates from T11–T14) and all new tests must pass.
3. `npm run lint` — confirms no lint errors were introduced.

**Acceptance criteria:**
- `npm run typecheck` exits 0 with no errors.
- `npm test` exits 0 with all tests passing (existing updated tests + new tests).
- `npm run lint` exits 0.
- If any failure occurs, report the exact failing test(s) / error(s) and do not mark this task complete until resolved.
- No calls to `pipeline.start`, generation tools, or paid APIs were made during verification.

**Dependencies:** T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14 (all source and test changes must be complete).

---

## Summary Table

| ID | Phase | Fix | Title | Files | Depends on |
|----|-------|-----|-------|-------|------------|
| T1 | 1 | B | Extend `WorkflowStepState` + `WorkflowSignals` types | `lib/domain/workflow.ts` | — |
| T2 | 1 | B | Add `isStageSkipped` / `isStageCompleted` / `deriveStepState` | `lib/domain/workflow.ts` | T1 |
| T3 | 1 | B | Rewrite `workflowSteps()` to use `deriveStepState()` | `lib/domain/workflow.ts` | T2 |
| T4 | 1 | B | Compute 5 new signals in `workflowService.get()` | `lib/services/workflowService.ts` | T1 |
| T5 | 2 | C | Rewrite `ownedRun()` error message | `lib/services/pipelineService.ts` | — |
| T6 | 2 | C | Correct 4 MCP tool descriptions | `lib/mcp/server.ts` | — |
| T7 | 3 | D | Make `storyBibleService.get()` a pure read | `lib/services/storyBibleService.ts` | — |
| T8 | 3 | D | Add `storyBibleService.ensureExists()` | `lib/services/storyBibleService.ts` | T7 |
| T9 | 3 | D | Update UI GET route to handle `null` | `app/api/projects/[projectId]/story-bible/route.ts` | T7 |
| T10 | 3 | D | Update `useStoryBible` hook type | `hooks/useStoryBible.ts` | T7 |
| T11 | 4 | B | Update + extend `tests/workflow.test.ts` | `tests/workflow.test.ts` | T1, T2, T3 |
| T12 | 4 | B | Update `tests/workflow-stepper-regression.test.ts` | `tests/workflow-stepper-regression.test.ts` | T1, T3, T4 |
| T13 | 5 | D | Update + extend `tests/story-bible.test.ts` | `tests/story-bible.test.ts` | T7, T8 |
| T14 | 6 | C | Add actionable error test in `tests/pipeline.test.ts` | `tests/pipeline.test.ts` | T5 |
| T15 | 7 | — | Run typecheck + full test suite + lint | (verification) | T1–T14 |

**Totals:** 15 tasks (10 source, 4 test, 1 verification). 17 files touched (13 source + 4 test). No database migrations. No new environment variables. No paid API calls. No `pipeline.start` or generation invocations.