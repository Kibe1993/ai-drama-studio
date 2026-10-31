# Database

Status: Phase 2 implements `users`, `projects`, `productionRuns`, and `generationJobs` on the `DramaStudio` database. Story, character, scene, and media collections are still design-only. Scene identity on a job is `sceneNumber` until scene documents exist.

MongoDB stores metadata and references. Image, audio, and video bytes go to object storage. `storageKey` is the pointer. A `url`, when present, is a derived delivery URL and may expire.

The application uses its own database, named `DramaStudio`, selected in `lib/db/connect.ts`. Models register on that connection.

Ownership field is `clerkUserId`. Repository methods for user data require it in the filter. Admin list methods are separate and run only after an admin check in the service.

## User

Projection of a Clerk user. Unique index on `clerkUserId`.

Fields: `email`, `name`, `avatar`, `preferences`, `subscription` (`plan`, `status` only; no payment provider), `usageCounters`, timestamps.

## Project

Fields: `clerkUserId`, `title`, `originalStoryIdea`, `genre`, `language`, `visualStyle`, `tone`, `targetDurationSeconds`, `aspectRatio`, `status`, `workflowMode`, `thumbnailAssetId`, `currentStoryId`, timestamps.

Indexes: `{ clerkUserId: 1, updatedAt: -1, _id: -1 }`, `{ clerkUserId: 1, status: 1 }`.

`targetDurationSeconds` is validated as 60–180 in the first release. The field is a number so a later release can allow longer values without a migration.

Genres: `romance`, `family`, `comedy`, `suspense`, `thriller`, `crime`, `inspirational`, `social`.

Aspect ratios: `16:9`, `9:16`, `1:1`.

Visual styles: `realistic`, `naturalistic`, `period`, `stylized`. The first product priority is `realistic`.

Status transitions: `docs/ARCHITECTURE.md`.

## Story

Fields: `clerkUserId`, `projectId`, `version`, `status` (`draft`, `generated`, `approved`), `title`, `synopsis`, `theme`, `setting`, `structure` (beginning, conflict, rising action, climax, resolution), `screenplay`, `creativeInstructions`, `sourceJobId`, timestamps.

Indexes: unique `{ projectId: 1, version: 1 }`, `{ clerkUserId: 1, projectId: 1 }`.

Editing creates the next version. `Project.currentStoryId` points at the selected version.

## Character

Fields: `clerkUserId`, `projectId`, `name`, `role`, `ageRange`, `personality`, `physicalDescription`, `clothing`, `distinguishingFeatures`, `background`, `relationships` (`characterId`, `kind`), `voiceProfile` (`provider`, `voiceId`, `label`), `referenceAssetIds`, `selectedReferenceAssetId`, timestamps.

Indexes: `{ projectId: 1 }`, `{ clerkUserId: 1, projectId: 1 }`.

Relationships must reference characters in the same project. The repository checks that before save.

## Scene

Fields: `clerkUserId`, `projectId`, `sceneNumber`, `title`, `location`, `timeOfDay`, `characterIds`, `action`, `dialogue` (array of `{ characterId, line, audioAssetId }`), `narration`, `visualDirection`, `cameraAngle`, `cameraMovement`, `lighting`, `mood`, `imagePrompt`, `videoPrompt`, `soundDirection`, `estimatedDurationSeconds`, `status`, timestamps.

Indexes: unique `{ projectId: 1, sceneNumber: 1 }`, `{ clerkUserId: 1, projectId: 1 }`.

Reorder rewrites `sceneNumber` for that project in one bulk write. Render sorts by `sceneNumber`.

Scene status: `draft`, `prompts_ready`, `image_ready`, `video_ready`, `audio_ready`, `failed`. A failed asset does not delete the scene.

## MediaAsset

Fields: `clerkUserId`, `projectId`, `sceneId`, `characterId`, `type`, `provider`, `model`, `prompt`, `storageProvider`, `storageKey`, `mimeType`, `fileSize`, `durationSeconds`, `width`, `height`, `metadata`, `generationJobId`, timestamps.

`type`: `character_reference`, `scene_image`, `scene_video`, `dialogue`, `narration`, `music`, `sfx`, `subtitle`, `thumbnail`.

Indexes: `{ projectId: 1, type: 1 }`, `{ sceneId: 1 }`, `{ characterId: 1 }`, `{ clerkUserId: 1, projectId: 1 }`.

## GenerationJob

Fields: `clerkUserId`, `projectId`, `sceneId`, `characterId`, `jobType`, `provider`, `model`, `input`, `output`, `status`, `progress` (`stage`, `message`), `attempts`, `maxAttempts`, `error` (`code`, `message`, `retryable`), `idempotencyKey`, `bullJobId`, `cost` (`estimated`, `actual`, `currency`), `startedAt`, `completedAt`, timestamps.

Status: `queued`, `processing`, `completed`, `failed`, `cancelled`.

Indexes: unique `idempotencyKey`, `{ clerkUserId: 1, projectId: 1, createdAt: -1 }`, `{ sceneId: 1, jobType: 1, status: 1 }`, `{ status: 1 }`.

`input` must be safe to show the owner. It must not contain API keys.

## ProductionRun

Fields: `clerkUserId`, `projectId`, `workflowMode` (`guided`, `automatic`), `currentStage`, `status` (`pending`, `running`, `waiting_for_approval`, `completed`, `failed`, `cancelled`), `stageResults`, `retryCheckpoint`, `startedAt`, `completedAt`, timestamps.

Index: `{ projectId: 1, createdAt: -1 }`.

`retryCheckpoint` is the project status to restore if the run fails. The transition function uses this value.

## RenderedVideo

Fields: `clerkUserId`, `projectId`, `mediaAssetId`, `durationSeconds`, `resolution`, `aspectRatio`, `fileSize`, `status` (`rendering`, `ready`, `failed`), timestamps.

Indexes: `{ projectId: 1, createdAt: -1 }`, `{ clerkUserId: 1, createdAt: -1 }`.

## ProviderConfiguration

Fields: `providerName`, `providerType`, `model`, `enabled`, `settings` (non-secret: default resolution, allowlisted origin). No API key field. Admin responses return this shape and nothing else.

## UsageEvent

Fields: `clerkUserId`, `projectId`, `generationJobId`, `kind`, `provider`, `model`, `units`, `estimatedCost`, `actualCost`, `currency`, `billable`, timestamps.

Index: `{ clerkUserId: 1, createdAt: -1 }`.

`billable` is false when the job ends `failed` or `cancelled`.

## Query rules

- User-owned repository methods require `clerkUserId`.
- Pagination is cursor-based on `updatedAt` or `createdAt` plus `_id`.
- Responses omit provider credentials. The schema has no secret field, which is the primary control.
