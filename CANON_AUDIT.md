# CANON AUDIT — AI Drama Studio

**Date**: 2026-11-19
**Scope**: Forensic architecture audit of canon representation, episode approval pipeline, and prompt assembly.
**Status**: Read-only audit. No application code was changed.

---

## Table of Contents

1. [Canon Representations](#1-canon-representations)
2. [Dependency Map](#2-dependency-map)
3. [Episode Approval Pipeline](#3-episode-approval-pipeline)
4. [Prompt Assembly](#4-prompt-assembly)
5. [Confirmed Defects](#5-confirmed-defects)
6. [Proposed Migration Strategy](#6-proposed-migration-strategy)
7. [Architectural Assumptions Requiring Decisions](#7-architectural-assumptions-requiring-decisions)
8. [Diagnostic Script](#8-diagnostic-script)

---

## 1. Canon Representations

The codebase contains **10 distinct canon-related representations**. Four are authoritative, three are derived/cached, and three are defined-but-unused in production (dead storage).

### Summary Table

| # | Representation | Collection | Status | Updated on Approval | Consistency Risk |
|---|---|---|---|---|---|
| 1 | Story Bible | `storyBibles` | Authoritative | No (independent) | Low |
| 2 | ContinuityLedger | `continuityledgers` | Authoritative | Yes (write 4) | Low-Medium |
| 3 | NarrativeCanon (CanonState) | `narrativecanons` | Authoritative | Yes (write 1) | Medium |
| 4 | canonicalEntity | `canonicalEntities` | Derived/cached | Indirectly (stale flag) | Medium |
| 5 | storyEvent | `storyEvents` | Derived | Indirectly (approve status) | Low |
| 6 | seasonPlan | `seasonPlans` | Authoritative (once approved) | No (independent) | Low |
| 7 | canonicalRegistry | `canonicalEntityRegistries` | **Dead storage** | No | N/A |
| 8 | narrativeGraph | `narrativeGraphs` | **Dead storage** | No | N/A |
| 9 | narrativeRegistry | `narrativeRegistries` | **Dead storage** | No | N/A |
| 10 | episode | `episodes` | Production tracking | Yes (status update) | Low |

### 1.1 Story Bible — AUTHORITATIVE

- **Storage**: `lib/models/storyBible.ts` → MongoDB collection `storyBibles`
- **Schema**: `StoryBibleContent` with sections `identity`, `world`, `characters`, `narrative`, `guidelines`, `canon`. Legacy flat fields (`premise`, `worldRules[]`, `canonFacts[]`). Immutable `approvedSnapshot` at approval time.
- **Repository**: `lib/repositories/storyBibleRepository.ts`
- **Readers**: 15+ modules including `pipelineService`, `casnaContext`, `projectCanon`, `screenplayValidation`, `seasonPlanEngine`, `storyDraftEngine`.
- **Writers**: `storyBibleRepository.approve/saveDraft/completeGeneration`
- **Prompt builders**: `storyBibleTask.ts`, `storyBibleSections.ts` (`renderStoryBibleBrief`), `seasonPlanTask.ts`
- **Updated on episode approval**: No. Approved independently via `storyBibleRepository.approve()`.
- **Consistency risk**: Low. Root source of truth. `approvedVersion` is immutable. Gates detect version mismatches.

### 1.2 ContinuityLedger — AUTHORITATIVE

- **Storage**: `lib/models/continuityLedger.ts` → MongoDB collection `continuityledgers`
- **Schema** (`lib/validation/continuityLedger.ts`): `events[]`, `characterStates[]`, `locationStates[]`, `objectStates[]`, `revealedSecrets[]`, `unresolvedThreads[]`, `consequences[]`, `timelineNotes`. Record: `asOfEpisode`, `basedOnPlanVersion`, `version`.
- **Repository**: `lib/repositories/continuityLedgerRepository.ts` — `upsert`, `findLatest`
- **Readers**: 18+ modules including `continuityService`, `casnaContext`, `projectCanon`, `screenplayValidation`, `episodeCanon`, `ledger`, `continuityChecks`.
- **Writers**: `continuityLedgerRepository.upsert` (called from `continuityService.onEpisodeApproved`)
- **Prompt builders**: `casnaContext.ts` (`compactCasnaPromptContext`), `seasonPlanEngine.ts`, `canonExtractionTask.ts`
- **Updated on episode approval**: Yes. Primary write target. `onEpisodeApproved` → `extractEpisodeCanon` → `applyCanonToLedger` → `ledgers.upsert`.
- **Consistency risk**: Low-Medium. Idempotency guard prevents double-application. Rollback on failure. Can become stale relative to Season Plan if plan is revised after episodes are approved.

### 1.3 NarrativeCanon (CanonState) — AUTHORITATIVE

- **Storage**: `lib/models/narrativeCanon.ts` → MongoDB collection `narrativecanons` (append-only versions)
- **Schema** (`lib/validation/narrativeControl.ts`): `entities[]`, `relationships[]`, `events[]`, `threads[]`, `facts[]`, `knowledge[]`, `rules[]`. Versioned with `basedOnBibleVersion`, `basedOnPlanVersion`.
- **Repository**: `lib/repositories/narrativeCanonRepository.ts` — `latest`, `at`, `commit` (optimistic concurrency)
- **Readers**: 12+ modules including `pipelineService`, `storyDraftService`, `screenplayValidation`, `narrativeControl/context.ts`, `narrativeControl/orchestrator.ts`.
- **Writers**: `narrativeCanonRepository.commit` (called from `resolveWorkingCanon` during `enforceStoryCanon`)
- **Prompt builders**: `narrativeControl/context.ts` (`renderNarrativeContext`, `assembleNarrativeContext`)
- **Updated on episode approval**: Yes. `enforceStoryCanon` → `resolveWorkingCanon` → `narrativeCanonRepository.commit`. Creates new append-only version, then `markStaleCanonArtifacts`.
- **Consistency risk**: Medium. `mergeDerivedCanon` is additive — stored canon wins on conflicts; derived facts from newer bible/ledger are added but never replace committed facts. Can accumulate superseded facts.

### 1.4 canonicalEntity — DERIVED/CACHED

- **Storage**: `lib/models/canonicalEntity.ts` → MongoDB collection `canonicalEntities`
- **Schema**: `entityType`, `name`, `visualProfile`, `status`, `appearances[]`, `sourceCanonVersion`, `canonStale`
- **Repository**: `lib/repositories/canonicalEntityRepository.ts`
- **Readers**: `visualAssetService`, `ttsOrchestrationService`, `continuityRepository`, `artifactProvenanceRepository`
- **Writers**: `continuityRepository.persistCharacters/persistSceneCanon`, `canonicalEntityRepository.create/updateVisualProfile/approve`
- **Updated on episode approval**: Indirectly. `markStaleCanonArtifacts` stamps `canonStale: true` when canon advances. Flag is advisory — nothing auto-re-extracts.
- **Consistency risk**: Medium. Stale entities remain usable until creator reviews.

### 1.5 storyEvent — DERIVED

- **Storage**: `lib/models/storyEvent.ts` → MongoDB collection `storyEvents`
- **Schema**: `productionRunId`, `episodeNumber`, `sceneNumber`, `title`, `description`, `characterNames[]`, `locationName`, `status`
- **Repository**: `lib/repositories/continuityRepository.ts`
- **Readers**: `continuityRepository.getPriorEpisodeContext` → `liveEngines.ts`
- **Writers**: `continuityRepository.persistSceneCanon/syncSceneEvent/approveScenesForRun`
- **Updated on episode approval**: `approveScenesForRun` marks scene events as approved.
- **Consistency risk**: Low. Directly tied to screenplay scenes.

### 1.6 seasonPlan — AUTHORITATIVE (once approved)

- **Storage**: `lib/models/seasonPlan.ts` → MongoDB collection `seasonPlans`
- **Schema** (`lib/validation/seasonPlan.ts`): `seasonObjective`, `episodeProgression[]`, `importantRevelations[]`, `unresolvedQuestions[]`, etc. Record: `basedOnBibleVersion`, `version`, `status`.
- **Repository**: `lib/repositories/seasonPlanRepository.ts`
- **Readers**: 12+ modules.
- **Writers**: `seasonPlanService.update/approve`, `seasonPlanEngine` (via `plans.insert`)
- **Updated on episode approval**: No. Approved independently.
- **Consistency risk**: Low. `basedOnBibleVersion` and `planGate` detect staleness.

### 1.7 canonicalRegistry — DEAD STORAGE

- **Storage**: `lib/models/canonicalRegistry.ts` → MongoDB collection `canonicalEntityRegistries`
- **Schema**: `entities[]`, `lifecycles[]`, `basedOnBibleVersion`, `basedOnPlanVersion`, `version`
- **Repository**: `lib/repositories/canonicalRegistryRepository.ts` — `upsert`, `findLatest`
- **Production readers**: **None.** **Production writers**: **None.**
- **Status**: Full schema, repository, and domain builders exist, but `upsert` has zero callers. Domain logic (`buildRegistry`) builds in-memory for validation only. Never persisted.
- **Consistency risk**: N/A (never populated).

### 1.8 narrativeGraph — DEAD STORAGE

- **Storage**: `lib/models/narrativeGraph.ts` → MongoDB collection `narrativeGraphs`
- **Schema**: `nodes[]` (16 types including story_event, clue, revelation, character_knowledge, etc.), `edges[]`, `asOfEpisode`, `version`
- **Repository**: `lib/repositories/narrativeGraphRepository.ts` — `upsert`, `findLatest`
- **Production readers**: **None.** **Production writers**: **None.**
- **Status**: Domain functions exist and are tested, but never called in production pipeline.
- **Consistency risk**: N/A (never populated).

### 1.9 narrativeRegistry — DEAD STORAGE

- **Storage**: `lib/models/narrativeRegistry.ts` → MongoDB collection `narrativeRegistries`
- **Schema** (`lib/validation/narrativeEngine.ts`): `entities[]`, `events[]`, `relationships[]`, `threads[]`, `episodeStates[]`, `causalLinks[]`
- **Repository**: `lib/repositories/narrativeRegistryRepository.ts` — `upsert`, `findLatest`
- **Production readers**: **None.** **Production writers**: **None.**
- **Status**: Narrative engine builds in-memory for validation, never persists.
- **Consistency risk**: N/A (never populated).

### 1.10 episode — PRODUCTION TRACKING

- **Storage**: `lib/models/episode.ts` → MongoDB collection `episodes`
- **Schema**: `episodeNumber`, `status`, `currentStoryId`, `baseSnapshotVersion`, `basePlanVersion`
- **Updated on episode approval**: Yes (`updateStatus` → `story_approved`).
- **Consistency risk**: Low. References canon versions but is not canon itself.

---

## 2. Dependency Map

### Canon Readers and Writers

```
                    ┌─────────────────┐
                    │   Story Bible    │ AUTHORITATIVE
                    │  (storyBibles)   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Season Plan     │ AUTHORITATIVE (once approved)
                    │ (seasonPlans)    │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
┌────────▼────────┐ ┌────────▼────────┐ ┌────────▼────────┐
│ ContinuityLedger │ │ NarrativeCanon  │ │  canonicalEntity │
│ (continuityLedgers)│ │ (narrativeCanons)│ │ (canonicalEntities)│
│  AUTHORITATIVE   │ │  AUTHORITATIVE   │ │   DERIVED/CACHED  │
└────────┬────────┘ └────────┬────────┘ └───────────────────┘
         │                   │
         │    ┌──────────────┘
         │    │
┌────────▼────▼────────┐
│   Prompt Assembly     │
│ (casnaContext.ts +    │
│  narrativeControl/    │
│  context.ts)          │
└──────────────────────┘
         │
┌────────▼────────┐
│   LLM Provider     │
└───────────────────┘

DEAD STORAGE (never populated in production):
  - canonicalRegistry (canonicalEntityRegistries)
  - narrativeGraph (narrativeGraphs)
  - narrativeRegistry (narrativeRegistries)
```

### Write Paths

| Representation | Write Path | Trigger |
|---|---|---|
| Story Bible | `storyBibleRepository.approve/saveDraft` | Bible approval/generation |
| Season Plan | `seasonPlanRepository.insert/approve` | Plan approval/generation |
| ContinuityLedger | `continuityLedgerRepository.upsert` | Episode approval (`onEpisodeApproved`) |
| NarrativeCanon | `narrativeCanonRepository.commit` | Episode approval (`enforceStoryCanon`) + story draft approval |
| canonicalEntity | `continuityRepository.persistCharacters/persistSceneCanon` | `character.extract` / `scene.breakdown` jobs |
| storyEvent | `continuityRepository.persistSceneCanon/syncSceneEvent` | `scene.breakdown` job |
| canonicalRegistry | **NONE** | — |
| narrativeGraph | **NONE** | — |
| narrativeRegistry | **NONE** | — |

---

## 3. Episode Approval Pipeline

### 3.1 Entry Point

```
POST /api/projects/[projectId]/stories/[storyId]/approve
  → pipelineService.approveStory(actor, projectId, storyId)
```

### 3.2 Sequence Diagram (First-Approval Path)

```
User approves screenplay
        │
        ▼
approveStory()
        │
        ├─ [1] Load run, story, verify ownership
        │
        ├─ [2] enforceStoryCanon() ──────────────────────────┐
        │       │                                               │
        │       ├─ Load approved bible                          │
        │       ├─ Build working canon (bible + stored canon)  │
        │       ├─ Load CASNA context (plan, ledger, prev eps) │
        │       ├─ validateEpisodeScreenplay()                 │
        │       │                                               │
        │       ├─ IF validation FAILS → throw story_invalid   │
        │       │                                               │
        │       └─ IF validation PASSES:                       │
        │           ├─ WRITE 1: narrativeCanonRepository.commit() │
        │           │           → markStaleCanonArtifacts()     │
        │           └─ WRITE 2: stories.recordCanonVersion()   │
        │                                                       │
        ├─ [3] acceptStory() ◄─────────────────────────────────┘
        │       │
        │       ├─ WRITE 3: stories.markApproved()
        │       │
        │       ├─ onEpisodeApproved() ─────────────────┐
        │       │       │                               │
        │       │       ├─ Load approved plan           │
        │       │       ├─ Load existing ledger         │
        │       │       ├─ Idempotency check            │
        │       │       ├─ extractEpisodeCanon()        │
        │       │       ├─ applyCanonToLedger()         │
        │       │       │                               │
        │       │       ├─ WRITE 4: ledgers.upsert()    │
        │       │       ├─ WRITE 5: stories.saveCanonSummary() │
        │       │       └─ WRITE 6: stories.markStaleByCanonVersion() │
        │       │                               │       │
        │       │       IF FAILS: ◄─────────────┘       │
        │       │       └─ stories.revertApproval()     │
        │       │           (reverts ONLY write 3)      │
        │       │                                       │
        │       ├─ WRITE 7: episodes.updateStatus()     │
        │       ├─ WRITE 8: projects.update()           │
        │       ├─ WRITE 9: runs.save()                 │
        │       └─ WRITE 10: enqueueForRun("character.extract") │
        │
        ▼
    Return { story, job }
```

### 3.3 Write Ordering

| # | Operation | Collection | Atomic? |
|---|---|---|---|
| 1 | `narrativeCanonRepository.commit` | `narrativecanons` | Doc-level; optimistic version check |
| 2 | `stories.recordCanonVersion` | `stories` | Yes (single `updateOne`) |
| 3 | `stories.markApproved` | `stories` | Yes (conditional `findOneAndUpdate`) |
| 4 | `ledgers.upsert` | `continuityledgers` | Doc-level; version is read-then-write |
| 5 | `stories.saveCanonSummary` | `stories` | Yes (single `findOneAndUpdate`) |
| 6 | `stories.markStaleByCanonVersion` | `stories` | Yes (single `updateMany`) |
| 7 | `episodes.updateStatus` | `episodes` | Yes |
| 8 | `projects.update` | `projects` | Yes |
| 9 | `runs.save` | `productionruns` | Yes |
| 10 | `enqueueForRun` | `generationjobs` + Redis | Job insert atomic; BullMQ best-effort |

### 3.4 Transaction Analysis

**There is NO MongoDB session or transaction wrapping the approval flow.** All 10 writes are independent single-document operations. A crash between any two writes leaves the system in a partially-applied state.

### 3.5 Failure Recovery Analysis

| Crash Point | State | Recoverable? |
|---|---|---|
| After write 1-2, before write 3 | Canon committed; story still `awaiting_approval` | **Yes** — re-approval re-runs idempotently |
| After write 3, before write 4 | Story `approved`; no ledger | **Yes** — `onEpisodeApproved` creates ledger |
| After write 4, before write 5 | Ledger written; story has no `canonSummary` | **NO** — idempotency guard blocks re-run. Permanent inconsistency. |
| After write 5, before write 6 | Ledger + summary done; downstream drafts not stale | **NO** — idempotency guard blocks re-run. Drafts remain falsely fresh. |
| After write 6-9 | All canon writes done; downstream not enqueued | **Yes** — re-approval is idempotent for remaining writes |
| After write 10 (job insert, before Redis) | Job in Mongo, not in Redis | **Yes** — `reconcileOpenJobs` re-enqueues on worker startup |

**The two unrecoverable cases** stem from the idempotency guard in `onEpisodeApproved` (`continuityService.ts:265-267`): `existing.asOfEpisode >= episodeNumber`. Once the ledger is written, the guard short-circuits all re-approval attempts, so `saveCanonSummary` and `markStaleByCanonVersion` are permanently skipped if they didn't complete.

### 3.6 Rollback Limitations

`revertApproval` reverts ONLY the story status (write 3). It does NOT revert:
- Write 1 (narrative canon commit) — already committed before `acceptStory`
- Write 2 (recordCanonVersion) — same
- Partial writes inside `onEpisodeApproved` (if ledger succeeded but summary failed)

---

## 4. Prompt Assembly

### 4.1 Sources in the Episode Generation Prompt

The final user prompt (`lib/providers/llm/prompt.ts:27-88`) assembles these sources in order:

| # | Source | Label | File:Line |
|---|---|---|---|
| 1 | Content category + project metadata | — | `prompt.ts:29-40` |
| 2 | Story Bible | "authoritative — follow ... exactly" | `prompt.ts:46-48` |
| 3 | Narrative Authority (CanonState) | "NARRATIVE AUTHORITY" | `prompt.ts:49-51` |
| 4 | Continuity context | "follow these established facts" | `prompt.ts:52-54` |
| 5 | Season Plan | "your episode must serve it" | `prompt.ts:55-57` |
| 6 | Episode Plan | "write exactly this episode" | `prompt.ts:58-60` |
| 7 | Continuity Ledger | "Established canon ... never contradict it" | `prompt.ts:61-63` |
| 8 | Previous episode (synopsis only) | "Continue from that ending" | `prompt.ts:64-66` |
| 9 | Project idea + episode premise | — | `prompt.ts:73-74` |

### 4.2 Multiple Independent Authorities

The prompt labels **three separate sources as authoritative** with no precedence rule between them:
- Story Bible ("authoritative — follow ... exactly")
- Narrative Authority / CanonState ("NARRATIVE AUTHORITY. The application owns canon.")
- Continuity Ledger ("Established canon ... never contradict it")

When these overlap or disagree, the LLM receives no guidance on which authority wins.

### 4.3 Truncation

All truncation is **recency-based `.slice(-N)`**, not relevance-based:
- Events: last 8
- Character knowledge: last 6 per character
- Character beliefs: last 4
- Location/object states: last 10
- Revealed secrets: last 8
- Unresolved threads: non-resolved, last 6
- Consequences: last 8

**No input-token budget exists.** `budget.ts` only manages output token ceiling. The prompt can grow unbounded; the only cap is the provider's context window.

### 4.4 Hidden Truth Inconsistency

Hidden truths reach the prompt through **two paths with inconsistent filtering**:
- **Path A** (`bibleContext`): includes ALL hidden information labelled "not yet revealed to audience" with no reveal-episode filtering.
- **Path B** (`narrativeAuthority`): correctly filters by `audienceRevealEpisode`.

A revealed secret can appear as both "not yet revealed" (Path A) and "known" (Path B) in the same prompt.

### 4.5 Previous Episode Context

- **Generation prompt**: only the immediately previous episode's `{episodeNumber, title, synopsis}` — a single synopsis paragraph. No screenplay text.
- **Full previous screenplays**: loaded with `withScreenplays: true` but **never sent to the LLM**. Used only by `validateEpisodeScreenplay` for repetition jaccard checks.
- **Continuation prompt** (multi-round): drops `seasonPlan`, `episodePlan`, `continuityLedger`, `previousEpisode`, `narrativeAuthority`, and `bibleContext`. Only carries `continuityContext` and `idea`.

### 4.6 Plan vs Fact Conflation

- `episodePlan` is passed unprojected with past-tense field names (`consequencesCreated`, `informationRevealed`) that imply completed actions.
- No "these are proposals, not established canon" caveat in the prompt text.
- `deriveEpisodePlan` mixes ledger-derived and plan-derived content in the same `EpisodePlan` object.

### 4.7 Dropped Information

- `events` projection drops `affectedCharacters` and `revealedInformation`.
- `unresolvedThreads` projection drops `introducedInEpisode` and `status` (LLM cannot distinguish "open" from "developing").
- `timelineNotes` omitted entirely.

---

## 5. Confirmed Defects

| # | Defect | Source File | Severity |
|---|---|---|---|
| D1 | **No transaction in approval pipeline** — 10 independent writes, crash leaves partial state | `lib/services/pipelineService.ts:50-107` | High |
| D2 | **Two unrecoverable crash windows** — between ledger upsert and saveCanonSummary / markStaleByCanonVersion, idempotency guard blocks re-run | `lib/services/continuityService.ts:265-267` | High |
| D3 | **Rollback only reverts story status** — does not undo canon commit, recordCanonVersion, or partial ledger writes | `lib/services/pipelineService.ts:74-83` | High |
| D4 | **Multiple independent authorities in prompt** — Bible, CanonState, and Ledger all labelled "authoritative" with no precedence rule | `lib/providers/llm/prompt.ts:47,53,62` | High |
| D5 | **Hidden truth inconsistency** — bibleContext includes all hidden info as "not yet revealed" regardless of reveal status; narrativeAuthority correctly filters | `lib/providers/llm/storyBibleSections.ts:347-353` vs `lib/domain/narrativeControl/context.ts:31-37` | Medium |
| D6 | **Story Bible sent up to 3 times** in the same prompt (bibleContext, continuityContext, narrativeAuthority) | `lib/pipeline/liveEngines.ts:120-125,167` | Medium |
| D7 | **No input-token budget** — prompt can grow unbounded; only output budget exists | `lib/providers/llm/budget.ts` | Medium |
| D8 | **FIFO truncation** — `.slice(-N)` drops oldest entries regardless of relevance; critical old facts (deaths, transfers) can be lost | `lib/pipeline/casnaContext.ts:75-114` | Medium |
| D9 | **Previous screenplays loaded but never sent to LLM** — only synopsis paragraph reaches prompt | `lib/pipeline/liveEngines.ts:90` | Medium |
| D10 | **Continuation prompt drops canon context** — multi-round continuations lose all canon constraints | `lib/providers/llm/continuation.ts:67-98` | Medium |
| D11 | **Plan-derived content mixed with ledger-derived** in `EpisodePlan` with no distinction | `lib/domain/episodePlan.ts:26-59` | Medium |
| D12 | **Three dead storage collections** — canonicalRegistry, narrativeGraph, narrativeRegistry have schemas/repos but zero production writers | `lib/models/canonicalRegistry.ts`, `lib/models/narrativeGraph.ts`, `lib/models/narrativeRegistry.ts` | Low |
| D13 | **`mergeDerivedCanon` is additive** — stored canon wins on conflicts; old committed facts remain alongside new derived ones | `lib/domain/narrativeControl/canonResolution.ts` | Low |
| D14 | **`enforceStoryCanon` writes BEFORE `markApproved`** — crash leaves committed canon for unapproved story | `lib/services/pipelineService.ts:710-725` | Low |
| D15 | **CASNA context load is best-effort** — if `deps.casna.load` throws, validation falls back to canon-only, skipping ledger/plan checks | `lib/services/pipelineService.ts:678-694` | Medium |
| D16 | **`storyDraftService` also commits canon** — canon can advance outside episode approval flow | `lib/services/storyDraftService.ts` | Low |
| D17 | **Historical prompts not persisted** — only a SHA-256 fingerprint is stored; full prompt text is not recoverable | `lib/models/story.ts:147` | Low |

---

## 6. Proposed Migration Strategy

### Phase 1: Canon Fact Log (Steps 1-2 of spec)

1. Create `lib/canon/` domain module with `CanonFact` schema, `CanonStore`, and `reduceCanon()`.
2. Implement evidence-based extraction from approved screenplays (replacing `extractEpisodeCanon`).
3. Wire the controlled commit operation into the approval pipeline.
4. The Canon Fact Log becomes the single persistent authority. ContinuityLedger and CanonState become derived views.

### Phase 2: Verification (Step 3 of spec)

1. Implement dedicated verifier comparing proposed facts against reconstructed CanonState.
2. Replace shallow continuity checks in `screenplayValidation.ts` with the new verifier.
3. Make concrete contradictions block approval (error severity).

### Phase 3: Views and Prompts (Step 4 of spec)

1. Implement purpose-specific view API (`season_planner`, `episode_writer`, `extractor`, `verifier`, `ui`).
2. Replace `compactCasnaPromptContext` and `renderNarrativeContext` with single view-based prompt assembly.
3. Eliminate multiple authoritative labels; establish explicit precedence.

### Phase 4: Migration (Step 5 of spec)

1. Seed Canon Fact Log from approved Story Bible as episode-zero `seed` facts.
2. Re-extract facts from existing approved screenplays in chronological order.
3. Compare with old ContinuityLedger and CanonState; report differences.
4. Preserve original records for rollback.

### Phase 5: Legacy Consolidation (Step 6 of spec)

1. Remove independent writes to ContinuityLedger and CanonState.
2. Demote canonicalRegistry, narrativeGraph, narrativeRegistry (already dead — remove or formally deprecate).
3. Replace old read paths with CanonStore and views.
4. Remove plan-derived canon functions.

### Phase 6: End-to-End Regression (Step 7 of spec)

1. Three-episode fixture with established events (death, object loss, location destruction).
2. Contradictory Episode 3 drafts must be blocked.
3. Legitimate exceptions (flashbacks, lies, speculation) must not block.
4. Prompt correctness, commit correctness, and model provenance verified.

### Migration Principles

- **Never delete old records during migration.** Preserve for rollback and audit.
- **Never silently promote uncertain interpretations.** Flag for human review.
- **Never use plan-derived facts as screenplay evidence.**
- **Migration must be resumable after interruption.**
- **Duplicate migration attempts must not duplicate facts.**

---

## 7. Architectural Assumptions Requiring Decisions

| # | Assumption | Question |
|---|---|---|
| A1 | **MongoDB transactions available?** | The current code has no sessions/transactions. The spec requires atomic commit or a tested recovery protocol. Does the deployment support replica set transactions? If not, we must implement an explicit recoverable commit protocol. |
| A2 | **LLM provider for extraction** | The spec requires structured-output LLM for evidence-based extraction. Which provider/model? The spec says to remove `gemma3:4b`. What model supports reliable structured output for canon extraction? |
| A3 | **LLM provider for contradiction criticism** | Same question for the verifier's LLM critic. Which model? |
| A4 | **Existing data migration scope** | How many existing projects have approved episodes that need migration? Is there a production database with real user data, or is this pre-production? |
| A5 | **ContinuityLedger backward compatibility** | The spec says ContinuityLedger becomes a "derived compatibility view during migration." How long must we maintain backward compatibility? Can we eventually remove it, or must it persist indefinitely for existing API consumers? |
| A6 | **canonicalRegistry/narrativeGraph/narrativeRegistry** | These are dead storage. Should we remove them entirely, or formally deprecate them? Are there any planned features that would wire them in? |
| A7 | **Token budget approach** | The spec requires relevance-based selection with a tokenizer or conservative estimator. Should we use an existing tokenizer (e.g., `tiktoken` for OpenAI, `@google/generative-ai` token counting) or implement a conservative character-based estimator? |
| A8 | **Historical prompt persistence** | The spec requires reporting "the exact historical LLM prompt, if persisted." Currently only a fingerprint is stored. Should we start persisting full prompts? If so, where (MongoDB, file system, object storage)? |
| A9 | **Branch strategy** | The spec says "Work in an isolated Git worktree or dedicated branch." Should we create a `canon-rebuild` branch? The previous work was committed to `master`. |
| A10 | **`storyDraftService` canon commits** | `storyDraftService` also commits canon via `resolveWorkingCanon`. Should the new architecture allow canon commits outside episode approval, or should all canon commits go through the episode approval flow only? |
| A11 | **Narrative mode detection** | The spec requires distinguishing flashback, dream, vision, etc. How should narrative mode be detected? LLM-based scene classification? Scene heading parsing (e.g., "INT. HOUSE - FLASHBACK")? Explicit creator annotation? |
| A12 | **Evidence quote exactness** | The spec requires evidence quotes to be exact substrings of the screenplay text. Screenplay text is stored as structured `ScreenplayScene[]` with separate fields. What constitutes the "screenplay text" for substring matching — the raw JSON, a formatted rendering, or field-by-field matching? |

---

## 8. Diagnostic Script

A read-only diagnostic script has been created at `scripts/diagnose-canon.ts`.

### Usage

```bash
npx tsx scripts/diagnose-canon.ts --project=<projectId> --episode=<N> [--user=<clerkUserId>]
```

### What it reports

1. The approved Story Bible (version, characters, confirmed facts, hidden information).
2. The approved Season Plan (version, episode-specific plan item).
3. The raw ContinuityLedger (version, events, character states, revealed secrets, threads, consequences).
4. The raw NarrativeCanon / CanonState (version, entities, facts, threads, rules).
5. All episodes and their statuses.
6. The approved story for the specified episode (screenplay text, provider, model, canon summary, validation findings).
7. The plan-derived canon summary (what `extractEpisodeCanon` produces from the screenplay + plan).
8. The derived canon from bible + ledger (what `canonFromApprovedSources` produces).
9. Differences between representations (character name mismatches, plan version mismatches).
10. Historical prompt availability (currently not persisted — reports this limitation).

### Limitations

- Historical LLM prompts are not persisted in the current application. The script reports this and cannot recover them.
- The script requires `MONGODB_URI` environment variable.
- The script is read-only — it does not modify any data or trigger generation/approval.