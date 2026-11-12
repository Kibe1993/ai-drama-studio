# Production pipeline

Status: `createPipelineService` coordinates the run. `story.generate`, `character.extract`, and `scene.breakdown` call the configured language-provider sequence. Paid providers are skipped while `LLM_FREE_ONLY` is on. Video and render use mock engines and are not real media stages. Mock outputs set `MOCK`/`UNAVAILABLE`, never `videoReady`, and cannot mark a run completed. A worker processes BullMQ jobs when `REDIS_URL` is set.

Story generation always stops for approval, including when the run was started in automatic mode. Automatic mode still continues on its own after the story, the character set, and the scene list have been approved.

Project profiles support the eight content categories listed in `lib/domain/projectCatalog.ts` and a 1–15 minute screenplay target. The selected category and its guidance are passed into story generation. Documentary/educational output is not fact-checked; the prompt warns against invented facts and the creator must research claims externally. Episodes retain their approved starting Story Bible version. Scene breakdowns are persistent and editable with creator-authored shot plans before approval. Longer targets affect the story prompt; they do not create finished video footage.

## Responsibility

The pipeline coordinates the five engines. It checks dependencies, records a `ProductionRun`, and enqueues worker jobs. Prompt text and the language HTTP calls live in `lib/providers/llm`. The pipeline does not run FFmpeg. One BullMQ delivery waits at most `LLM_SEQUENCE_TIMEOUT_MS` for the whole provider sequence.

| Current stage | Requires | Current behavior |
| --- | --- | --- |
| `story.generate` | Owned project | Live LLM generation, schema validation, Story upsert, then story approval |
| `character.extract` | Approved story | Live LLM extraction; profiles stored in `ProductionRun.stageResults`; guided approval or automatic progression |
| `scene.breakdown` | Approved story and characters | Live LLM breakdown; idempotently stored in `productionScenes` and `ProductionRun.stageResults`; editable details/shot plans before approval |
| `video.scene` | Approved scene list | Mock only. Output is recorded as mock/unavailable; it does not set genuine video readiness |
| `render.final` | Validated stored scene video assets | Mock only. It cannot mark the run/project completed or create a rendered-video record |

Image reference jobs, audio jobs, media assets, and a real render adapter in the earlier responsibility table are target capabilities, not live implementations.

Guided runs wait for approval between stages. A story always waits for approval, even in an automatic run. After that approval, an automatic run enqueues the next stage on its own. The user can stop an automatic run and keep what already exists.

## Dependencies

- Characters require a story version with status `approved`.
- Scenes require that story version. Character ids on a scene must belong to the same project.
- Scene video may require the selected reference image. The media engine reads `acceptsReferenceImage`. If it is false, generation still runs from the text prompt and the job stores `referenceUsed: false`.
- Dialogue audio requires lines and a voice profile. Missing audio blocks the mix step, not the scene video step.
- The current render gate requires each scene to have a completed video state and stored asset reference. Legacy `videoReady` booleans without an asset ID do not pass. No current video engine can produce that evidence.
- While no audio provider is configured, `requireDialogueAudio` is false so rendering can be tested with sample clips. Once speech is enabled, the default is true.
- Subtitles are built from dialogue and narration timing during render. They are not a separate model call in the first version.

## Resume

Each call reads MongoDB:

- `Project.status`
- `ProductionRun.currentStage`, `status`, `stageResults`, and the retry checkpoint
- `GenerationJob` rows that are `queued` or `processing`

There is no in-memory pipeline. After a worker crash, the job document remains. Startup reconciliation re-queues a `processing` job whose BullMQ job is gone, until the attempt limit.

Starting a stage that already has an open job with the same idempotency key returns that job id.

## Approval and edits

In guided mode, the next method runs only after the user approves the story, the character set, or the scene list. Editing a story after characters exist creates a new story version. It does not delete characters or assets. The user regenerates a downstream stage explicitly. The pipeline does not cascade-delete.

Scene edits are available only while the scene stage is waiting for approval. Saving updates both the durable scene record and the run snapshot used by approval and later jobs. Scene records are not media assets and do not imply a generated video.

## Progress

The UI reads the run stage, the job type, and the job message: "Developing story", "Creating characters", "Preparing scenes", "Generating scene 2", "Generating dialogue", "Rendering final video". It does not invent a percentage.

## Cancellation and failure

Cancellation sets the job to `cancelled` and calls the provider cancel method when that interface has one. Render cancellation stops the FFmpeg process for that job only. Completed assets are kept.

Transient failures retry with exponential backoff. Permanent failures (validation, safety rejection, unknown model, ownership mismatch) set `retryable: false` and stop automatic advancement. Other scenes stay. The user can regenerate the failed scene.
