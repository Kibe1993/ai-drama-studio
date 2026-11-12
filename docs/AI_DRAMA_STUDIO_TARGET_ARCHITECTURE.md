# AI Drama Studio - Target Architecture and Restructuring Plan

**Status:** Read-only architecture proposal; no implementation authorized by this document alone  
**Prepared:** 11 November 2026  
**Repository:** `C:\Users\kiber\Desktop\ai-drama-studio`  
**Inputs:** Current Desktop source, uploaded `ai-drama-studio-claude.zip`, Phase 0 audit, and the updated development handover/addendum.

## 1. Executive recommendation

Evolve the existing application as a modular monolith with a separate BullMQ worker. Keep `Project` as the user's independent production boundary. Do not create a second `Production` root model or split the application into microservices. Keep `ProductionRun` and `GenerationJob` as execution/audit records. Add durable creative records for episodes, story continuity, scenes, shots, and media only as each approved phase needs them.

The most urgent correctness problem precedes the larger restructuring: the current mock video result is recorded as `videoReady`, and a mock render can complete a run without creating a media file. First make mock output explicit and non-successful, and require persisted validated media before a scene or production can be called complete. This is a small safety phase that makes later work honest.

After that, build the three-episode pilot in this order:

1. Make production type and production mode explicit on the existing Project.
2. Add versioned story memory and creator-controlled canon updates.
3. Persist episodes, character/location records, scenes, and independently editable shots.
4. Add a minimal storage and MediaAsset lifecycle.
5. Integrate one video provider behind an adapter, only after its cost and usage controls are approved.
6. Connect local Kokoro and a verified FFmpeg executable for audio and assembly.
7. Add publishing profiles and factual-content verification as separate follow-on work.

This sequence preserves the live story, character, and scene LLM work and avoids premature provider integrations. It also separates submitted work from generated, validated, stored, reviewed, and approved media.

## 2. Current architecture assessment

### What should remain

- **Next.js application and authenticated route handlers.** Routes currently authenticate, validate, check ownership, and delegate to services. Continue that pattern.
- **Clerk.** It is already the identity boundary. Keep ownership scoped to the authenticated user and production.
- **MongoDB/Mongoose and Zod.** They fit the application's durable creative data and schema validation needs.
- **Redis/BullMQ and the separate worker.** Keep generation and rendering out of short web requests. Continue to use the existing queues and worker instead of adding another queue system.
- **`Project` as the production root.** It already holds settings and is scoped by `clerkUserId`. Extend it rather than duplicating it as `Production`.
- **`ProductionRun` and `GenerationJob`.** Keep them as records of a workflow execution and individual background operation, not as the canonical episode, scene, or media data model.
- **`Story` and story approval.** Keep the current schema and repository as the source of validated screenplay drafts while introducing an episode relationship in a backward-compatible way.
- **The LLM provider manager and current adapters.** Keep one provider-independent interface, sequential fallback, schema validation, and server-side credentials for story, character, and scene language tasks.
- **Existing service/repository boundaries, React Query hooks, and mock engines for test/development.** Mocks remain useful, but must be labeled as simulations and cannot satisfy real-media gates.

### What is live and what is not

`createLiveEngines` calls the LLM provider for `story.generate`, `character.extract`, and `scene.breakdown`. Story output is validated and upserted into the `stories` collection; character profiles and scene lists are currently stored in `ProductionRun.stageResults`. `video.scene` and `render.final` fall through to `createMockEngines`. The live project has no video, image, audio, storage, or rendering adapter and no `MediaAsset` model. `VIDEO_PROVIDER=ltx`, `AUDIO_PROVIDER=kokoro`, Cloudinary, and S3 variables alone do not integrate those tools.

The local Kokoro folder contains a separate Python environment and test WAVs, but the application does not call it. FFmpeg was not found on PATH or in the common locations checked during Phase 0; the application has no FFmpeg adapter. Treat both as not integrated until a service call and a real output are demonstrated.

### Structures to extend or refactor

| Existing structure | Recommendation |
| --- | --- |
| `Project` model, schema, repository, service, form | Extend with a production identity/profile and explicit content type and production mode. Preserve existing project IDs and defaults. |
| `Project.workflowMode` / `ProductionRun.workflowMode` | Keep as execution behavior (`guided` or `automatic`). Do not reuse it for serialized/anthology/standalone mode. |
| `Story` model and repository | Evolve from one screenplay per production run toward screenplay versions linked to an `Episode`. Preserve existing Story IDs, content, status, and provider trace. |
| `ProductionRun.stageResults` | Keep temporarily as a compatibility projection and execution snapshot. Move canonical episode/character/scene/shot data to typed records as the corresponding phase ships. Avoid growing it into the permanent database model. |
| `SceneItem.videoReady` | Deprecate as the authority for readiness. A boolean alone cannot prove a clip exists. Derive readiness from a validated, persisted `MediaAsset` linked to a shot. |
| `createMockEngines` | Preserve for tests and explicit development simulation. Tag outputs `mock`; never let a mock asset satisfy a production gate. |
| `ProductionPanel` | Extend incrementally to display status, provider trace, approvals, and real asset previews. Do not redesign unrelated project pages. |
| LLM registry/manager | Preserve. Fix request-error vs response-validation fallback classification as a narrow reliability change; keep provider calls sequential and bounded. |

### Current specific risks

1. `processJob.ts` marks a generation job completed before saving the associated `ProductionRun` transition. A crash between the two writes can leave inconsistent state and a completed job that startup reconciliation will not requeue.
2. `videoReady` is set after mock success and the render gate checks that flag alone.
3. The generic render success path sets `render.ready=true` and marks the run completed without file validation or storage.
4. `LLM_FREE_ONLY=true` currently protects the configured LLM sequence, but `LLM_FREE_ONLY=false` intentionally re-enables paid adapters. Future image/video/audio integrations need their own explicit cost policy; LLM free-only must never be assumed to govern them.
5. `FAILOVER_CODES` includes `invalid_request`. A rejected request can therefore fall through to another LLM provider. Separate request errors from invalid JSON/schema output before extending provider usage.
6. Project documentation disagrees about whether character and scene stages are live. Source behavior must be treated as authoritative and docs should be reconciled after changes are approved.

## 3. Proposed target architecture

Keep the current deployment topology: Next.js routes and UI, MongoDB, Redis/BullMQ, and one or more worker processes. The following are conceptual boundaries inside the existing repository, not microservices:

### Content engine

Owns production identity and consumer-facing configuration: content family, production mode, genre, format/duration, audience, tone, visual direction, aspect ratio, and publishing profiles. The existing `Project` is the production root and should own these settings. Profile-specific schemas can validate the settings without scattering content-type checks across unrelated services.

### Story engine

Owns story bible, canon, characters, locations, episodes, screenplay versions, events, plot threads, character knowledge, and immutable approved state snapshots. It supplies a compact, relevant context to LLM calls. Drafts and model suggestions remain proposals until a user approval updates canon.

### Production engine

Owns scene and shot plans, reference assets, provider jobs, generated media, audio, storage, timeline, render, and export. It consumes approved creative records and never edits the approved screenplay or canon as a side effect of media generation.

### Service and adapter boundaries

- Routes continue to use `readActor`, rate limits, Zod input validation, and user-owned service methods.
- Services enforce lifecycle transitions and approval gates.
- Repositories own MongoDB queries and ownership constraints.
- Worker engines orchestrate long-running stages.
- Provider adapters implement a shared task-specific interface and return normalized results/errors.
- Storage adapters own upload, retrieval, and deletion semantics.
- Rendering adapters own FFmpeg process invocation and media probing.

No API route or React component should call an AI vendor, Kokoro, object storage, or FFmpeg directly.

## 4. Domain model and relationships

`Project` remains the aggregate root for one independent production. Its `productionType` and `productionMode` are different concepts from `workflowMode`:

- `productionType` identifies a workflow family, such as fictional drama, documentary, educational, reflection, comedy, or animation.
- `productionMode` identifies continuity behavior: `serialized`, `anthology`, or `standalone`.
- `workflowMode` remains `guided` or `automatic` and controls stage progression only.

Proposed records (add only in their relevant phase):

| Record | Ownership / relation | Purpose |
| --- | --- | --- |
| `Project` (existing) | User-owned root | Production profile, content settings, archive/status, links to current episode/story where useful. |
| `StoryBible` | `projectId` | Premise, world rules, themes, boundaries, canonical facts, and version metadata. Optional for factual or standalone content. |
| `Character` | `projectId` | Stable character identity and approved profile/appearance, relationships, motivations, references, and version history. Do not identify solely by display name. |
| `Location` | `projectId` | Canonical environment description, geography, visual traits, references, and continuity notes. |
| `Episode` | `projectId`, ordered sequence key | Outline, status, target duration, workflow state, current screenplay version, and approved story-state snapshot. Standalone productions can still use one Episode. |
| `Story` (existing, evolved) | `projectId`, `episodeId`, version; retain legacy `productionRunId` during migration | Validated screenplay draft/version, provider trace, review/approval state. A run is provenance, not the creative parent. |
| `StoryEvent` | `projectId`, optional `episodeId`, source snapshot/version | Proposed or approved chronological event with participants, location, consequences, evidence/source, and canon status. |
| `PlotThread` | `projectId`, optional `episodeId` | Open/closed narrative question or conflict and its status. |
| `StoryStateSnapshot` | `projectId`, version, optional `episodeId` | Immutable approved point-in-time canon. Contains compact facts, character knowledge, relationships, and thread state; references source events. |
| `Scene` | `episodeId`, order | Persisted breakdown linked to approved screenplay, location, characters, dialogue, and visual direction. |
| `Shot` | `sceneId`, `episodeId`, order | Independently reviewable/generatable unit: purpose, framing, movement, duration, prompt, dialogue/audio needs, references, and status. |
| `MediaAsset` | `projectId`, source shot/scene/episode, source job | Metadata for real image/audio/video/render files, storage key, MIME type, bytes, hash, dimensions, duration, frame rate, provider/model, validation, version, and approval. Store bytes outside MongoDB. |
| `ProductionRun` (existing) | `projectId`, user, mode | One execution/resume record for an episode or bounded production operation. Keep retry checkpoint and stage progress here. |
| `GenerationJob` (existing) | `projectId`, `runId`, optional `episodeId`, `shotId`, `assetId` | Queue execution, attempts, provider request ID, status, error, usage, idempotency key, and timestamps. |
| `ResearchSource` / `FactClaim` (later) | `projectId`, optional `episodeId` | Sources, claim-to-source links, verification, uncertainty, and creator fact-check status for factual workflows. |

Relationships:

```text
User (Clerk identity)
  -> Project / Production
       -> StoryBible (optional by content type)
       -> Characters, Locations, PlotThreads
       -> Episodes
            -> Story versions
            -> StoryEvents -> StoryStateSnapshots (versioned, approved)
            -> Scenes -> Shots
                 -> MediaAssets (reference, generated, approved, derived)
            -> ProductionRuns -> GenerationJobs
       -> Publishing profiles / export variants (later)
       -> ResearchSources / FactClaims (factual workflows, later)
```

All child queries must include `projectId` and user ownership. Cross-production reuse must be a deliberate import/copy operation that creates a new production-scoped record; never share a mutable character, story snapshot, or asset reference implicitly.

### Mode-specific continuity

- **Serialized:** episodes use the latest approved snapshot and relevant records; approved episode events propose the next snapshot.
- **Anthology:** each episode has isolated story state by default. A production can share an explicit anthology frame (host, theme, style, common setting) without leaking one story's characters or events into another.
- **Standalone:** one episode can use reusable project assets but does not update a continuing canon unless the user explicitly changes the mode or approves a state.
- **Factual/documentary:** factual claims use research sources and review, not fictional canon. An LLM-generated claim is unverified until a creator approves evidence.

## 5. Project, episode, story, and canon lifecycle

### Project lifecycle

1. Create a Project with backward-compatible defaults for existing projects.
2. Choose content type, mode, format, audience, tone, visual direction, and publishing profile when available.
3. Create or edit optional StoryBible and canonical characters/locations.
4. Start an Episode or standalone production run.
5. Archive/restore remains on the existing project service and ownership rules.

### Episode and story lifecycle

1. Draft outline/context using the production profile and, for serialized mode, the latest approved snapshot.
2. Generate a screenplay draft through the existing LLM manager and validate it with the shared Zod schema.
3. Save a versioned `Story` linked to the `Episode`. Keep provider/model/fallback and usage metadata as provenance.
4. Show the full draft for creator review. Approval is an explicit state transition; generation never marks it approved.
5. Extract proposed character/location changes and proposed `StoryEvent`/`PlotThread` changes without altering the canonical records.
6. Show additions, changes, and contradictions against the snapshot used for generation.
7. The creator approves, edits, or rejects proposals. On approval, write a new immutable `StoryStateSnapshot` using optimistic version checking; preserve all prior snapshots.

Recommended canon policy for the pilot: screenplay and state changes are proposals. Do not update canonical state merely because a screenplay was generated or approved. Prefer applying episode events after a creator approves the finished episode; the exact point (screenplay approval versus final-cut approval) is an explicit product decision listed below.

### Concurrency and idempotency

Use unique, stable keys for job retries, and increment output versions only for an explicit regenerate action. Do not use character names or scene numbers alone as permanent identifiers. Protect snapshot updates with a `baseSnapshotVersion` compare-and-set. Use targeted repository updates or a revision field on `ProductionRun` so parallel scene/shot jobs cannot overwrite each other's result arrays. Keep provider attempt data separate from the approved creative record.

## 6. Scene, shot, and media lifecycle

### Scene and shot planning

1. After screenplay approval, convert screenplay scenes into persistent `Scene` records with provenance to the Story version.
2. Break a scene into one or more `Shot` records. Preserve the screenplay; shots are production interpretations, not screenplay rewrites.
3. Each shot stores purpose, order, camera/framing, action, duration, dialogue/audio needs, visual prompt, aspect guidance, character/location IDs, and reference asset IDs.
4. The creator can edit and approve the shot plan before any external generation request.
5. Regenerating one shot creates a new generation/version and preserves prior assets and approved shots.

### Asset states and truth rules

Use explicit states, rather than an ambiguous boolean:

`planned -> ready_for_generation -> submitted -> processing -> generated -> review_required -> approved`

Terminal/alternate states include `mock`, `unavailable`, `failed`, `cancelled`, and `rejected`. `submitted` means only that the provider accepted a request; it is never generation success. `generated` requires retrieval of a non-empty, format-valid file, readable metadata, successful storage, and a persisted `MediaAsset`. User approval is a separate state from generation.

The storage service uploads actual bytes to a configured local-development or object-storage adapter, verifies the uploaded object, and returns a storage key plus metadata. MongoDB stores metadata, not large binaries. Signed download URLs are short-lived delivery details; do not store secrets or expose storage credentials.

### Video job lifecycle

1. Worker loads the approved Shot, source Scene/Story, character/location references, and generation settings within the same Project.
2. Validate provider eligibility and cost policy before submission. A paid request requires explicit user approval and a visible cost/usage limit; free-only settings must be separate from LLM policy.
3. Submit sequentially to the selected provider, record provider job ID, then poll or accept a webhook with bounded timeout and cancellation handling.
4. Download the completed result, validate file content and metadata, upload it, and persist `MediaAsset`.
5. Mark the shot `review_required`, not approved. Keep failed attempts and provider errors without creating a completed asset.
6. Idempotency keys identify the specific shot version, prompt/reference hash, provider, model, and settings. A retry of the same job must not create duplicate assets; an explicit regenerate action creates a new version.

### Render lifecycle

The timeline references approved shot assets, not scene-ready booleans. A render job captures an immutable timeline/input hash. FFmpeg runs in a worker with a bounded temporary directory. Probe and validate the output, confirm non-zero bytes and playable container/streams, persist the final `MediaAsset`, and only then set run/project completed. If a scene/shot file is missing or invalid, rendering fails before the project can be completed. Still images assembled into motion must be described as image-sequence/assembled footage, not AI-generated video.

## 7. Provider strategy

- Preserve `LLMProvider`, the current registry/manager, the schema authority, and sequential provider fallback for text tasks.
- Keep adapters isolated by capability: `lib/providers/llm`, and later `image`, `video`, `audio`, `storage`, and `render` directories. These are code boundaries, not services.
- Define capability-specific contracts. A video adapter needs submit/status/download/cancel semantics; an audio adapter returns audio bytes and metadata; storage owns upload/read/delete; render wraps FFmpeg and probing.
- Normalize error classes so request/auth/model errors stop inappropriate fallback, while retryable network/quota/availability failures may move to another explicitly eligible provider. Malformed JSON or Zod-invalid model output can try the next provider; an HTTP 400 invalid request should not.
- Maintain one total sequence budget and avoid multiplying SDK retries, provider-manager attempts, and BullMQ deliveries. Make the retry budget configurable and visible in logs with job/run IDs.
- Keep all keys in worker/server environment only. Diagnostics report configured/unconfigured without values. Never pass secrets through job payloads or UI responses.
- Separate `LLM_FREE_ONLY` from `VIDEO_FREE_ONLY` and other media cost controls. A text-provider free list is not evidence of free image/video/audio access. Keep real video explicitly unavailable until a provider/model's current allowance, billing behavior, terms, format limits, and account requirements have been verified.
- Store provider, model/version, provider request ID, timestamps, errors, and returned token/usage metadata when supplied. Never fabricate usage or prices.
- Register only one provider for the initial video proof. No automatic paid fallback. Require a user-approved generation request and an auditable budget before any potentially billable call.

## 8. API, UI, and workflow restructuring

### APIs

Retain current project and production endpoints for compatibility. Add nested resource routes only as their phase is implemented, for example:

- `GET/POST /api/projects/:projectId/episodes`
- `GET/PATCH /api/projects/:projectId/episodes/:episodeId`
- `POST /api/projects/:projectId/episodes/:episodeId/story/approve`
- `GET/POST /api/projects/:projectId/episodes/:episodeId/scenes`
- `GET/POST /api/projects/:projectId/scenes/:sceneId/shots`
- `POST /api/projects/:projectId/shots/:shotId/approve`
- `POST /api/projects/:projectId/shots/:shotId/generate`
- `POST /api/projects/:projectId/assets/:assetId/review`
- `POST /api/projects/:projectId/episodes/:episodeId/render`

These names are proposals, not existing routes. Every request validates IDs and body with Zod, authenticates via the existing session helper, checks ownership at the repository boundary, and delegates to a service. Do not put provider calls in route handlers.

### UI progression

Add focused screens/panels over the existing project UI:

1. Production settings and mode selection.
2. Story bible and canonical characters/locations.
3. Episode list and approved story state.
4. Story review and state-diff/contradiction approval.
5. Scene/shot editor and reference selection.
6. Per-shot status, preview, approve/reject/regenerate controls.
7. Timeline and render preview/final status.
8. Export profile and download.

The production UI must distinguish `MOCK`, `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, and `UNAVAILABLE`. A completed job is not the same as a completed asset. Do not display “video ready” without a validated stored asset and previewable media. Automatic mode can automatically progress approved operational work if configured, but it must not silently approve canon, paid generation, shots, or final cuts.

## 9. Phased migration plan

Each phase is independently reviewable. Scope remains small; later phases are not implicitly approved by completing an earlier one.

### Phase 0A - truthful media and job state (recommended first task)

- **Objective:** Remove false video/render success before adding new functionality.
- **Existing files:** `lib/pipeline/types.ts`, `lib/pipeline/mockEngines.ts`, `lib/pipeline/liveEngines.ts`, `lib/pipeline/processJob.ts`, `lib/services/pipelineService.ts`, `components/production/ProductionPanel.tsx`, `lib/domain/projectCatalog.ts`, `docs/PRODUCTION_PIPELINE.md`, `docs/ROADMAP.md`.
- **New files:** Prefer none unless a small media-evidence validator is genuinely reusable; if needed, add a focused `lib/pipeline/mediaEvidence.ts`.
- **Database:** No new collection. Add optional, backward-compatible stage/media status metadata; treat historical `videoReady=true` from the mock-only implementation as untrusted until an asset is proven.
- **API/UI:** Keep current routes. Show `MOCK`/`UNAVAILABLE`; do not expose an approval action that pretends mock clips can proceed to rendering.
- **Risks/dependencies:** Historical run rows may contain `videoReady=true` or `render.ready=true` despite no file. The production DB must not be modified in this phase without a reviewed dry-run/backfill plan. Concurrent job updates remain a separate concern.
- **Tests:** Mock video never yields real-ready; mock render never completes; render gate rejects legacy booleans without validated asset references; UI state text for mock/unavailable; preserve story/character/scene approvals.
- **Acceptance:** No mock output sets genuine media-ready/completed. No render job can be enqueued from mock-only scenes. Project/run UI explains that no real media exists.
- **Untouched:** Story generation, provider selection, `.env`, Clerk, queues, image/video/audio integrations, and database contents.

### Phase 1 - production profile and continuity foundation

- **Objective:** Make each Project's content family and production mode explicit and establish the smallest reusable story-world records.
- **Existing files:** `lib/domain/projectCatalog.ts`, `lib/validation/project.ts`, `lib/models/project.ts`, `lib/repositories/projectRepository.ts`, `lib/services/projectService.ts`, project routes, `components/projects/ProjectForm.tsx`, `ProjectRows.tsx`, `lib/auth/session.ts`, ownership helpers, and related project tests.
- **New files:** `lib/models/storyBible.ts`, `character.ts`, `location.ts`; corresponding validation and repositories; minimal UI panels. Consider `productionProfiles.ts` for supported settings and field validation.
- **Database:** Add optional/defaulted Project fields `productionType` and `productionMode`. Add indexes on `{ clerkUserId, _id }`/`projectId` as appropriate. StoryBible, Character, and Location rows are always `projectId` scoped. Preserve existing rows by assigning conservative defaults.
- **API/UI:** Extend create/update/duplicate APIs and project form. Duplicate should copy production settings but must not silently copy canon or media assets unless explicitly chosen.
- **Risks/dependencies:** Backward compatibility across validation, duplicate/archive/restore, and API responses. Avoid treating genre as production type or `workflowMode` as continuity mode.
- **Tests:** Existing projects receive defaults; owner isolation; duplicate semantics; unsupported profile settings reject; standalone/anthology modes do not share state.
- **Acceptance:** Existing projects remain usable; a user can create two independent productions with different content/mode settings and no cross-production data leakage.
- **Untouched:** Existing live stage prompts/adapters, real media generation, publishing, and actual `.env`.

### Phase 2 - episodes, story versions, and approved canon

- **Objective:** Add continuing episodes and versioned story memory without losing current Story records.
- **Existing files:** `lib/validation/story.ts`, `lib/models/story.ts`, `lib/repositories/storyRepository.ts`, `lib/providers/llm/types.ts`, `prompt.ts`, `stageTasks.ts`, `liveEngines.ts`, `pipelineService.ts`, production routes/hooks/components, and story tests.
- **New files:** `lib/models/episode.ts`, `storyEvent.ts`, `plotThread.ts`, `storyStateSnapshot.ts`; matching repositories, validation, context assembler, state-diff service, episode routes and review UI. Add `ResearchSource`/`FactClaim` only in the later factual phase.
- **Database:** Add `Episode` under Project, `Story.episodeId`, version/provenance fields, event/thread/snapshot records, and unique indexes for episode order and snapshot version. Preserve legacy `Story.productionRunId` during rollout. Backfill an episode for existing story data only with an idempotent dry-run migration that records source Story IDs and never drops originals. Avoid changing the unique `productionRunId` index until every existing row is reconciled.
- **API/UI:** Episode list/create/read, story draft review, state-diff/contradiction view, snapshot approval. Story approval remains explicit; canonical update requires a separate explicit approval.
- **Risks/dependencies:** Two concurrent episodes could race to update the same snapshot; use base-version compare-and-set. Free model context limits; retrieve relevant story facts rather than entire scripts. Anthology state isolation needs an explicit policy.
- **Tests:** Episode isolation; new draft does not update canon; snapshot immutability; contradiction surfaced; CAS prevents stale concurrent updates; no story loss during backfill; serialized Episode 2 receives approved Episode 1 context.
- **Acceptance:** A three-episode fixture series can draft Episode 2/3 from the latest approved snapshot; proposed events never become canon without owner approval.
- **Untouched:** Video generation, media costs, FFmpeg, and social publishing.

### Phase 3 - persistent characters, locations, scenes, and shot planning

- **Objective:** Convert LLM suggestions and scene breakdowns into durable, editable production plans; enable independent shot regeneration later.
- **Existing files:** `lib/validation/productionStages.ts`, `lib/pipeline/types.ts`, `lib/pipeline/liveEngines.ts`, `processJob.ts`, `pipelineService.ts`, production UI/hooks, and stage-generation tests.
- **New files:** `lib/models/scene.ts`, `shot.ts`, optional `characterVersion.ts`/`locationVersion.ts`, repositories, validation, scene/shot service and routes, editor panels.
- **Database:** Add project-scoped canonical character/location records and episode-scoped Scene/Shot records with stable IDs and ordering. Keep a link to the approved Story version. Retain legacy `stageResults` as a read compatibility projection during migration.
- **API/UI:** Review/extract candidate characters; explicitly approve canonical profile changes; show editable scene and shot lists; approve shot plan before any provider call.
- **Risks/dependencies:** Name collisions and inconsistent LLM output; use stable IDs, aliases, and validation against screenplay. Reconcile existing embedded scenes without replacing a user's data. Character appearance versions need explicit approval.
- **Tests:** Scene/shot ownership; screenplay provenance; no invented character; stable order; edit/regenerate one shot does not invalidate unrelated shots; guided/automatic approval rules; legacy read compatibility.
- **Acceptance:** One scene can contain multiple independently editable shots with prompts, durations, references, dialogue/audio needs, and status; no paid/provider request occurs before approval.
- **Untouched:** Live video/image calls and final render.

### Phase 4 - MediaAsset and storage foundation

- **Objective:** Store real media durably and define a validated asset lifecycle before integrating a video generator.
- **Existing files:** `lib/db/connect.ts`, `lib/models`, repositories, worker, generation jobs, logging, environment documentation, and UI asset previews.
- **New files:** `lib/models/mediaAsset.ts`, `lib/repositories/mediaAssetRepository.ts`, storage interface and one local-development storage adapter; validation for MIME/size/metadata; authenticated asset access route.
- **Database:** MediaAsset metadata with project, episode, source shot/job, type, storage key, MIME type, byte size, checksum, dimensions/duration/frame rate, provider/model, version, validation and review states. Index project/source/job/version. Store binary bytes outside MongoDB.
- **API/UI:** Asset listing, preview, and safe signed/authorized retrieval; no public credential-bearing URLs.
- **Risks/dependencies:** Local disk is not durable production storage; S3-compatible/cloud accounts may have costs/limits; orphan cleanup and access control. Configure storage only after account limits are reviewed.
- **Tests:** Empty/corrupt file rejected; metadata parsing; upload then retrieve; ownership isolation; retry idempotency; no asset row marked ready before upload verification.
- **Acceptance:** A test fixture file is validated, stored, retrieved, and represented by one project-scoped MediaAsset.
- **Untouched:** Live video generation and FFmpeg final completion.

### Phase 5 - one controlled video-provider integration

- **Objective:** Generate one actual approved shot through one replaceable adapter.
- **Existing files:** `lib/pipeline/redis.ts`, `bullQueue.ts`, `live.ts`, `processJob.ts`, `workers/studio.ts`, job repositories, shot service/UI, error/logging, free/cost settings.
- **New files:** `lib/providers/video/types.ts`, registry/manager, one verified provider adapter, video prompt builder, status/download service, configuration validation, provider fake tests.
- **Database:** Add provider request ID/status/timing to GenerationJob and link the resulting MediaAsset to Shot. Keep outputs versioned and retry-idempotent.
- **API/UI:** Explicit “Generate this shot” confirmation, provider/model and cost/usage notice, processing/failure/fallback status, preview and approve/reject/regenerate.
- **Risks/dependencies:** Free tier and model access change; API may require billing details; async polling/webhook limits; cost approval; temporary URL expiry; character consistency. Do not select a provider until current official docs and account eligibility are verified. If no free provider is usable, leave the provider unavailable and report it.
- **Tests:** Adapter fake submit/poll/download; timeout/quota/fallback; cancellation; invalid file; no paid fallback; duplicate retry; only persisted validated output reaches `generated`.
- **Acceptance:** One manually approved shot produces a real file, validated and stored, then previews in the app. A mock or submitted-only job never does.
- **Untouched:** Multiple video providers, batch generation, automatic publishing, and general-purpose editing.

### Phase 6 - local speech and final assembly

- **Objective:** Generate real dialogue audio with the existing Kokoro installation and assemble approved shot assets into a playable MP4.
- **Existing files:** worker/queues, scene dialogue records, UI, storage and MediaAsset from Phase 4, render/final gate from Phase 0A.
- **New files:** `lib/providers/audio` Kokoro adapter or a small local Python service contract; audio job orchestration; `lib/providers/render` FFmpeg adapter; subtitle/timeline schema and renderer validation.
- **Database:** Audio MediaAssets linked to character/line/scene; render job input hash; final render MediaAsset with source timeline and metadata.
- **API/UI:** Voice mapping per character, scene audio preview, subtitle/timeline controls, render preview/final and download.
- **Risks/dependencies:** Verify Kokoro runtime invocation from the worker, voice/license choices, CPU/RAM and processing duration. FFmpeg is not currently found in common paths; install/configure it separately only after the executable, license, codecs, and host are reviewed. No automatic model downloads or driver changes.
- **Tests:** Fake TTS service; missing dialogue; WAV validation; voice mapping; subtitle timing; FFmpeg availability; test clips/audio combine; MP4 probe/playback; missing shot blocks render; failure leaves no completed render.
- **Acceptance:** A short episode with approved shots and actual dialogue audio produces a validated playable MP4 stored as MediaAsset; run/project completion follows persistence only.
- **Untouched:** Automatic TikTok/YouTube publishing and professional nonlinear editing.

### Phase 7 - export profiles and multi-format editions

- **Objective:** Produce manual-download editions for vertical short-form and longer YouTube use while preserving the canonical episode.
- **Existing files:** Project content profile, timeline/render records, MediaAsset access, project UI.
- **New files:** PublishingProfile/ExportVariant model and validation only if the first exports demonstrate the need; output preset registry.
- **Database:** Each export points to its source episode/timeline/render and has its own aspect/duration/output metadata; do not overwrite canonical source assets.
- **API/UI:** Select export profile, render variant, preview, and download. Automatic platform publishing is separate and deferred.
- **Risks/dependencies:** Platform rules and aspect-safe composition change; verify official documentation at implementation time. A crop may remove important action; use creator preview.
- **Tests:** aspect/profile validation, same source can produce separate variants, source render preserved, output metadata correct.
- **Acceptance:** A reviewed vertical export and a landscape/extended export can be generated from approved media without changing story canon.
- **Untouched:** Automatic social posting, scheduling, monetization, and platform analytics.

### Phase 8 - factual/documentary trust workflow

- **Objective:** Support documentary, historical, and educational claims without treating model output as verified fact.
- **Existing files:** productionType/profile, Episode/story review, provider manager, approval UI.
- **New files:** ResearchSource and FactClaim models/repos/validation, source ingestion UI, claim-source review and verification state.
- **Database:** Project-scoped sources, URLs, publisher/date/accessed time, claim links, evidence excerpts/notes, confidence/uncertainty, and reviewer/status. Do not merge factual claims into fictional canon.
- **API/UI:** Research notes and claim review; export citations in production notes; unresolved claims visible before approval.
- **Risks/dependencies:** Source licensing, link rot, factual accuracy, and no automated “verified by AI” status. Human review remains required.
- **Tests:** project isolation, source-to-claim coverage, unverified claim blocks factual approval, audit trail for changes.
- **Acceptance:** An educational episode can distinguish verified source-backed claims, interpretation, and dramatization.
- **Untouched:** Automatic research publication or unsupervised factual claims.

## 10. Migration and rollout rules

1. **Do not reset or clean the working tree.** It already contains pre-existing modified and untracked work. Review changes by file before implementation; keep this plan as a new document only.
2. **No destructive data migration.** Start with read-only counts and dry-run reports. Back up the database before any write migration. Never drop legacy story/run fields until compatibility and rollback have been demonstrated.
3. **Use additive schema changes first.** Defaults should preserve current projects. Reads should accept legacy documents; writes should use the new fields. After all deployed code reads new records successfully, remove old writes in a later phase.
4. **Treat existing media flags as untrusted.** There is no media adapter or asset collection in the audited code. Existing `videoReady=true` or `render.ready=true` values must not be migrated into genuine assets without locating and validating the original file.
5. **Keep story provenance.** Preserve Story IDs, screenplay, creator ownership, provider/model trace, timestamps, and approval status. Backfill Episode references idempotently and retain old run links until verified.
6. **Never cross-link projects implicitly.** Duplicate-project behavior must explicitly decide whether it copies only configuration, story bible, characters, or assets. Default should create a fresh production with no shared mutable canon/media.
7. **Roll out in dual-read steps.** Add model/schema, implement repositories, add service/API, then UI. Keep a short compatibility period for current stageResults before any consolidation.
8. **Avoid large mixed phases.** A media integration should not also redesign Clerk, replace queues, change LLM providers, and rewrite the project UI.

## 11. Technical risks and unresolved decisions

### Risks to resolve early

- **Canonical state timing:** Should canon update after screenplay approval, after final media approval, or after final episode approval? The safer default is after the creator approves the episode's actual events, with a visible state diff.
- **Anthology scope:** What can anthology episodes share (channel identity/style/host) while keeping plot, character knowledge, and references isolated?
- **Standalone semantics:** Should standalone productions still create a StoryBible and snapshot, or use only episode-level context?
- **Character identity:** How will the creator resolve two characters with the same name, aliases, recasting, or deliberate visual redesign across episodes?
- **Shot granularity:** How many shots per scene and what minimum fields are required before a provider call? Do not assume one scene equals one video clip.
- **Provider economics:** Which video model is genuinely usable for the account, whether payment details are required, whether usage can charge automatically, and the per-shot cap. Verify immediately before the integration phase.
- **Storage choice:** Local development storage versus a production object store, retention, quotas, signed access, backup, and deletion. Cloudinary/S3 variables do not prove an adapter or a free storage plan.
- **Worker concurrency:** Current per-process queue concurrency does not itself prevent two worker processes from updating the same ProductionRun. Use atomic targeted writes/revisions when jobs start writing persistent shot/asset records.
- **TTS deployment:** Should the worker invoke Kokoro's local Python environment as a subprocess or call a small local service? Choose after verifying startup, timeout, voice mapping, and resource use on the target machine.
- **Approval boundaries:** Automatic mode may progress approved operational work, but it must not silently approve canon, paid generation, shot outputs, or the final cut.
- **Data residency and licensing:** Verify model/provider terms and generated-media rights at the point of selection. Do not infer commercial rights from free access.

### Foundational versus deferrable

**Foundational now:** honest statuses and gates; production identity/mode; ownership isolation; immutable canon snapshots; episode/story provenance; stable shot IDs; media validation/storage metadata; idempotent jobs; explicit approvals; provider-independent contracts.

**Safely deferred:** multiple video vendors; batch rendering; sophisticated timeline editing; automatic social publishing; music generation; advanced animation; analytics/billing; full documentary automation; microservices; broad plugin architecture.

## 12. Recommended first implementation task

Implement **Phase 0A: truthful media and job state** as a small, isolated change. Keep the live LLM stages and all current environment values intact. Preserve mocks for tests, but tag mock results and ensure they cannot set a genuine ready/completed state. Make the render gate require a validated stored media reference rather than `videoReady`. Update the production UI to say plainly that video generation/rendering is `MOCK` or `UNAVAILABLE`. Add tests for the mock path, legacy boolean rejection, and the no-false-completion invariant. Do not connect a video provider or FFmpeg in this task.

After reviewing that patch, start Phase 1 with additive production profile fields and the smallest story-world records. Continue one phase at a time, with separate approval before a potentially billable provider integration.

## 13. Source map

The assessment above is grounded in the current source, not only prior documentation:

- `lib/pipeline/liveEngines.ts` - live story, character, and scene provider calls; mock fallthrough for other job types.
- `lib/pipeline/mockEngines.ts` - fixed mock output for video/render.
- `lib/pipeline/processJob.ts` - job lifecycle, stage result persistence, current mock-ready/completed behavior, retry and reconciliation.
- `lib/services/pipelineService.ts` - project ownership, approvals, stage enqueue, and current video-ready gate.
- `lib/models/project.ts`, `story.ts`, `productionRun.ts`, `generationJob.ts` - current persistence boundaries.
- `lib/repositories/storyRepository.ts` - story upsert, ownership, approval, and per-run uniqueness.
- `lib/providers/llm/registry.ts`, `manager.ts`, `freePolicy.ts` - current provider sequence, free-only guard, timeout and failover.
- `workers/studio.ts`, `lib/pipeline/live.ts` - separate worker startup, queue setup, live dependency wiring.
- `lib/validation/story.ts`, `productionStages.ts` - screenplay, character, and scene schemas.
- `components/production/ProductionPanel.tsx`, `hooks/useProduction.ts` - existing progress and approval UI.
- `tests/stage-generation.test.ts`, `pipeline.test.ts`, `story-generation.test.ts`, `free-providers.test.ts`, `llm-failover.test.ts` - current fake-provider and mock lifecycle coverage.
- `docs/ARCHITECTURE.md`, `PRODUCTION_PIPELINE.md`, `BACKGROUND_JOBS.md`, `DATABASE.md`, `MEDIA_STORAGE.md`, `RENDERING.md`, `ROADMAP.md`, `TESTING.md` - existing design documentation; some stage-status claims are stale.

No tests, builds, live provider calls, production database access, migrations, or filesystem changes outside this Markdown deliverable were performed for this read-only assignment.
