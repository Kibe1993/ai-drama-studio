# Background jobs

Status: BullMQ and `workers/studio.ts` are installed. The worker loads environment config with `@next/env`, connects to MongoDB, logs provider configuration without key values, then registers queues. Jobs are recorded in MongoDB. The worker exits if `REDIS_URL` is missing. `story.generate`, `character.extract`, and `scene.breakdown` use the language provider manager; paid providers are blocked while `LLM_FREE_ONLY` is on. `video.scene` and `render.final` are mock-only. Their queue jobs may finish processing, but their outputs are labeled mock/unavailable and cannot satisfy media completion. Tests use an in-memory queue, not Redis.

## Two stores

MongoDB `GenerationJob` is the record the UI polls and the record used to resume. Redis holds BullMQ's queue. If Redis is emptied, a reconciler reads jobs still marked `queued` or `processing` and enqueues them again while attempts remain.

The Next.js handler inserts the `GenerationJob`, enqueues a BullMQ job whose payload is `{ generationJobId }`, and returns that id. The payload does not contain provider secrets. The worker loads the row and checks that the job's `clerkUserId` owns the project before calling a provider.

## Queues

| Queue | Concurrency | Jobs |
| --- | --- | --- |
| `generation` | Low, from config | Story, character extraction, scene breakdown, canon, assembly |
| `production` | Provider cap / 1 for render | Audio TTS (dialogue, narration, sfx, music) and FFmpeg render |
| `maintenance` | Provider rate cap | Image and video generation, media validation (currently mock) |

Three queues keep render and audio work off the LLM path, and isolate mock image/video jobs. The `maintenance` queue holds image and video jobs which are mock-only until real providers are wired. Black Forest Labs documents a cap on active image tasks (24 in their image guide, lower for some models); when a real image provider is connected, `maintenance` concurrency must stay under that cap.

## Attempts

BullMQ retries with exponential backoff when the error is retryable: network failure, HTTP 429, HTTP 503. The attempt count is copied onto `GenerationJob.attempts`.

Permanent errors are not retried: Zod rejection, safety block, unknown model, missing reference, ownership mismatch. Retries have a maximum. A permanent failure is not retried indefinitely.

## Idempotency

`idempotencyKey` is unique. For scene video it is `video:{sceneId}:{inputHash}`. The hash covers prompt, reference asset id, duration, aspect ratio, provider, and model. A repeat request returns the existing open job. Regenerating after completion uses a new key because the user asked for a new asset. The previous asset stays.

## Progress and polling

The worker writes `progress.stage` and `progress.message`. The client polls `GET /api/generations/:jobId` with React Query and stops when status is `completed`, `failed`, or `cancelled`. The interval is a few seconds and is defined next to the hook. The UI does not show a fake percentage.

## Cancellation

The API sets status `cancelled` when the job is `queued` or `processing` and the caller owns it. The worker checks that status between steps. Video providers expose `cancel`. FFmpeg cancellation kills that job's child process.

## Logging

Logs include job id, project id, provider, and error code. They omit API keys, database URIs, and signed URLs. HTTP errors returned to the browser are a short code and a safe message, not a stack trace or a provider body.
