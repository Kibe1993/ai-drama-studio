# Architecture

Status: Phase 3. Signed-in users can manage projects, generate a screenplay through the free-tier language providers, and approve it. Character, scene, video, and render stages are still mocks. Redis and the worker move the run.

## Product

An authenticated user describes a story in ordinary language. The system turns that idea into a short drama, one scene at a time, then assembles the approved clips, dialogue, music, sound effects, and subtitles into a downloadable video.

The first release targets 1–3 minutes and a realistic cinematic look. Duration is stored on the project, so a later release can allow longer films without rewriting the pipeline.

Genres: romance, family drama, comedy, suspense, thriller, crime, inspirational, social drama.

The system is a modular monolith plus separate worker processes. It is not a set of microservices. Each engine is a module with its own service. A module can be moved to its own process later because it talks to the others through database records and jobs, not through shared in-memory objects.

```
Browser
  -> Next.js route handlers
       authenticate, validate, check ownership, enqueue
  -> MongoDB
       users, projects, stories, characters, scenes, jobs, assets
  -> Redis / BullMQ
       transport only
  -> Worker process
       engines call provider interfaces or FFmpeg
  -> Object storage
       image, audio, and video bytes
  -> Hosted API or GPU host
       inference, outside this Node process
```

Hosting the Next.js application does not run video models. If a GPU or an API key is missing, that provider stays disabled. The project and its completed work remain.

## Five engines

| Engine | Owns | Does not own |
| --- | --- | --- |
| Story | Structured screenplay and versions | Images, video, rendering |
| Character | Profiles, relationships, voice profile, selected reference image | Final render |
| Scene | Ordered scenes, directions, prompts | Provider HTTP calls |
| Media | Image, video, and audio generation; asset rows | Story structure, FFmpeg timeline |
| Rendering | Order, mix, subtitles, transitions, final file | Prompt writing |

`ProductionPipelineService` decides whether a stage may start, writes a `ProductionRun`, and calls the engine services. It does not contain their internals.

Route handlers stay thin: session, Zod, ownership, service call, HTTP response. Repositories own queries. Services own rules. Adapters own one vendor.

## Where code will live

```
app/(auth)/
app/(dashboard)/
app/admin/
app/api/
components/ui/
components/layout/
components/dashboard/
components/projects/
components/story/
components/characters/
components/scenes/
components/media/
components/production/
lib/db/
lib/models/
lib/repositories/
lib/services/
lib/engines/production/
lib/engines/story/
lib/engines/character/
lib/engines/scene/
lib/engines/media/
lib/engines/rendering/
lib/providers/llm/
lib/providers/image/
lib/providers/video/
lib/providers/audio/
lib/providers/storage/
lib/queues/
lib/validation/
lib/auth/
lib/utils/
hooks/
types/
workers/
docs/
```

Folders are created in the phase that fills them.

## Identity

Clerk is the only login system. A `User` document is a projection: preferences, plan label, and usage counters. It is created on the first authenticated studio request. It is not a second password store.

Every user-owned query includes `clerkUserId`. Admin access is separate: Clerk `publicMetadata.role === "admin"` or an id listed in `ADMIN_USER_IDS`. Admin routes live under `/admin` and `/api/admin`. Hiding a button is not authorization.

## Project status

Status changes only through a transition function. Clients do not send the next status.

| From | To | When |
| --- | --- | --- |
| draft | planning | User starts a production run |
| planning | story_ready | Story stage is accepted |
| story_ready | characters_ready | Character stage is accepted |
| characters_ready | scenes_ready | Scene stage is accepted |
| scenes_ready | generating | A media job is accepted |
| generating | rendering | Every mandatory scene has a ready video |
| rendering | completed | A rendered video record is stored |
| draft, story_ready, characters_ready, scenes_ready, completed, failed | archived | User archives, and no job is queued or processing |
| archived | draft | User restores |
| planning, generating, rendering | failed | The active run cannot continue |
| failed | the checkpoint stored on the run | User retries. Completed assets stay |

A failed scene marks that scene failed. Other scenes and their assets stay. The project remains `generating` until the user retries or cancels the run.

Invalid transitions return 409.

`failed` may legally return only to the checkpoint the run recorded, not to any earlier status the client names. The transition function receives that checkpoint. It does not guess.

## Production modes

Guided mode stops after each stage until the user approves. Automatic mode enqueues the next stage when the current one succeeds. Both modes write the same rows. The user can open a finished stage, edit it, and regenerate one scene. Automatic mode is not one opaque request.

## Six processes

1. Next.js. UI and short API calls. Enqueues work and returns a job id.
2. MongoDB. Durable product state. No media bytes.
3. Redis and workers. If Redis is flushed, jobs still marked `queued` or `processing` can be re-enqueued from MongoDB.
4. Inference. A hosted HTTP API, or a GPU machine this project calls. The worker calls it. Next.js does not.
5. Object storage. Images may use Cloudinary. Scene video, audio, and masters use S3-compatible storage. MongoDB stores keys and metadata.
6. Render worker. FFmpeg on a machine with a temp disk. Its queue concurrency is 1. It is not a Next.js request.

## Replaceability

A registry resolves `LLMProvider`, `ImageProvider`, `VideoProvider`, `AudioProvider`, and `StorageProvider` from configuration. Business code receives the interface. A new vendor is a new adapter and a registry entry.

Secrets stay in environment variables. `ProviderConfiguration` stores non-secret settings only. API responses never include credentials.

## Consistency

Character reference images are stored and passed into image-to-video when the selected provider accepts an input image. That is the consistency mechanism. The product does not claim a model will keep a face identical across clips. If a provider cannot take a reference, the job records that the clip was text-only.

Lip sync is a later speech-to-video feature. The first render mixes dialogue as audio and burns or attaches subtitles.

## Cost

A `UsageEvent` is written when a job reaches a terminal state. Failed and cancelled jobs are stored with `billable: false`. No payment processor is added. Numeric caps are checked before an expensive job is enqueued, starting in Phase 9.
