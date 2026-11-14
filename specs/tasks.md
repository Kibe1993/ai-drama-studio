# Media Production Pipeline — Implementation Task Plan

> **Source requirements**: `specs/requirements-media-production.md` (144 EARS requirements, MP-A-001 … MP-J-022)
> **Source design**: `specs/design-media-production.md` (14-section technical design)
> **Stack**: Next.js 15 (App Router), React 19, TypeScript, MongoDB/Mongoose, BullMQ/ioredis, Clerk, Vitest, CSS Modules
> **Constraints**: Preserve existing narrative/canon subsystems. Mock providers suffice for all tests. No Tailwind. No paid-API-mandatory. No shell interpolation. Canon protection (read-only narrative models).

---

## Conventions

- Every new server module starts with `import "server-only";`.
- No `any` types — use Zod schemas + inferred `*Record` types.
- New Mongoose models: co-located in `lib/models/`, with a co-located Zod validator in `lib/validation/` and a repository in `lib/repositories/`.
- New services: `lib/services/`, dependency-injected, throw `StudioError` (from `lib/http/errors.ts`).
- New provider adapters: `lib/providers/media/`, behind interfaces.
- New API routes: `app/api/projects/[projectId]/...`, wrapped in `logged()` + `readActor()` + ownership check.
- New UI: `app/(studio)/projects/[projectId]/...`, client components with co-located `*.module.css`.
- Tests: `tests/*.test.ts`, Vitest, mock providers only — no paid API calls.
- Run after each task: `npm run typecheck && npm run lint && npm test`.

---

# Phase 1 — Foundation

> Provider interfaces, mock adapters, capability registry, cost guard, new job types, failure classification. Exit criteria: mock image/video/audio jobs enqueue + complete + record cost; all tests use mock only.

---

### Task 1.1 — ProviderCapability type + ProviderRegistry
**ID**: T1.1
**Satisfies**: MP-D-003, MP-D-004, MP-I-009, MP-I-010, MP-J-001, MP-J-006
**Depends on**: —
**Create**:
- `lib/providers/media/capability.ts` — `ProviderCapability` type (supportsImageToImage, supportsImageToVideo, supportsReferenceGuidedVideo, maxClipDurationSeconds, maxImageDimension, isMock, isPaid, supportedModels).
- `lib/providers/media/registry.ts` — `ProviderRegistry` with `select(kind, requiredCapability, model, isCreatorInitiated)` implementing the selection algorithm from design §2.4.5 (never fall back free→paid; prefer mock when no key/enablement).
**Modify**: —
**Acceptance**:
- Registry returns mock adapter when no API key / no provider configured.
- Registry throws `no_provider_available` when no eligible adapter.
- Registry never returns a paid adapter unless `isCreatorInitiated && enabled && keyPresent`.
- Unit test: `tests/provider-registry.test.ts`.

---

### Task 1.2 — ImageProvider interface + MockImageProvider
**ID**: T1.2
**Satisfies**: MP-C-001, MP-C-002, MP-C-005, MP-C-006, MP-C-008
**Depends on**: T1.1
**Create**:
- `lib/providers/media/image/types.ts` — `ImageProvider` interface, `ImageGenerationRequest`, `ImageGenerationResult` (per design §2.2.2).
- `lib/providers/media/image/mock.ts` — `MockImageProvider`: `capabilities.isMock=true`, returns deterministic in-memory PNG bytes, `mock:true` on result.
**Acceptance**:
- Mock returns valid PNG bytes with `mock: true`.
- Interface has no vendor-specific fields.
- Unit test: `tests/image-provider-mock.test.ts`.

---

### Task 1.3 — VideoProvider interface + MockVideoProvider
**ID**: T1.3
**Satisfies**: MP-D-001, MP-D-002, MP-D-005, MP-D-007, MP-D-013
**Depends on**: T1.1
**Create**:
- `lib/providers/media/video/types.ts` — `VideoProvider` interface (submit/poll/cancel), `VideoGenerationRequest`, `VideoOperationHandle`, `VideoPollResult`.
- `lib/providers/media/video/mock.ts` — `MockVideoProvider`: submit returns op id; poll returns `processing` once then `completed` with in-memory MP4 bytes; `mock:true`.
**Acceptance**:
- Async lifecycle: submit → poll(processing) → poll(completed).
- Mock never blocks; poll is non-blocking.
- Unit test: `tests/video-provider-mock.test.ts`.

---

### Task 1.4 — AudioProvider interface + MockAudioProvider
**ID**: T1.4
**Satisfies**: MP-E-003, MP-E-010
**Depends on**: T1.1
**Create**:
- `lib/providers/media/audio/types.ts` — `AudioProvider` interface, `AudioGenerationRequest` (kind: dialogue|narration|sfx), `AudioGenerationResult`.
- `lib/providers/media/audio/mock.ts` — `MockAudioProvider`: returns deterministic in-memory WAV bytes, `mock:true`.
**Acceptance**:
- Mock returns valid WAV bytes.
- Dialogue kind requires voiceProfile in request (validated at service layer).
- Unit test: `tests/audio-provider-mock.test.ts`.

---

### Task 1.5 — CostEvent model + CostGuard service
**ID**: T1.5
**Satisfies**: MP-J-003, MP-J-004, MP-J-008
**Depends on**: —
**Create**:
- `lib/models/costEvent.ts` — `CostEventSchema` (clerkUserId, projectId, generationJobId, provider, model, usage (Mixed), estimatedCostCents, billable, kind, createdAt). Indexes: `{clerkUserId,projectId,createdAt}`, `{generationJobId}`.
- `lib/validation/costEvent.ts` — Zod schema + `CostEventRecord` type.
- `lib/repositories/costEventRepository.ts` — `create`, `sumByProject`.
- `lib/services/costGuard.ts` — `check(actor, projectId, estimatedCostCents)` throws `cost_limit_exceeded` if `Project.costLimitCents` set and exceeded; `record(jobId, provider, model, usage, billable)`.
**Modify**:
- `lib/models/project.ts` — add `costLimitCents: Number | null` (default null).
**Acceptance**:
- CostGuard rejects when limit exceeded; passes when null/unlimited.
- CostEvent recorded on job completion.
- Unit test: `tests/cost-guard.test.ts`.

---

### Task 1.6 — Extend GenerationJob: new JOB_TYPES + failureClassification + costEventId
**ID**: T1.6
**Satisfies**: MP-I-002, MP-I-006, MP-I-008, MP-J-020
**Depends on**: —
**Modify**:
- `lib/models/generationJob.ts` — append 11 new job types to `JOB_TYPES` (no reorder/remove): `image.character_reference`, `image.environment_reference`, `image.object_reference`, `image.shot`, `video.shot`, `audio.dialogue`, `audio.narration`, `audio.sfx`, `audio.music`, `media.validate`, `assembly.generate`. Add `failureClassification: "transient"|"permanent"|null` (default null). Add `costEventId: ObjectId | null` (default null). Add index `{clerkUserId,projectId,jobType,status}`.
- `lib/pipeline/redis.ts` / `lib/pipeline/bullQueue.ts` — extend `queueNameFor` switch for new job types per design §2.7.1 mapping table.
- `lib/pipeline/processJob.ts` — add no-op stub branches for new job types (throw `not_implemented` for now; real handlers added in later phases). Add failure-classification helper mapping error codes → transient|permanent (design §2.7.3).
**Acceptance**:
- `npm run typecheck` passes.
- Existing tests still pass (no behavior change for existing job types).
- New job types route to correct queues.
- Unit test: `tests/job-types-extended.test.ts`.

---

### Task 1.7 — FFmpeg/FFprobe configuration guard
**ID**: T1.7
**Satisfies**: MP-H-002
**Depends on**: —
**Create**:
- `lib/providers/media/ffmpeg/config.ts` — reads `FFMPEG_PATH` and `FFPROBE_PATH` from env; `assertFfmpegConfigured()` throws `ffmpeg_not_configured` if unset; `getFfmpegPath()`, `getFfprobePath()`.
**Modify**:
- `.env.example` — add all new env vars from design §2.13 (FFMPEG_PATH, IMAGE_PROVIDER, IMAGE_PROVIDER_API_KEY, IMAGE_MODEL, VIDEO_PROVIDER, VIDEO_PROVIDER_API_KEY, VIDEO_MODEL, VIDEO_POLL_INTERVAL_MS, VIDEO_OPERATION_TIMEOUT_MS, AUDIO_PROVIDER, AUDIO_PROVIDER_API_KEY, RENDER_TIMEOUT_MS, RENDER_CONCURRENCY, COST_LIMIT_DEFAULT_CENTS, MEDIA_UPLOAD_MAX_BYTES).
**Acceptance**:
- `assertFfmpegConfigured()` throws when env unset.
- `.env.example` documents all new vars with defaults.
- Unit test: `tests/ffmpeg-config.test.ts`.

---

### Task 1.8 — Phase 1 integration test
**ID**: T1.8
**Satisfies**: MP-I-001, MP-I-003, MP-I-005, MP-I-007
**Depends on**: T1.1–T1.7
**Create**:
- `tests/phase1-foundation.test.ts` — end-to-end: enqueue a mock `image.character_reference` job → worker processes → CostEvent recorded → job completed. Verify idempotency (duplicate key returns existing job). Verify failure classification mapping.
**Acceptance**:
- Mock job completes end-to-end through existing BullMQ worker.
- No paid API calls made.
- All existing tests still pass.

---

# Phase 2 — Visual Assets

> Character/environment/object visual profiles, reference image generation/upload, approval + versioning, ImagePromptBuilder, Visual Assets UI. Exit criteria: references generated/uploaded, approved, archived with version history.

---

### Task 2.1 — Extend CanonicalEntity: visualProfile + object entityType + defaultReferenceAssetId + voiceProfileId
**ID**: T2.1
**Satisfies**: MP-A-001, MP-A-009, MP-A-012, MP-J-017
**Depends on**: —
**Modify**:
- `lib/models/canonicalEntity.ts` — add `"object"` to `entityType` enum. Add embedded `visualProfile` subdocument (discriminated by entityType): character → {appearance, facial, hair, clothing, distinguishingFeatures, bodyType, voiceNotes, continuityNotes, defaultPresentation}; location → {geography, architecture, materials, colourPalette, lighting, weather, atmosphere, continuityNotes}; object → {description, materials, colourPalette, continuityNotes}. Add `defaultReferenceAssetId: ObjectId | null` (default null). Add `voiceProfileId: ObjectId | null` (default null).
- `lib/validation/production.ts` (or co-located) — add Zod schema for visualProfile variants.
**Acceptance**:
- Existing CanonicalEntity documents remain valid (new fields default null/empty).
- `entityType: "object"` accepted.
- Unit test: `tests/canonical-entity-visual-profile.test.ts`.

---

### Task 2.2 — Extend MediaAsset: archived status + version chain + canonicalEntityId
**ID**: T2.2
**Satisfies**: MP-A-002, MP-A-003, MP-A-013, MP-F-006, MP-F-007, MP-J-013, MP-J-015
**Depends on**: —
**Modify**:
- `lib/models/mediaAsset.ts` — add `"archived"` to `MEDIA_REVIEW_STATUSES`. Add `previousVersionId: ObjectId | null`, `replacedById: ObjectId | null`, `canonicalEntityId: ObjectId | null` (all default null). Add index `{clerkUserId, canonicalEntityId, type, reviewStatus}`.
- `lib/validation/mediaAsset.ts` — extend review status enum; add optional fields to schema.
**Acceptance**:
- Existing assets remain valid.
- `archived` status accepted.
- Version chain fields nullable.
- Unit test: `tests/media-asset-extensions.test.ts`.

---

### Task 2.3 — ImagePromptBuilder
**ID**: T2.3
**Satisfies**: MP-C-009, MP-A-008, MP-J-015
**Depends on**: T2.1
**Create**:
- `lib/providers/media/prompt/image.ts` — pure function `buildImagePrompt(shot, characterRefs, environmentRef, objectRefs, projectStyle, sceneLighting)` → `ImagePrompt { subject, environment, style, lighting, camera, composition, continuityNotes }`. Selects only shot-relevant context; caps total text ≤2000 chars; excludes world rules/themes/boundaries not visually relevant. Reference images passed as `referenceImages` array, not concatenated into text.
**Acceptance**:
- Output is a structured typed object, not a raw string dump.
- Total assembled text ≤2000 chars.
- Does not include Story Bible sections irrelevant to the shot.
- Unit test: `tests/image-prompt-builder.test.ts`.

---

### Task 2.4 — VisualAssetService
**ID**: T2.4
**Satisfies**: MP-A-001–A-008, MP-A-013, MP-A-014, MP-J-011, MP-J-012
**Depends on**: T2.1, T2.2, T2.3, T1.2, T1.5
**Create**:
- `lib/services/visualAssetService.ts` — methods:
  - `requestReference(actor, projectId, canonicalEntityId, kind)` — verify entity approved; enqueue `image.{kind}_reference` job (idempotent).
  - `uploadReference(actor, projectId, canonicalEntityId, bytes, metadata)` — `validateMediaBytes` → `mediaAssetService.storeVerified` with `canonicalEntityId` → `reviewStatus: "pending"`.
  - `approveReference(actor, assetId)` — set `approved`; designate as `defaultReferenceAssetId` on CanonicalEntity; archive previous approved reference (set `archived`, `previousVersionId`/`replacedById`).
  - `rejectReference(actor, assetId)` — set `rejected`.
  - `listReferences(actor, projectId, canonicalEntityId)` — list assets by entity + status.
  - Canon guard helper: `getApprovedReferences(actor, canonicalEntityId)` — returns only `approved` assets.
**Acceptance**:
- Approving a new reference archives the previous one with version chain set.
- Rejected/draft assets never returned by `getApprovedReferences`.
- Ownership checked on every method.
- Unit test: `tests/visual-asset-service.test.ts`.

---

### Task 2.5 — Worker handler: image.*_reference jobs
**ID**: T2.5
**Satisfies**: MP-A-002, MP-C-003, MP-C-006, MP-I-004
**Depends on**: T2.4, T1.6
**Modify**:
- `lib/pipeline/processJob.ts` — implement handler branches for `image.character_reference`, `image.environment_reference`, `image.object_reference`: load entity → build prompt → select ImageProvider via registry → `generate()` → validate bytes → store MediaAsset with `canonicalEntityId` + `reviewStatus: "pending"` → record CostEvent → mark job completed. On failure, set `failureClassification`.
**Acceptance**:
- Mock provider produces a stored MediaAsset with `mock: true` flag in metadata.
- Job completed → asset exists with `reviewStatus: "pending"`.
- Failed job → `failureClassification` set; retryable transient errors retried.
- Unit test: `tests/reference-generation-job.test.ts`.

---

### Task 2.6 — Visual Asset API routes
**ID**: T2.6
**Satisfies**: MP-A-002, MP-A-003, MP-A-005, MP-A-014, MP-J-021
**Depends on**: T2.4
**Create**:
- `app/api/projects/[projectId]/visual-assets/route.ts` — GET: list visual profiles + references.
- `app/api/projects/[projectId]/visual-assets/characters/[entityId]/reference/route.ts` — POST: request or upload reference.
- `app/api/projects/[projectId]/visual-assets/environments/[entityId]/reference/route.ts` — POST: environment reference.
- `app/api/projects/[projectId]/visual-assets/objects/route.ts` — POST: create object profile (entityType=object).
- `app/api/projects/[projectId]/media/[assetId]/review/route.ts` — PATCH: approve/reject (set reviewStatus).
**Acceptance**:
- All routes wrapped in `logged()` + `readActor()` + ownership check.
- No raw `storageKey` or filesystem path in responses.
- Zod-validated inputs.
- Unit test: `tests/visual-asset-routes.test.ts`.

---

### Task 2.7 — Visual Assets workspace UI
**ID**: T2.7
**Satisfies**: MP-A-001, MP-A-005, MP-A-014
**Depends on**: T2.6
**Create**:
- `app/(studio)/projects/[projectId]/visual-assets/page.tsx` — client component; lists characters/environments/objects with reference images, approval states, approve/reject buttons, upload form. Reuses existing `StageLayout` + `useProject` + SWR polling.
- `app/(studio)/projects/[projectId]/visual-assets/visualAssets.module.css` — CSS Module scoped styles; reuses existing `globals.css` `.studio-field` etc.
**Acceptance**:
- Page renders with existing dark-theme variables.
- No Tailwind classes introduced.
- Approve/reject calls the PATCH route.
- `npm run typecheck && npm run lint` pass.

---

### Task 2.8 — Phase 2 integration test
**ID**: T2.8
**Satisfies**: MP-A-001–A-014
**Depends on**: T2.1–T2.7
**Create**:
- `tests/phase2-visual-assets.test.ts` — full flow: create character entity → request reference (mock) → job completes → asset pending → approve → becomes default → request new reference → approve → previous archived with version chain → reject one → verify canon guard excludes rejected.
**Acceptance**: All assertions pass; no paid API calls.

---

# Phase 3 — Shot Production

> ShotProductionRecord, ShotProductionService with gates, real image adapter structure, video mock + Veo adapter structure, VideoPromptBuilder, Shot Production UI. Exit criteria: shots generated per plan, scene completion gate works, duration splitting, no silent provider switch.

---

### Task 3.1 — ShotProductionRecord model
**ID**: T3.1
**Satisfies**: MP-B-001, MP-B-010
**Depends on**: —
**Create**:
- `lib/models/shotProductionRecord.ts` — `ShotProductionRecordSchema`: clerkUserId, projectId, productionSceneId, shotNumber, productionStatus ("pending"|"in_progress"|"completed"|"failed"), generationContext (embedded: prompt, referenceAssetIds, provider, model, settings), resultingAssetIds (ObjectId[]), segments (embedded: segmentNumber, durationSeconds, assetId), adjustedDurationSeconds, validationInfo (Mixed), idempotencyKey. Indexes: `{clerkUserId,productionSceneId,shotNumber}`, `{clerkUserId,projectId,productionStatus}`.
- `lib/validation/shotProduction.ts` — Zod schema + `ShotProductionRecord` type.
- `lib/repositories/shotProductionRepository.ts` — CRUD + `findByScene`, `findPending`.
**Acceptance**:
- Model + validator + repository compile.
- Unit test: `tests/shot-production-record.test.ts`.

---

### Task 3.2 — Extend ProductionScene: productionStatus + approvedAt
**ID**: T3.2
**Satisfies**: MP-B-002, MP-B-003, MP-B-004, MP-B-005
**Depends on**: —
**Modify**:
- `lib/models/productionScene.ts` — add `productionStatus: "pending"|"in_progress"|"complete"` (default "pending"), `approvedAt: Date | null` (default null).
**Acceptance**:
- Existing scenes remain valid (default "pending").
- Unit test: `tests/production-scene-extension.test.ts`.

---

### Task 3.3 — VideoPromptBuilder
**ID**: T3.3
**Satisfies**: MP-D-009, MP-B-011
**Depends on**: T2.3
**Create**:
- `lib/providers/media/prompt/video.ts` — pure function `buildVideoPrompt(shot, characterRefs, environmentRef, objectRefs, projectStyle, sceneLighting, segmentNote?)` → `VideoPrompt { staticScene: ImagePrompt, motion, cameraMovement, durationSeconds, segmentNote }`. Motion describes character action, environmental response, camera movement — not just a static description.
**Acceptance**:
- Output includes motion + cameraMovement fields distinct from static scene.
- Segment note included when shot was split.
- Unit test: `tests/video-prompt-builder.test.ts`.

---

### Task 3.4 — ShotProductionService
**ID**: T3.4
**Satisfies**: MP-B-001–B-012, MP-J-014, MP-J-016
**Depends on**: T3.1, T3.2, T3.3, T2.4, T1.5
**Create**:
- `lib/services/shotProductionService.ts` — methods:
  - `createRecordsFromPlan(actor, sceneId)` — create ShotProductionRecord per shot in approved plan.
  - `verifyGates(actor, sceneId)` — check screenplay + scene breakdown + shot plan all approved; throw `gates_not_met` if not.
  - `generateShot(actor, shotRecordId)` — single-shot enqueue (`image.shot` or `video.shot`).
  - `generateScene(actor, sceneId)` — enqueue all eligible shots.
  - `retryScene(actor, sceneId)` — only failed/rejected/not-yet-generated; skip approved.
  - `regenerateRejected(actor, shotRecordId)` — new job, preserve rejected asset (new record, link previousVersionId).
  - `evaluateSceneCompletion(sceneId)` — all shots approved → `productionStatus: "complete"`; else `in_progress`.
  - Duration splitting: if shot duration > provider `maxClipDurationSeconds` → create segments; record `adjustedDurationSeconds` without silently changing scene duration.
  - `markStale(actor, sceneId)` — when approved shot plan modified after generation, mark affected records stale.
**Acceptance**:
- Gates reject when preconditions unmet.
- Scene not marked complete until all shots have approved media.
- Regeneration preserves rejected asset.
- Duration splitting creates segments; scene duration not silently changed.
- Unit test: `tests/shot-production-service.test.ts`.

---

### Task 3.5 — Worker handlers: image.shot + video.shot
**ID**: T3.5
**Satisfies**: MP-B-006, MP-B-007, MP-C-003, MP-D-005–D-008, MP-D-015, MP-I-004
**Depends on**: T3.4, T1.2, T1.3, T1.6
**Modify**:
- `lib/pipeline/processJob.ts` — implement `image.shot` handler: load ShotProductionRecord → build image prompt → inject approved references → CostGuard.check → select ImageProvider → generate → validate → store MediaAsset → update record. Implement `video.shot` handler: build video prompt → select VideoProvider → submit → poll loop (10–60s via `VIDEO_POLL_INTERVAL_MS`) → on completed: download bytes → FFprobe validate → store → update record; on failed: set failureClassification; timeout → `render_timeout`-style code. Record CostEvent on completion.
**Acceptance**:
- Mock image shot completes → asset stored with `mock: true`.
- Mock video shot: submit → poll → completed → FFprobe validation → asset stored.
- Video job not marked successful until bytes retrieved + validated + registered.
- Unit test: `tests/shot-generation-job.test.ts`.

---

### Task 3.6 — BFL image adapter (guarded, optional)
**ID**: T3.6
**Satisfies**: MP-C-008, MP-J-006, MP-J-022
**Depends on**: T1.2
**Create**:
- `lib/providers/media/image/bfl.ts` — `BflImageProvider` implementing `ImageProvider`. Constructor reads `IMAGE_PROVIDER_API_KEY`; throws `provider_not_configured` if absent (registry catches → falls back to mock). `isPaid: true`. Makes real HTTP call only when enabled + key present + creator initiated. Never logs key.
**Acceptance**:
- Construction throws without key; registry falls back to mock.
- Never selected without creator initiation.
- No real API call in tests (mock used).
- Unit test: `tests/bfl-adapter-gating.test.ts` (mock fetch; verify gating only).

---

### Task 3.7 — Veo video adapter structure
**ID**: T3.7
**Satisfies**: MP-D-008, MP-D-011–D-014, MP-D-016
**Depends on**: T1.3
**Create**:
- `lib/providers/media/video/veo.ts` — `VeoVideoProvider` implementing `VideoProvider` async lifecycle: submit → POST to Veo long-running op endpoint → store operationId; poll → GET op status → processing | completed (download URI → bytes) | failed (map content-policy → `content_rejected` non-retryable); cancel → best-effort cancel. Constructor reads `VIDEO_PROVIDER_API_KEY`; throws if absent. `isPaid: true`. `capabilities` declares supportsImageToVideo, maxClipDurationSeconds per Veo model.
**Acceptance**:
- Adapter structure complete; no real API calls in tests.
- Failure mapping: content rejection → permanent; transient → retryable.
- No silent model/provider substitution.
- Unit test: `tests/veo-adapter-structure.test.ts` (mock HTTP; verify lifecycle + error mapping).

---

### Task 3.8 — Shot Production API routes
**ID**: T3.8
**Satisfies**: MP-B-006–B-009, MP-J-021
**Depends on**: T3.4
**Create**:
- `app/api/projects/[projectId]/scenes/[sceneId]/shots/route.ts` — GET: list ShotProductionRecords.
- `app/api/projects/[projectId]/scenes/[sceneId]/shots/generate/route.ts` — POST: generate all eligible shots.
- `app/api/projects/[projectId]/scenes/[sceneId]/shots/[shotId]/generate/route.ts` — POST: single shot.
- `app/api/projects/[projectId]/scenes/[sceneId]/retry/route.ts` — POST: retry failed/rejected only.
**Acceptance**:
- All routes auth + ownership checked; Zod-validated.
- Unit test: `tests/shot-production-routes.test.ts`.

---

### Task 3.9 — Shot Production workspace UI
**ID**: T3.9
**Satisfies**: MP-B-006, MP-B-008
**Depends on**: T3.8
**Create**:
- `app/(studio)/projects/[projectId]/shots/page.tsx` — lists scenes → shots with status, descriptions, reference thumbnails, generated image/video preview, approve/reject, retry/regenerate buttons. SWR polling for job status.
- `app/(studio)/projects/[projectId]/shots/shots.module.css`.
**Acceptance**:
- Renders with existing theme; no Tailwind.
- Approve/reject/retry call correct routes.
- `npm run typecheck && npm run lint` pass.

---

### Task 3.10 — Phase 3 integration test
**ID**: T3.10
**Satisfies**: MP-B-001–B-012, MP-C-001–C-012, MP-D-001–D-016
**Depends on**: T3.1–T3.9
**Create**:
- `tests/phase3-shot-production.test.ts` — full flow: approved scene with shot plan → create records → generate all (mock) → jobs complete → assets pending → approve all → scene productionStatus=complete. Test duration splitting when provider maxClipDuration < shot duration. Test rejected asset preservation on regenerate. Test no silent provider switch.
**Acceptance**: All pass; no paid API calls.

---

# Phase 4 — Audio

> VoiceProfile, AudioProvider mock + Kokoro structure, AudioProductionService, audio UI. Exit criteria: dialogue from approved screenplay only, voice consistency, SFX/music + licensing, duration mismatch flags.

---

### Task 4.1 — VoiceProfile model
**ID**: T4.1
**Satisfies**: MP-E-001, MP-E-002
**Depends on**: T2.1
**Create**:
- `lib/models/voiceProfile.ts` — `VoiceProfileSchema`: clerkUserId, projectId, canonicalEntityId (character), voiceDescription, preferredProvider, voiceIdentifier, language, accent, speakingStyle, emotionalCharacteristics, status ("draft"|"approved"), idempotencyKey. Index `{clerkUserId,canonicalEntityId,status}` unique partial (status=approved) → one approved voice per character.
- `lib/validation/voiceProfile.ts` — Zod + type.
- `lib/repositories/voiceProfileRepository.ts` — CRUD + `findApprovedForCharacter`.
**Acceptance**:
- One approved voice profile per character enforced.
- Unit test: `tests/voice-profile.test.ts`.

---

### Task 4.2 — AudioProductionService
**ID**: T4.2
**Satisfies**: MP-E-003–E-012
**Depends on**: T4.1, T1.4, T1.5
**Create**:
- `lib/services/audioProductionService.ts` — methods:
  - `generateDialogue(actor, sceneId, shotRecordId?)` — load approved screenplay dialogue lines for speaker; refuse if none (MP-E-005); apply creator text override preserving original (MP-E-006); require approved VoiceProfile (MP-E-003); enqueue `audio.dialogue` job.
  - `generateNarration(actor, sceneId, text)` — enqueue `audio.narration`.
  - `generateSfx(actor, sceneId, description)` — enqueue `audio.sfx` (MP-E-007).
  - `addMusic(actor, sceneId, assetId, volume, timing, licensing)` — record association + licensing; reject unlicensed copyrighted music (MP-E-008, E-009).
  - `validateAudio(assetId)` — FFprobe validation; flag dialogue duration > shot video duration (MP-E-010, E-011, E-012).
**Acceptance**:
- Dialogue only from approved screenplay; invented dialogue rejected.
- Voice profile required for dialogue.
- Unlicensed music rejected.
- Duration mismatch flagged.
- Unit test: `tests/audio-production-service.test.ts`.

---

### Task 4.3 — Worker handlers: audio.* jobs
**ID**: T4.3
**Satisfies**: MP-E-004, MP-E-010, MP-I-004
**Depends on**: T4.2, T1.4, T1.6
**Modify**:
- `lib/pipeline/processJob.ts` — implement `audio.dialogue`, `audio.narration`, `audio.sfx`, `audio.music` handlers: load context → select AudioProvider → generate → FFprobe validate → store MediaAsset → record CostEvent → update job. `audio.music` may register an uploaded asset rather than generate.
**Acceptance**:
- Mock audio job completes → WAV asset stored with `mock: true`.
- FFprobe validation runs before storing.
- Unit test: `tests/audio-generation-job.test.ts`.

---

### Task 4.4 — Kokoro audio adapter structure (guarded, optional)
**ID**: T4.4
**Satisfies**: MP-J-006, MP-J-022
**Depends on**: T1.4
**Create**:
- `lib/providers/media/audio/kokoro.ts` — `KokoroAudioProvider` implementing `AudioProvider`. Constructor reads `AUDIO_PROVIDER_API_KEY`; throws if absent. `isPaid: true` (or local-only flag). Real call only when configured.
**Acceptance**:
- Gating works; no real call in tests.
- Unit test: `tests/kokoro-adapter-gating.test.ts`.

---

### Task 4.5 — Audio API routes
**ID**: T4.5
**Satisfies**: MP-E-001, MP-E-004, MP-E-007, MP-E-008, MP-J-021
**Depends on**: T4.2
**Create**:
- `app/api/projects/[projectId]/characters/[entityId]/voice-profile/route.ts` — POST/GET: create/list voice profiles.
- `app/api/projects/[projectId]/scenes/[sceneId]/audio/dialogue/route.ts` — POST: generate dialogue.
- `app/api/projects/[projectId]/scenes/[sceneId]/audio/sfx/route.ts` — POST: generate SFX.
- `app/api/projects/[projectId]/scenes/[sceneId]/audio/music/route.ts` — POST: add music + licensing.
**Acceptance**:
- Auth + ownership + Zod validation.
- Unit test: `tests/audio-routes.test.ts`.

---

### Task 4.6 — Audio workspace UI
**ID**: T4.6
**Satisfies**: MP-E-001, MP-E-004, MP-E-012
**Depends on**: T4.5
**Create**:
- `app/(studio)/projects/[projectId]/audio/page.tsx` — voice profile assignment per character, dialogue list with previews, SFX/music sections, generation status, duration mismatch flags.
- `app/(studio)/projects/[projectId]/audio/audio.module.css`.
**Acceptance**:
- Renders with existing theme; no Tailwind.
- `npm run typecheck && npm run lint` pass.

---

### Task 4.7 — Phase 4 integration test
**ID**: T4.7
**Satisfies**: MP-E-001–E-012
**Depends on**: T4.1–T4.6
**Create**:
- `tests/phase4-audio.test.ts` — full flow: assign voice profile → generate dialogue from approved screenplay → mock completes → validate → flag mismatch. Test unlicensed music rejection. Test voice consistency (same profile across episodes).
**Acceptance**: All pass; no paid API calls.

---

# Phase 5 — Film Assembly

> Timeline model, TimelineAssemblyService with validation, assembly UI. Exit criteria: auto-generated timeline from actual durations, missing-media/overlap/broken-ref detection, approval gate.

---

### Task 5.1 — Timeline model (with embedded tracks/clips)
**ID**: T5.1
**Satisfies**: MP-G-001
**Depends on**: —
**Create**:
- `lib/models/timeline.ts` — `TimelineSchema`: clerkUserId, projectId, episodeId, tracks (embedded TimelineTrack[]: kind video|dialogue|narration|music|sfx|subtitle, clips[]), aspectRatio, outputResolution, frameRate, episodeTargetDurationSeconds, status ("draft"|"under_review"|"approved"|"stale"), validation (embedded: missingAssets[], overlaps[], brokenReferences[], durationMismatch, warnings[]), idempotencyKey. Indexes: `{clerkUserId,episodeId}` unique, `{clerkUserId,projectId,status}`.
- `TimelineClip` embedded: assetId, startSeconds, durationSeconds, audioOffsetSeconds, transition, optional.
- `lib/validation/timeline.ts` — Zod + type.
- `lib/repositories/timelineRepository.ts` — CRUD + `findByEpisode`.
**Modify**:
- `lib/models/episode.ts` — add `timelineId: ObjectId | null` (default null).
**Acceptance**:
- Model + validator + repository compile.
- One timeline per episode enforced.
- Unit test: `tests/timeline-model.test.ts`.

---

### Task 5.2 — TimelineAssemblyService
**ID**: T5.2
**Satisfies**: MP-G-002–G-011
**Depends on**: T5.1, T3.1
**Create**:
- `lib/services/timelineAssemblyService.ts` — methods:
  - `autoGenerate(actor, episodeId)` — build Timeline from approved scene order, shot order, **actual** video durations (FFprobe, not estimates), approved audio, transitions, episode duration target. Set status `under_review`.
  - `validate(timelineId)` — check missing required media (MP-G-004), allow optional missing (MP-G-006), detect overlapping clips (MP-G-007), broken references (MP-G-008), duration mismatch vs target (MP-G-011). Return structured `ValidationResult`.
  - `preview(actor, episodeId)` — return assembly plan for creator review (MP-G-009).
  - `approve(actor, timelineId)` — set `approved`; rendering cannot start before this (MP-G-010).
  - `markStale(actor, episodeId)` — when downstream media changes after approval.
**Acceptance**:
- Timeline uses actual durations when available, estimates as fallback.
- Missing required media flagged; optional allowed.
- Overlaps + broken refs detected.
- Approval gate enforced.
- Unit test: `tests/timeline-assembly-service.test.ts`.

---

### Task 5.3 — Worker handler: assembly.generate job
**ID**: T5.3
**Satisfies**: MP-G-002, MP-I-004
**Depends on**: T5.2, T1.6
**Modify**:
- `lib/pipeline/processJob.ts` — implement `assembly.generate` handler: call `timelineAssemblyService.autoGenerate` → `validate` → store Timeline → mark job completed.
**Acceptance**:
- Job completes → Timeline created with validation results.
- Unit test: `tests/assembly-job.test.ts`.

---

### Task 5.4 — Assembly API routes
**ID**: T5.4
**Satisfies**: MP-G-002, MP-G-009, MP-G-010, MP-J-021
**Depends on**: T5.2
**Create**:
- `app/api/projects/[projectId]/episodes/[episodeId]/assembly/route.ts` — POST: auto-generate + validate; GET: preview.
- `app/api/projects/[projectId]/episodes/[episodeId]/assembly/approve/route.ts` — POST: approve.
**Acceptance**:
- Auth + ownership + Zod.
- Unit test: `tests/assembly-routes.test.ts`.

---

### Task 5.5 — Assembly workspace UI
**ID**: T5.5
**Satisfies**: MP-G-009, MP-G-010
**Depends on**: T5.4
**Create**:
- `app/(studio)/projects/[projectId]/assembly/page.tsx` — read-only timeline preview: scene/shot order, video previews, audio tracks, durations, missing-asset warnings, validation findings, approve button (gated until no blocking errors).
- `app/(studio)/projects/[projectId]/assembly/assembly.module.css`.
**Acceptance**:
- Read-only (not a frame editor).
- Approve disabled when blocking validation errors exist.
- `npm run typecheck && npm run lint` pass.

---

### Task 5.6 — Phase 5 integration test
**ID**: T5.6
**Satisfies**: MP-G-001–G-011
**Depends on**: T5.1–T5.5
**Create**:
- `tests/phase5-assembly.test.ts` — full flow: episode with approved shots + audio → auto-generate timeline → validate (no missing) → approve. Test missing-media detection. Test overlap detection. Test actual-duration preference over estimates.
**Acceptance**: All pass.

---

# Phase 6 — Rendering

> RenderJob, RenderPreset, FFmpegRenderEngine, RenderService, rendering UI. Exit criteria: real FFmpeg render via arg array, FFprobe validation, cancel/cleanup, 3 presets, no shell injection.

---

### Task 6.1 — RenderJob model + RenderPreset registry
**ID**: T6.1
**Satisfies**: MP-H-004, MP-H-005, MP-H-006, MP-H-007
**Depends on**: —
**Create**:
- `lib/models/renderJob.ts` — `RenderJobSchema`: clerkUserId, projectId, episodeId, timelineId, presetId, inputAssetIds (ObjectId[]), outputAssetId, renderSettings (Mixed), ffmpegVersion, renderDurationSeconds, status ("queued"|"processing"|"completed"|"failed"|"cancelled"), error (Mixed), idempotencyKey, bullJobId, startedAt, completedAt. Indexes: `{clerkUserId,timelineId}`, `{clerkUserId,status}`.
- `lib/validation/renderJob.ts` — Zod + type.
- `lib/repositories/renderJobRepository.ts` — CRUD + `findByTimeline`, `findActive`.
- `lib/providers/media/ffmpeg/presets.ts` — three `RenderPreset` constants: `vertical_9_16` (1080×1920, 30fps), `landscape_16_9` (1920×1080, 30fps), `square_1_1` (1080×1080, 30fps). All libx264, yuv420p.
**Modify**:
- `lib/models/episode.ts` — add `renderAssetId: ObjectId | null` (default null).
**Acceptance**:
- Model + validator + repository compile.
- Three presets exported.
- Unit test: `tests/render-job-model.test.ts`.

---

### Task 6.2 — FFmpeg command builder
**ID**: T6.2
**Satisfies**: MP-H-001, MP-H-010
**Depends on**: T6.1
**Create**:
- `lib/providers/media/ffmpeg/commandBuilder.ts` — pure function `buildFFmpegArgs(plan: RenderPlan): string[]` returning an **argument array** (never a shell string). Pipeline stages per design §2.8.1: input concat (concat demuxer file with sanitized temp paths), dimension normalization (scale+setsar), fps normalization, codec (libx264/aac), audio mixing (amix with per-track volume + music ducking), subtitle burn-in, transitions (xfade), output flags (preset fast, +faststart). All paths are sanitized temp filenames, never user text.
**Acceptance**:
- Returns string[] (argument array), no shell interpolation possible.
- No user-supplied text in args (only sanitized temp paths).
- Unit test: `tests/ffmpeg-command-builder.test.ts` (snapshot arg array for each preset).

---

### Task 6.3 — FFmpegRenderEngine
**ID**: T6.3
**Satisfies**: MP-H-001, MP-H-002, MP-H-008, MP-H-009, MP-H-010–H-015
**Depends on**: T6.2, T1.7
**Create**:
- `lib/providers/media/ffmpeg/engine.ts` — `FFmpegRenderEngine` implementing `render(plan, signal: AbortSignal): Promise<RenderResult>`. Flow per design §2.8.3:
  1. `assertFfmpegConfigured()`.
  2. Download all input assets from StorageProvider to `workDir` (ownership-checked).
  3. Verify each input via `FFprobeMediaInspector` — reject invalid (MP-F-014).
  4. Build args via `buildFFmpegArgs`; invoke `execFile(FFMPEG_PATH, args, { timeout, signal })`.
  5. Exit 0 → validate output via FFprobe (MP-H-008); missing/invalid → `render_output_invalid` (MP-H-009, H-014).
  6. Non-zero exit → truncate stderr ≤4KB, store on RenderJob.error, mark failed (MP-H-013).
  7. Timeout/abort → kill process, `render_timeout` (MP-H-015).
  8. `finally` → delete `workDir` recursively (MP-H-012).
  9. Return `{ bytes, mimeType, ffmpegVersion, renderDurationSeconds }`.
**Acceptance**:
- Uses `execFile` (not `exec`); no shell string.
- AbortSignal cancels + kills only this job's process.
- Temp dir always cleaned (finally).
- Output validated via FFprobe before return.
- Unit test: `tests/ffmpeg-engine.test.ts` (mock execFile + FFprobe; verify flow, cancel, cleanup, error mapping).

---

### Task 6.4 — RenderService
**ID**: T6.4
**Satisfies**: MP-H-005, MP-H-006, MP-H-007, MP-H-011, MP-I-012, MP-I-015
**Depends on**: T6.1, T6.3, T5.1
**Create**:
- `lib/services/renderService.ts` — methods:
  - `triggerRender(actor, timelineId, presetId)` — require `timeline.status === "approved"` (MP-G-010); create RenderJob recording input assets + settings (MP-H-006); enqueue `render.final` job via existing BullMQ (render queue concurrency=1, MP-I-012).
  - `recordCompletion(renderJobId, outputAsset, ffmpegVersion, duration)` — set completed, link outputAssetId, set Episode.renderAssetId (MP-H-007).
  - `cancel(renderJobId)` — set `cancelled`, kill FFmpeg process for that job only, preserve completed assets (MP-H-011, I-015).
  - `getStatus(renderJobId)` — return status + progress.
**Acceptance**:
- Render rejected if timeline not approved.
- Cancel kills only the target job's process.
- Render queue concurrency=1 (existing).
- Unit test: `tests/render-service.test.ts`.

---

### Task 6.5 — Worker handler: render.final (real FFmpeg)
**ID**: T6.5
**Satisfies**: MP-H-001–H-015, MP-I-004
**Depends on**: T6.4, T6.3, T1.6
**Modify**:
- `lib/pipeline/processJob.ts` — replace mock `render.final` handler with real: load RenderJob → load Timeline + input assets → `FFmpegRenderEngine.render(plan, signal)` → on success: store output as MediaAsset (`final_render` type) → `renderService.recordCompletion` → record CostEvent → mark job completed. On failure: store error, mark failed with failureClassification. Honor AbortSignal for cancel.
**Acceptance**:
- Real FFmpeg invoked when `FFMPEG_PATH` configured.
- `ffmpeg_not_configured` when unset → job failed (no retry).
- Output registered as MediaAsset only after FFprobe validation.
- Mock FFmpeg in tests (no real binary required).
- Unit test: `tests/render-job-handler.test.ts`.

---

### Task 6.6 — Render API routes
**ID**: T6.6
**Satisfies**: MP-H-005, MP-H-006, MP-H-011, MP-J-021
**Depends on**: T6.4
**Create**:
- `app/api/projects/[projectId]/episodes/[episodeId]/render/route.ts` — POST: trigger render (body: presetId); GET: render status.
- `app/api/projects/[projectId]/render/[renderJobId]/cancel/route.ts` — POST: cancel.
- `app/api/projects/[projectId]/cost/route.ts` — GET: cost summary (aggregate CostEvents).
**Acceptance**:
- Auth + ownership + Zod.
- No raw filesystem paths in responses.
- Unit test: `tests/render-routes.test.ts`.

---

### Task 6.7 — Rendering workspace UI
**ID**: T6.7
**Satisfies**: MP-H-003, MP-H-004, MP-H-005
**Depends on**: T6.6
**Create**:
- `app/(studio)/projects/[projectId]/rendering/page.tsx` — preset selector (3 presets + custom resolution/fps), trigger render button (gated on assembly approval), progress display, error display, cancel button, final video preview + download link.
- `app/(studio)/projects/[projectId]/rendering/rendering.module.css`.
**Acceptance**:
- Renders with existing theme; no Tailwind.
- Trigger disabled until timeline approved.
- SWR polling for progress.
- `npm run typecheck && npm run lint` pass.

---

### Task 6.8 — Phase 6 integration test
**ID**: T6.8
**Satisfies**: MP-H-001–H-015, MP-F-008, MP-F-014
**Depends on**: T6.1–T6.7
**Create**:
- `tests/phase6-rendering.test.ts` — full flow: approved timeline → trigger render (mock FFmpeg) → job processing → completed → output validated → registered as MediaAsset → Episode.renderAssetId set. Test cancel → cancelled + temp cleaned. Test `ffmpeg_not_configured` → failed. Test render with missing asset → rejected before FFmpeg. Test dependency check prevents deleting asset referenced by render.
**Acceptance**: All pass; no real FFmpeg binary required (mock execFile).

---

# Cross-Cutting Tasks

---

### Task X.1 — Update .env.example with all new variables
**ID**: TX.1
**Satisfies**: MP-H-002, MP-C-005, MP-D-013, MP-J-008
**Depends on**: T1.7
**Modify**: `.env.example` — add all env vars from design §2.13 with documented defaults.
**Acceptance**: All vars documented; defaults make app usable with mock providers only.

---

### Task X.2 — Ensure indexes script
**ID**: TX.2
**Satisfies**: —
**Depends on**: T1.5, T3.1, T4.1, T5.1, T6.1
**Create**: `scripts/ensure-indexes.ts` — explicitly create all new indexes without relying on autoIndex.
**Acceptance**: Script runs and creates indexes idempotently.

---

### Task X.3 — Update AGENTS.md with media production section
**ID**: TX.3
**Satisfies**: —
**Depends on**: all phases
**Modify**: `AGENTS.md` — document new provider interfaces, job types, models, env vars, and the media production pipeline stages.
**Acceptance**: Documentation accurate; no secrets documented.

---

### Task X.4 — Full regression test run
**ID**: TX.4
**Satisfies**: —
**Depends on**: all phases
**Acceptance**: `npm run typecheck && npm run lint && npm test` all pass. No existing tests weakened. No paid API calls in any test.

---

## Summary

| Phase | Tasks | New Models | New Files (approx) | Modified Files (approx) |
|---------|---------|---------|---------|---------|
| 1 — Foundation | T1.1–T1.8 | CostEvent | 14 | 4 |
| 2 — Visual Assets | T2.1–T2.8 | — (embedded) | 10 | 4 |
| 3 — Shot Production | T3.1–T3.10 | ShotProductionRecord | 14 | 3 |
| 4 — Audio | T4.1–T4.7 | VoiceProfile | 9 | 2 |
| 5 — Assembly | T5.1–T5.6 | Timeline (+tracks/clips) | 8 | 2 |
| 6 — Rendering | T6.1–T6.8 | RenderJob | 10 | 3 |
| Cross-cutting | TX.1–TX.4 | — | 1 | 2 |
| **Total** | **43 tasks** | **5 new collections** | **~66 new files** | **~20 modified files** |

**New environment variables**: 14 (all server-side, none `NEXT_PUBLIC_`).
**New DB collections**: `costEvents`, `shotProductionRecords`, `voiceProfiles`, `timelines`, `renderJobs`.
**Modified models**: `Project`, `CanonicalEntity`, `MediaAsset`, `GenerationJob`, `ProductionScene`, `Episode`.
**Migrations**: None required (all additive, nullable defaults). Optional backfill script for legacy `videoStatus=completed` scenes.
**Provider integrations actually working after all phases**: Mock image/video/audio (tested). BFL image, Veo video, Kokoro audio — adapter structure complete, gated, not auto-called.
**Mock functionality remaining**: BFL/Veo/Kokoro real calls require explicit creator configuration + API keys. S3/Cloudinary storage adapters remain `not_implemented`.