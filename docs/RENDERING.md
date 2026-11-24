# Rendering

Status: Phase 0 design. FFmpeg is not installed and no sample render has been run.

## Where it runs

The rendering engine runs in the `production` queue worker. A route handler enqueues `render.final` only after the pipeline confirms every mandatory scene video exists. The API request does not spawn FFmpeg.

## Inputs

The worker loads the project, scenes ordered by `sceneNumber`, the selected video asset for each scene, dialogue and narration assets when present, optional music and sound-effect assets, and the aspect ratio. It downloads those objects by storage key into a temp directory named by the job id.

## Assembly

1. Download inputs into that temp directory.
2. Write a subtitle file from dialogue and narration. Timing uses each line's audio duration when audio exists, otherwise the scene's estimated duration.
3. Build an FFmpeg argument list: scale and pad each clip to the project aspect ratio, concatenate in scene order, mix dialogue and narration, duck music if a music asset exists, burn or attach subtitles, and write an MP4.
4. Arguments are an array. Scene titles and user text are not interpolated into a shell string.
5. Upload the MP4 through `StorageProvider`.
6. Insert `MediaAsset` and `RenderedVideo`, then transition the project to `completed`.

The first version uses cuts. A crossfade can be added as an FFmpeg filter after the cut path works. It is not an AI stage.

## Failure

A non-zero FFmpeg exit marks the render job failed and leaves scene assets in place. The temp directory is removed in a `finally` block. Stderr is truncated and stored on the job error. The browser receives a short failure message.

## Phase 7 test

Before any model is connected, the worker renders two local sample clips and a sample WAV from `workers/fixtures`. That test proves ordering, mix, subtitles, upload, and status updates.
