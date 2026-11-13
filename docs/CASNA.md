# Canon-Aware Sequential Narrative Algorithm (CASNA)

CASNA is the application-level narrative planning and continuity system that
makes a serialized AI Drama Studio season one continuous story instead of a set
of independent episodes written from the same Story Bible.

Status: implemented. Season planning, validation, approval and versioning,
sequential episode generation, episode-specific planning, screenplay validation,
and the Continuity Ledger are live. The boundaries and remaining limitations are
listed at the end.

## Stage map

| Stage | What it does | Where it lives |
| --- | --- | --- |
| A. Approved foundation | Loads the approved Story Draft, Story Bible, characters, world, themes, genre/tone, and creator direction | `lib/pipeline/seasonPlanEngine.ts`, `lib/pipeline/liveEngines.ts` |
| B. Season Plan | Generates the complete episode sequence plan as a run-less background job | `lib/pipeline/seasonPlanEngine.ts`, `lib/providers/llm/seasonPlanTask.ts` |
| C. Season Plan validation | Deterministic continuity, progression, repetition, character, and structure findings | `lib/domain/seasonPlanValidation.ts` |
| D. Creator approval | Explicit approval, manual editing, targeted episode regeneration, versioning | `lib/services/seasonPlanService.ts`, `components/workflow/SeasonPlanEditor.tsx` |
| E. Sequential generation | Episode N is locked until the plan is approved/current and episodes 1..N-1 are approved | `lib/domain/casna.ts`, `lib/services/episodeService.ts`, `lib/services/pipelineService.ts`, `lib/pipeline/casnaContext.ts` |
| F. Episode plan | Derives what the episode inherits and intends, then validates it against the Season Plan | `lib/domain/episodePlan.ts` |
| G. Screenplay | Generates the full screenplay from bible + plan + episode plan + ledger + previous episode | `lib/pipeline/liveEngines.ts`, `lib/providers/llm/prompt.ts` |
| H. Screenplay validation | Canon, continuity, repetition, completeness, and structure findings; targeted scene repair; approval is blocked on errors | `lib/domain/screenplayValidation.ts`, `lib/providers/llm/repairScenes.ts` |
| I. Approval + continuity | Approved episode becomes an authoritative summary and canon ledger update; failures roll the approval back | `lib/services/continuityService.ts`, `lib/domain/episodeCanon.ts`, `lib/domain/ledger.ts` |

## Gates

The backend — not the UI — decides whether generation is allowed.

`episodeGenerationGate` (`lib/domain/casna.ts`) requires, for a serialized drama:

1. An approved Story Bible.
2. An approved Season Plan.
3. That plan was developed from the currently approved Story Bible version
   (`plan_stale` otherwise).
4. No newer Season Plan revision is waiting for approval
   (`plan_revision_pending`).
5. The target episode exists in the approved plan (`plan_episode_missing`).
6. Every earlier episode is approved (`episode_locked`).
7. The Continuity Ledger has caught up with episode N-1 (`episode_locked`).

The same rule set runs in:

- `episodeService.create` / `requestGenerate` (before a job exists),
- `pipelineService.start` (before a run exists),
- `episodeSuggestEngine` (defence in depth against a stale queued job),
- `liveEngines` story generation (before calling a provider).

The floor of the gate is also mirrored in the UI (`workflowService` exposes
`episodes.nextLocked` / `nextLockReason`), but only as display state.

## Season Plan lifecycle

A Season Plan record is append-only per version:

- `awaiting_approval` after generation or a creator edit,
- `approved` by `SeasonPlanRepository.markApproved`, a conditional update that is
  safe under concurrent approval attempts,
- the previous approved record is never deleted or mutated.

Manual edits (`PATCH /api/projects/[id]/season-plan/[planId]`) are validated
immediately, stored as the next version, and use `expectedVersion` as an
optimistic-concurrency guard. Targeted regeneration
(`targetEpisodeNumber`) keeps the rest of the plan and replaces only that
episode's section.

## Continuity Ledger

`continuityLedgers` is an append-only version per project. Each version stores:

- events (with consequence, affected characters, revealed information),
- character states (location, objective, knowledge, beliefs, motivations,
  emotional and physical state, relationships),
- location states and object states,
- revealed secrets,
- unresolved threads with status,
- consequences,
- timeline notes,
- `asOfEpisode` and `basedOnPlanVersion`.

Only `continuityService.onEpisodeApproved` writes it, and it is called only after
the episode's screenplay is approved. The merge is a pure function
(`applyCanonToLedger`), and the update is idempotent per episode so a retried
approval cannot duplicate canon.

### Established canon vs proposed developments

Established canon lives in the ledger. Proposed developments live on the
unapproved story draft's episode plan. `GET /api/projects/[id]/continuity`
returns them separately (`ledger` and `proposedDevelopments`); the Continuity
view labels proposals as awaiting approval. A draft is never merged into the
ledger, and a failed approval rolls the story back to `awaiting_approval`.

### Rebuilding legacy continuity

Seasons produced before CASNA have approved episodes but no ledger.
`POST /api/projects/[id]/continuity/rebuild` replays only approved episodes and
their approved Season Plan entries in order, and writes one ledger version.
`dryRun: true` previews the result without writing. The Continuity view shows the
rebuild action whenever approved episodes exist without a ledger, so an existing
project is not locked out of episode N+1.

### Structured canon deltas

Each per-episode plan entry carries optional, creator-approved deltas:
`characterArcChanges`, `relationshipChanges`, `objectChanges`, and
`locationChanges`. On approval these map deterministically into character
relationships, object ownership/condition, and location state in the ledger. No
extra model call is needed, and the creator approves the deltas with the plan.

## Repair and semantic validation

- **Targeted repair.** When Stage H finds an error that names a scene, the
  engine asks the provider to rewrite only those scenes (`repairScenes`),
  merges them back, and revalidates. At most two repair rounds are attempted;
  if they do not resolve the findings, the existing bounded full regeneration
  takes over. Repair attempts and outcomes are stored as `repairHistory`.
- **Capability-aware failover.** Season planning, repair, and critique select
  only providers that implement the capability, so a local Ollama primary does
  not block a Gemini planner.
- **Advisory continuity critic.** With `CASNA_SEMANTIC_VALIDATION=1`, one extra
  structured pass looks for timeline and character-knowledge contradictions.
  Its findings are always saved as warnings and never block approval; the
  deterministic checks remain the gate. If the critic fails, generation
  continues unaffected.
- **Manual editing.** `PATCH /api/projects/[id]/stories/[storyId]` accepts a
  creator's edited screenplay while it is awaiting approval, revalidates it
  against the same canon, and saves the findings. Approved screenplays are
  immutable; a changed episode must be regenerated.
- **Repetition detection.** Scene/synopsis/plan similarity uses word bigrams,
  and the plan validator also checks for reused endings and repeatedly revealed
  information.

## Version relationships

```
Story Draft (version) ──► Story Bible (approvedVersion, fingerprint)
                              │
                              ▼
                        Season Plan (version, basedOnBibleVersion, basedOnBibleFingerprint)
                              │
                              ▼
                        Episode (baseSnapshotVersion, basePlanVersion)
                              │
                              ▼
                        Story screenplay (plan, validationFindings, canonSummary)
                              │
                              ▼
                        Continuity Ledger (version, asOfEpisode, basedOnPlanVersion)
```

When the Story Bible changes, the approved plan is `plan_stale`, the workflow
returns to the plan stage, and episode generation is locked until the plan is
re-approached. When a plan revision is approved, episodes created from an older
plan are flagged for continuity review (`episodeNeedsPlanReview`).

## Reliability

- Stage dependencies are enforced in services and the pipeline, not only in the UI.
- Duplicate generation is prevented by an open-job check plus the unique
  `idempotencyKey` index; a race returns the winning job.
- A screenplay that fails Stage H is still saved so the work is not thrown away,
  but it is never reported as a successful generation and it cannot be approved.
- Scene-scoped failures are repaired in place (bounded), preserving the rest of
  the screenplay. Unrepairable failures fall back to the job's bounded retry.
- Canon is applied only after approval; a ledger write failure reverts the story
  approval and returns `canon_update_failed`.
- A ledger can be rebuilt from approved material for seasons that predate CASNA.
- Model output is validated with Zod (and the provider JSON schema) before it is
  saved.
- Job retries are bounded by `maxAttempts`; there is no infinite regeneration loop.

## UI

- Season Plan workspace: generate, review, edit (including structured canon
  deltas), regenerate the whole plan, regenerate one episode section, approve.
- Episodes workspace: shows the next episode, why it is locked, and blocks
  creation/starting until the backend gate allows it.
- Production: shows the episode-specific plan, Stage H findings, repair rounds,
  and an inline screenplay editor for unapproved episodes.
- Continuity: shows established canon, proposed developments, and a rebuild
  action for legacy seasons.

## Known limitations

- The semantic critic is opt-in (`CASNA_SEMANTIC_VALIDATION=1`) and advisory.
  Deterministic checks remain the approval gate; the critic cannot block an
  episode.
- Targeted repair only applies to findings that name a scene. Structural
  problems (too few scenes, no dialogue, broken pacing) still trigger the
  bounded full regeneration.
- Canon extraction of relationships, objects, and locations depends on the
  Season Plan's structured deltas. If a plan omits them, the ledger keeps its
  previous state rather than inventing one.
- A creator can edit a screenplay scene by scene, but there is no separate
  per-scene regeneration job; regeneration is automatic during generation or a
  whole-episode action.
- Standalone and anthology projects bypass Season Plan and sequential locking.
