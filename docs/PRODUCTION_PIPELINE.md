# Production pipeline

Status: Phase 0 design. `ProductionPipelineService` is not implemented.

## Responsibility

The pipeline coordinates the five engines. It does not write prompts, call Gemini, or run FFmpeg. It checks dependencies, records a `ProductionRun`, and enqueues worker jobs.

| Method | Requires | Enqueues | On success |
| --- | --- | --- | --- |
| `createProduction` | Owned project | Nothing | A run row. Status becomes `planning` when the user starts |
| `generateStory` | Owned project, no open job for the same idempotency key | `story.generate` | A story version. `story_ready` after approval or auto-accept |
| `generateCharacters` | An approved story version | `character.extract`, then `image.character` per character | Profiles and reference assets. `characters_ready` after accept |
| `generateScenes` | Approved story and character set | `scene.breakdown` | Ordered scenes. `scenes_ready` after accept |
| `generateSceneMedia` | One scene, prompts, and a selected reference when the video provider needs one | `image.scene`, `video.scene`, `audio.dialogue`, `audio.narration` | That scene's assets. Project becomes `generating` |
| `generateAudio` | Dialogue or narration on a scene, and a voice profile | `audio.dialogue` or `audio.narration` | Audio assets linked to the line and scene |
| `renderProduction` | Every mandatory scene has a ready video | `render.final` | `RenderedVideo`. Project `completed` |

Guided runs set the run status to `waiting_for_approval` between stages. Automatic runs enqueue the next method. The user can stop an automatic run and edit what already exists.

## Dependencies

- Characters require a story version with status `approved`.
- Scenes require that story version. Character ids on a scene must belong to the same project.
- Scene video may require the selected reference image. The media engine reads `acceptsReferenceImage`. If it is false, generation still runs from the text prompt and the job stores `referenceUsed: false`.
- Dialogue audio requires lines and a voice profile. Missing audio blocks the mix step, not the scene video step.
- Final render requires scene videos in `sceneNumber` order. Music and sound effects are included when those assets exist.
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

## Progress

The UI reads the run stage, the job type, and the job message: "Developing story", "Creating characters", "Preparing scenes", "Generating scene 2", "Generating dialogue", "Rendering final video". It does not invent a percentage.

## Cancellation and failure

Cancellation sets the job to `cancelled` and calls the provider cancel method when that interface has one. Render cancellation stops the FFmpeg process for that job only. Completed assets are kept.

Transient failures retry with exponential backoff. Permanent failures (validation, safety rejection, unknown model, ownership mismatch) set `retryable: false` and stop automatic advancement. Other scenes stay. The user can regenerate the failed scene.
