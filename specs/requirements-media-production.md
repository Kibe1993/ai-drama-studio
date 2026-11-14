# Media Production Pipeline — EARS Requirements Specification

> **Scope**: AI Drama Studio media-production phase — the subsystem that transforms
> approved screenplays, scene breakdowns, and shot plans into generated visual/audio
> media, assembles approved media into ordered timelines, and renders finished videos
> through FFmpeg.
>
> **Notation — EARS (Easy Approach to Requirements Syntax)**
>
> | Pattern | Form | Semantics |
> | --- | --- | --- |
> | **Ubiquitous (U)** | `The system shall <response>.` | Always holds; no precondition. |
> | **State-driven (S)** | `While <state>, the system shall <response>.` | Holds while a precondition state is true. |
> | **Event-driven (E)** | `When <trigger>, the system shall <response>.` | Holds when a triggering event fires. |
> | **Optional (O)** | `When <trigger>, if <precondition>, then the system shall <response>.` | Optional feature under a condition. |
> | **Unwanted (W)** | `If <unwanted precondition>, then the system shall <response>.` | Mitigates an undesirable situation. |
>
> **Phase Index (A–J)**
>
> | ID | Phase |
> | --- | --- |
> | A | Visual Asset & Reference Management |
> | B | Shot-Level Production |
> | C | Image Generation |
> | D | Video Generation |
> | E | Audio Production |
> | F | Media Storage & Asset Lifecycle |
> | G | Timeline & Film Assembly |
> | H | FFmpeg Rendering & Export |
> | I | Production Orchestration & Job Management |
> | J | Provider / Cost Management & Canon Protection |

---

## Phase A — Visual Asset & Reference Management

### A.1 Character Visual Profile

**MP-A-001 (E)** — When a character is extracted from an approved screenplay, the system shall create or update a character visual profile linked to that character and project containing identity, age description, physical appearance, facial characteristics, hair, clothing, distinguishing features, body type, voice characteristics, default visual presentation, and continuity notes.

**MP-A-002 (E)** — When the creator requests a character reference image, the system shall enqueue an image generation job using the character's visual profile and store the result as a `MediaAsset` of type `character_reference`.

**MP-A-003 (E)** — When the creator uploads an existing image for a character, the system shall validate the file signature, store it through the `StorageProvider`, and create a `MediaAsset` of type `character_reference` associated with the project and character.

**MP-A-004 (S)** — While a character reference image is in `draft`, `generating`, `under_review`, `rejected`, or `archived` status, the system shall not use it as a default canon reference.

**MP-A-005 (E)** — When a character reference image is approved, the system shall designate it as the default visual reference for that character in subsequent image and video generation.

**MP-A-006 (E)** — When a new character reference image is generated while an approved reference exists, the system shall store the new image with status `under_review` and shall not change the existing approved reference.

**MP-A-007 (E)** — When the creator explicitly approves a new reference image for a character that already has an approved reference, the system shall archive the previous approved reference, designate the new one as canon, and preserve version history.

**MP-A-008 (W)** — If an approved character reference exists and a new image is generated for that character, then the system shall include the approved reference as input to the image generation request to prevent invented appearance.

### A.2 Environment & Object Visual Profiles

**MP-A-009 (E)** — When a scene breakdown is approved with a location, the system shall create or update an environment visual profile for that location containing geography, architecture, materials, colour palette, lighting, weather, atmosphere, and continuity notes.

**MP-A-010 (O)** — When the creator requests an environment reference, if specific lighting or weather conditions are supplied, then the system shall generate and store the variation while associating it with the same environment profile.

**MP-A-011 (E)** — When an environment reference is generated with different lighting, the system shall record the lighting condition as a variation of the same environment, not as a new environment.

**MP-A-012 (E)** — When the creator identifies an important story object, the system shall create an object visual profile and support generating or uploading reference images for it.

### A.3 Visual Asset Lifecycle

**MP-A-013 (U)** — The system shall transition visual assets through the lifecycle `draft → generating → generated → under_review → approved | rejected`, with `approved → archived` as an explicit replacement path.

**MP-A-014 (E)** — When the creator rejects a visual asset, the system shall set its status to `rejected` and shall not use it in production.

---

## Phase B — Shot-Level Production

### B.1 Shot Production Records

**MP-B-001 (E)** — When a shot plan is approved, the system shall create shot production records for each shot in the plan, reusing the existing shot-plan fields and adding generation context (prompts, reference assets, provider, settings, production status, resulting assets, validation info).

**MP-B-002 (E)** — When shot production is requested, the system shall verify that the screenplay, scene breakdown, and shot plan are all approved before enqueuing generation.

### B.2 Scene Completion Gates

**MP-B-003 (E)** — When all shots in a scene have approved media, the system shall mark the scene as production-complete.

**MP-B-004 (S)** — While any shot in a scene lacks approved media, the system shall not mark the scene as complete.

**MP-B-005 (W)** — If generation jobs are submitted for all shots in a scene but not all have completed with approved media, then the system shall keep the scene status as `in_progress`.

### B.3 Shot Generation & Regeneration

**MP-B-006 (E)** — When the creator requests generation of a single shot, the system shall enqueue a generation job for that shot only.

**MP-B-007 (E)** — When the creator requests generation of all shots in a scene, the system shall enqueue generation jobs for all eligible shots in that scene.

**MP-B-008 (E)** — When the creator requests regeneration of a rejected shot, the system shall create a new generation job and shall not delete the rejected asset.

**MP-B-009 (E)** — When the creator retries a scene, the system shall only regenerate shots that are failed, rejected, or not yet generated, and shall not regenerate shots with approved media.

**MP-B-010 (W)** — If a shot generation produces a new asset that is rejected, then the system shall preserve any previously approved asset for that shot.

### B.4 Duration Handling

**MP-B-011 (O)** — When a requested shot duration exceeds the provider's maximum supported duration, if continuity can be maintained, then the system shall split the shot into multiple planned segments.

**MP-B-012 (W)** — If a shot duration is adjusted due to provider limitations, then the system shall not silently change the intended scene duration and shall record the adjustment.

---

## Phase C — Image Generation

### C.1 Provider-Independent Interface

**MP-C-001 (U)** — The image generation interface shall be provider-independent; the production engine shall not depend directly on a particular image-generation vendor.

**MP-C-002 (E)** — When a new image provider is added, the system shall require only a new adapter and registry entry, with no changes to the production engine.

**MP-C-003 (O)** — When a provider supports image-to-image generation, if reference images are supplied, then the system shall accept them as input.

**MP-C-004 (O)** — When a provider does not support image-to-image generation, if reference images are supplied, then the system shall fall back to text-to-image and record that references were not used.

### C.2 Mock, Local & Commercial Providers

**MP-C-005 (E)** — When no image provider is configured, the system shall use the mock provider and clearly mark output as mock.

**MP-C-006 (S)** — While the mock provider is used, the system shall not mark the output as real media.

**MP-C-007 (U)** — The system shall not assume the user's hardware can run demanding local image models; local image generation shall not be mandatory.

**MP-C-008 (W)** — If a paid image provider is not explicitly configured with an API key, then the system shall not attempt to call it.

### C.3 Prompt Building & Result Recording

**MP-C-009 (E)** — When an image prompt is built, the system shall assemble only relevant information (shot description, approved character/environment/object references, project visual style, lighting, camera, continuity) and shall not concatenate the entire Story Bible.

**MP-C-010 (E)** — When an image is generated, the system shall create a `MediaAsset` record with all generation metadata and store the image bytes through the `StorageProvider`.

**MP-C-011 (E)** — When an image is generated, the system shall make it available for preview with status `under_review` before the creator approves or rejects it.

### C.4 Image Validation Failures

**MP-C-012 (W)** — If the generated image bytes fail MIME or signature validation, then the system shall mark the job as failed with error code `invalid_media`, classified as non-retryable, and shall not create a `MediaAsset`.

---

## Phase D — Video Generation

### D.1 Provider-Independent Architecture

**MP-D-001 (U)** — The video generation interface shall be provider-independent; the production engine shall not be coupled directly to any specific video provider.

**MP-D-002 (E)** — When a new video provider is added, the system shall require only a new adapter and registry entry.

**MP-D-003 (E)** — When the production engine needs to determine if a provider supports image-to-video, the system shall query the provider capability declaration, not make a test API call.

**MP-D-004 (W)** — If a provider does not support reference-guided video, then the system shall declare that capability as unsupported and shall not attempt to pass references.

### D.2 Asynchronous Operation & Completion

**MP-D-005 (E)** — When a video provider accepts a generation request, the system shall keep the job status as `processing` until the video is downloaded, validated, and stored.

**MP-D-006 (E)** — When the video is downloaded and validated, the system shall create a `MediaAsset` and mark the job as `completed`.

**MP-D-007 (U)** — The system shall poll for asynchronous video completion at intervals no more frequent than every 10 seconds and no less frequent than every 60 seconds.

**MP-D-008 (O)** — When a Veo adapter is implemented, if the provider is Google Veo, then the system shall handle request submission, operation identifiers, asynchronous job tracking, status polling, completion detection, result retrieval, downloading, media validation, asset registration, and failure/timeout handling.

### D.3 Prompt of Motion & Clip Splitting

**MP-D-009 (E)** — When a video prompt is built for a shot of a character walking, the system shall describe the walking motion, environmental response, and camera movement, not just the character's static appearance.

**MP-D-010 (O)** — When a provider's maximum clip duration is shorter than the shot's intended duration, if continuity can be maintained, then the system shall generate multiple clips and associate them with the same shot.

### D.4 No Silent Switching

**MP-D-011 (W)** — If a free or local video provider fails, then the system shall mark the job as failed and shall not automatically retry with a paid provider.

**MP-D-012 (W)** — If a video generation job specifies a model, then the system shall use that model or fail, and shall not substitute a different model without creator knowledge.

**MP-D-013 (W)** — If automated tests run, then the system shall use mock providers and shall not call any paid video generation API.

**MP-D-014 (W)** — If a paid video provider is not explicitly enabled, then the system shall not submit generation requests to it.

### D.5 Video Validation Failures

**MP-D-015 (W)** — If the downloaded video fails FFprobe validation (missing streams, invalid duration, corrupt file), then the system shall reject the video, mark the job as failed with error code `invalid_video`, and shall not create a `MediaAsset`.

**MP-D-016 (W)** — If the video provider rejects the prompt due to content policy, then the system shall mark the job as failed with error code `content_rejected`, classified as non-retryable.

---

## Phase E — Audio Production

### E.1 Voice Profiles & Consistency

**MP-E-001 (E)** — When a character is established, the system shall support creating a voice profile linked to that character containing voice description, preferred provider, voice identifier, language, accent, speaking style, and emotional characteristics.

**MP-E-002 (E)** — When a character with an approved voice profile appears in a new episode, the system shall use the same voice provider and identifier to maintain voice consistency.

**MP-E-003 (W)** — If dialogue generation is requested for a character without a voice profile, then the system shall prompt the creator to configure a voice profile before proceeding.

### E.2 Dialogue Source Authority

**MP-E-004 (E)** — When dialogue is generated, the system shall use the approved screenplay's dialogue lines as input.

**MP-E-005 (W)** — If the screenplay does not contain dialogue for a speaker, then the system shall not invent new dialogue.

**MP-E-006 (E)** — When the creator edits dialogue before audio generation, the system shall use the revised text for generation while preserving the original screenplay.

### E.3 Sound Effects & Music

**MP-E-007 (E)** — When a scene requires ambient sound, the system shall support generating or sourcing appropriate sound-effect audio associated with that scene or shot.

**MP-E-008 (E)** — When a music asset is added to a scene, the system shall record its association, volume, and timing.

**MP-E-009 (W)** — If a music asset is added, then the system shall require licensing or usage information to be recorded and shall not use unlicensed copyrighted music.

### E.4 Audio Validation

**MP-E-010 (E)** — When an audio asset is generated or uploaded, the system shall validate it with FFprobe and record duration, sample rate, channels, codec, file size, and MIME type.

**MP-E-011 (W)** — If generated audio fails FFprobe validation, then the system shall reject the audio, shall not create a `MediaAsset`, and shall mark the job as failed.

**MP-E-012 (W)** — If dialogue audio duration exceeds the associated shot's video duration, then the system shall flag the mismatch for creator attention.

---

## Phase F — Media Storage & Asset Lifecycle

### F.1 Storage Abstraction

**MP-F-001 (U)** — Media storage shall be provider-independent, supporting local storage for development and future cloud object storage for all asset classes.

**MP-F-002 (E)** — When a new storage provider is configured, the system shall route storage operations through the provider abstraction without changing business logic.

**MP-F-003 (U)** — The system shall not store large binary media directly in MongoDB; metadata shall be stored in the database and file bytes through the storage abstraction.

**MP-F-004 (E)** — When a media asset is stored, the system shall store file bytes in the `StorageProvider` and metadata in MongoDB.

### F.2 Asset Relationships & Lifecycle

**MP-F-005 (E)** — When a shot video is stored, the system shall associate the `MediaAsset` with the project, episode, scene, and shot.

**MP-F-006 (E)** — When an asset is archived, the system shall mark it as archived but preserve the file and metadata.

**MP-F-007 (E)** — When an asset is replaced, the system shall preserve version history of the previous asset.

**MP-F-008 (W)** — If deletion is requested for an asset referenced by an approved episode or render, then the system shall reject the deletion and report the dependencies.

### F.3 Integrity, Idempotency & Path Safety

**MP-F-009 (E)** — When two assets have the same SHA-256 content hash, the system shall detect the duplicate and report it.

**MP-F-010 (E)** — When a storage key is generated, the system shall derive it from hashed system identifiers and shall not accept user-supplied paths.

**MP-F-011 (U)** — The system shall use stable asset identifiers and storage-provider operations, not local file paths, to reference assets.

**MP-F-012 (W)** — If object storage succeeds but database persistence fails, then the system shall make the orphaned storage object identifiable through the orphan audit mechanism.

### F.4 Storage Verification

**MP-F-013 (W)** — If the stored object's hash or size does not match the source, then the system shall delete the corrupt stored object and report `storage_verification_failed`.

**MP-F-014 (W)** — If a `MediaAsset` record exists but the stored file is missing, then the system shall report `media_missing` and shall not stream invalid data.

**MP-F-015 (U)** — Media downloads shall be authenticated and ownership-checked before streaming; raw filesystem paths and storage keys shall not be exposed in API responses.

---

## Phase G — Timeline & Film Assembly

### G.1 Timeline Structure & Auto-Generation

**MP-G-001 (U)** — A film timeline shall support ordered video clips, scene grouping, audio tracks (dialogue, narration, music, sound effects), clip start positions, clip durations, audio offsets, transitions, subtitles, aspect ratio, output resolution, and frame rate.

**MP-G-002 (E)** — When all required media for an episode is approved, the system shall generate a timeline automatically from approved scene order, shot order, actual video durations, approved audio, transitions, and episode duration target.

**MP-G-003 (S)** — While a shot has an actual generated video duration, the system shall use the actual duration for timeline positioning, not the estimated duration.

### G.2 Missing-Media Detection & Validation

**MP-G-004 (W)** — If required media is missing, then the system shall prevent rendering, list the missing shots or audio, and allow the creator to return to the relevant production stage.

**MP-G-005 (E)** — When all required media is present and valid, the system shall allow rendering to proceed.

**MP-G-006 (O)** — When an asset is optional (e.g., background music), if it is missing, then the system shall not block rendering.

**MP-G-007 (W)** — If the assembly plan has overlapping clips, then the system shall flag the overlap as a validation error.

**MP-G-008 (W)** — If the assembly plan has broken asset references, then the system shall flag each broken reference.

### G.3 Assembly Preview & Approval

**MP-G-009 (E)** — When an assembly plan is generated, the system shall present it for preview before rendering.

**MP-G-010 (S)** — While the creator has not approved the assembly plan, the system shall not start rendering.

**MP-G-011 (W)** — If the sum of actual clip durations differs significantly from the episode target duration, then the system shall flag the mismatch as a warning in assembly validation.

---

## Phase H — FFmpeg Rendering & Export

### H.1 Real Rendering Pipeline

**MP-H-001 (E)** — When a render job is processed, the system shall execute FFmpeg with the assembled timeline and produce a real video file (concatenation, dimension normalisation, frame-rate normalisation, codec handling, audio mixing, subtitle rendering, transitions, output aspect ratio, resolution, and format).

**MP-H-002 (E)** — When FFmpeg is not configured or not found, the system shall report `ffmpeg_not_configured` and shall not attempt rendering.

**MP-H-003 (E)** — When the creator selects a 9:16 preset, the system shall configure FFmpeg to output a vertical video with the specified resolution and frame rate.

**MP-H-004 (U)** — The system shall support vertical 9:16, landscape 16:9, and square 1:1 render presets with configurable output resolution and frame rate.

### H.2 Background Rendering & Status

**MP-H-005 (E)** — When a render is triggered, the system shall enqueue a render job through the existing BullMQ infrastructure and return a job ID to the creator.

**MP-H-006 (E)** — When a render job is queued, the system shall record input assets and render settings.

**MP-H-007 (E)** — When a render job completes, the system shall record the output asset, render duration, and FFmpeg version.

### H.3 Render Validation & Safety

**MP-H-008 (E)** — When FFmpeg exits successfully, the system shall validate the output with FFprobe before marking the render as completed.

**MP-H-009 (W)** — If FFmpeg exits with code 0 but the output file is missing or invalid, then the system shall mark the render as failed.

**MP-H-010 (U)** — The system shall pass FFmpeg arguments as an array and shall not interpolate user text into a shell string.

**MP-H-011 (E)** — When a render job is cancelled, the system shall terminate the FFmpeg process for that job only and preserve any previously completed assets.

**MP-H-012 (E)** — When a render job completes or fails, the system shall remove temporary download and intermediate files.

### H.4 Render Failures

**MP-H-013 (W)** — If FFmpeg exits with a non-zero code, then the system shall mark the render job as failed, truncate and store stderr on the job error, and clean up temporary files.

**MP-H-014 (W)** — If FFmpeg exits successfully but the output fails FFprobe validation, then the system shall mark the render as failed with error code `render_output_invalid`.

**MP-H-015 (W)** — If the FFmpeg process does not complete within the timeout period, then the system shall terminate the process, mark the job as failed with error code `render_timeout`, and clean up temporary files.

---

## Phase I — Production Orchestration & Job Management

### I.1 BullMQ Integration & Job Types

**MP-I-001 (U)** — All media-generation and rendering operations shall integrate with the existing BullMQ architecture; no separate queue system shall be created.

**MP-I-002 (E)** — When each operation type (character/environment/object reference, shot image, shot video, dialogue, SFX, music, validation, assembly, final render) is triggered, the system shall create a `GenerationJob` with the appropriate job type and enqueue it.

**MP-I-003 (E)** — When a job with the same idempotency key already exists and is open, the system shall return the existing job rather than creating a duplicate.

### I.2 Retry, Failure Classification & Reconciliation

**MP-I-004 (E)** — When a job fails and is retried, the system shall not regenerate assets that were already successfully completed in the same run.

**MP-I-005 (U)** — The system shall use bounded retry policies with exponential backoff up to 3 attempts for transient failures.

**MP-I-006 (W)** — If a permanent failure (validation rejection, safety rejection, unknown model, ownership mismatch) occurs, then the system shall not retry automatically.

**MP-I-007 (E)** — When a worker restarts, the system shall re-enqueue jobs with status `queued` or `processing` that have not exceeded their attempt limit.

**MP-I-008 (U)** — The system shall distinguish permanent failures from temporary failures and record the failure classification on the job.

### I.3 Provider Selection & Concurrency

**MP-I-009 (W)** — If a provider does not support the required capability, then the system shall not select it for that operation.

**MP-I-010 (W)** — If a free provider fails, then the system shall mark the job as failed and shall not automatically retry with a paid provider.

**MP-I-011 (W)** — If a job specifies a model, then the system shall use that model or fail.

**MP-I-012 (U)** — Render job queue concurrency shall be limited to 1 to prevent resource contention on the rendering machine.

**MP-I-013 (W)** — If two jobs attempt to overwrite the same approved asset simultaneously, then the system shall use idempotency keys to prevent duplicates; the first job to complete wins and the second is rejected as a conflict.

**MP-I-014 (W)** — If no configured provider is available or all providers have failed, then the system shall mark the job as failed with error code `no_provider_available`.

### I.5 Cancellation

**MP-I-015 (E)** — When a job is cancelled, the system shall set its status to `cancelled`, call the provider cancel method when available, and preserve completed assets.

---

## Phase J — Provider / Cost Management & Canon Protection

### J.1 Provider Configuration & Cost Tracking

**MP-J-001 (E)** — When a provider is disabled, the system shall not attempt to use it for generation.

**MP-J-002 (E)** — When a mock provider is selected, the system shall use it and clearly mark output as mock.

**MP-J-003 (E)** — When a generation job completes, the system shall record the provider, model, and usage information as a cost/usage event.

**MP-J-004 (E)** — When a generation job fails or is cancelled, the system shall record the event with `billable: false`.

**MP-J-005 (W)** — If automated tests run, then the system shall use mock providers exclusively and shall never make paid API requests.

**MP-J-006 (W)** — If no creator action has initiated generation, then the system shall not submit generation requests to paid providers.

**MP-J-007 (S)** — While no paid API keys are configured, the system shall function using mock providers for all media generation.

**MP-J-008 (W)** — If a generation request would exceed a configured cost limit, then the system shall reject the request with error code `cost_limit_exceeded` before submitting to the provider.

**MP-J-009 (S)** — While a provider is disabled mid-job, the system shall allow the in-progress job to complete and shall not submit new jobs to the disabled provider.

### J.2 Narrative & Visual Canon Protection

**MP-J-010 (U)** — The approved Story Bible, approved Season Plan, and approved episodes shall remain the narrative foundation; media production shall not modify or override approved narrative content.

**MP-J-011 (E)** — When a new visual reference is generated, the system shall not replace the approved canon reference without explicit creator approval.

**MP-J-012 (W)** — If an asset is rejected or in draft status, then the system shall not include it in the timeline or render.

**MP-J-013 (E)** — When an approved asset is replaced, the system shall archive the previous version and maintain a history of all versions.

**MP-J-014 (E)** — When an approved shot plan is modified after shot media has been generated, the system shall identify which generated media assets are affected.

**MP-J-015 (W)** — If a character has an approved visual reference, then the system shall include it in all subsequent image and video generation for that character.

**MP-J-016 (W)** — If a generated clip contains a meaningful narrative change that contradicts the screenplay, then the system shall allow the creator to reject it or revise the underlying shot plan.

### J.3 Compatibility & Reuse

**MP-J-017 (U)** — The system shall reuse and extend the existing `MediaAsset` model, `StorageProvider` interface, `GenerationJob` model, `ProductionScene` model, and `CanonicalEntity` model, not replace them.

**MP-J-018 (U)** — The system shall reuse the existing BullMQ queue system and worker infrastructure for all background jobs.

**MP-J-019 (U)** — The system shall preserve the existing project status transition function; new media-production stages shall integrate with the existing transition table.

**MP-J-020 (U)** — New job types shall be added to the existing `JOB_TYPES` array without removing or reordering existing types.

**MP-J-021 (U)** — The system shall preserve the existing Clerk authentication and `clerkUserId` ownership patterns for all new API routes.

**MP-J-022 (U)** — Provider API keys shall be stored only in server-side environment variables and shall never appear in client bundles, API responses, job records, or error messages.

---

## Summary

| Phase | Requirements | U | S | E | O | W |
| --- | --- | --- | --- | --- | --- | --- |
| A — Visual Asset & Reference Management | 14 | 0 | 1 | 11 | 1 | 1 |
| B — Shot-Level Production | 12 | 0 | 1 | 9 | 1 | 2 |
| C — Image Generation | 12 | 2 | 1 | 6 | 2 | 1 |
| D — Video Generation | 16 | 2 | 0 | 7 | 2 | 5 |
| E — Audio Production | 12 | 0 | 0 | 8 | 0 | 4 |
| F — Media Storage & Asset Lifecycle | 15 | 4 | 0 | 8 | 0 | 3 |
| G — Timeline & Film Assembly | 11 | 1 | 2 | 4 | 1 | 3 |
| H — FFmpeg Rendering & Export | 15 | 2 | 0 | 8 | 0 | 3 |
| I — Production Orchestration & Job Management | 15 | 4 | 0 | 7 | 0 | 4 |
| J — Provider / Cost & Canon Protection | 22 | 6 | 2 | 9 | 0 | 5 |
| **Total** | **144** | **21** | **7** | **77** | **7** | **32** |