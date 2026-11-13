# Database

Status: The database holds `users`, `projects`, `productionRuns`, `generationJobs`, `stories`, `storyBibles`, `seasonPlans`, `continuityLedgers`, `episodes`, persistent `productionScenes`, `canonicalEntities`, `storyEvents`, and `mediaAssets` metadata. Media bytes remain outside MongoDB.

`stories` is implemented by `lib/models/story.ts`. One document per production run (`productionRunId` is unique). A retry of `story.generate` updates that document instead of inserting another. Fields: `clerkUserId`, `projectId`, `productionRunId`, `title`, `synopsis`, `structure` (act 1 setup, act 2 conflict, act 3 resolution), `screenplay` (scenes with heading, location, time of day, characters, visual description, action, and dialogue), `status` (`awaiting_approval`, `approved`, `failed`), `provider`, `model`, `fallbackFrom`, `version`, `plan` (CASNA episode plan the screenplay was written from), `validationFindings` (CASNA Stage H structured findings), `canonSummary` (CASNA Stage I extraction, written on approval), `repairHistory` (bounded targeted scene-repair attempts), and timestamps. Invalid screenplay JSON is not written. The story stays `awaiting_approval` until the owner approves it. The Zod schema is `lib/validation/story.ts`. `Project.currentStoryId` points at the saved story.

`SeasonPlan` is implemented in `lib/models/seasonPlan.ts` with validation in `lib/validation/seasonPlan.ts`. It is append-only per version: generation and creator edits insert a new `version` in `awaiting_approval`, and approval sets that record to `approved`. Fields: the season objective, central conflict/mystery, character objectives and development, story direction, `episodeProgression` (one entry per episode with its purpose, objective, conflict, beats, revelations, consequences, ending, threads, and continuity requirements), revelations, relationship changes, setup/payoff, unresolved questions, intended conclusion, `basedOnBibleVersion`, `basedOnBibleFingerprint`, `validationFindings`, provider/model metadata, and timestamps. See `docs/CASNA.md`.

`ContinuityLedger` is implemented in `lib/models/continuityLedger.ts` with validation in `lib/validation/continuityLedger.ts`. It is an append-only version per project and is written only when an episode screenplay is approved. Fields: `events`, `characterStates`, `locationStates`, `objectStates`, `revealedSecrets`, `unresolvedThreads`, `consequences`, `timelineNotes`, `asOfEpisode`, `basedOnPlanVersion`, and `version`. Unapproved drafts never update it; their developments are returned separately by `GET /api/projects/[id]/continuity` as proposals.

`StoryBible` is implemented in `lib/models/storyBible.ts` with its Zod shape in `lib/validation/storyBible.ts`. It is unique per owned project and stores an editable draft plus an immutable approval history. Each approval uses the expected approved version and draft revision as a compare-and-set guard. Serialized episodes retain the approved snapshot version they were created from. Story generation uses that exact snapshot when available. Event extraction and canonical entity records are not implemented yet.

`Episode` is implemented in `lib/models/episode.ts`. Episodes are numbered within a project and retain their premise, target screenplay duration, status, current story, starting Story Bible version (`baseSnapshotVersion`), and the approved Season Plan version they were planned from (`basePlanVersion`). Production runs and stories reference their episode. Existing projects are supported; the first episode is created when needed.

`ProductionScene` is implemented in `lib/models/productionScene.ts` with validation in `lib/validation/scene.ts`. Scene breakdowns are persisted idempotently by production run and scene number, linked to the project, episode, and approved story. Editable scene details and manually authored shot plans are saved before scene approval. Video status remains pending/mock/unavailable; a scene document is not evidence of a generated video.

`CanonicalEntity` stores project-scoped characters and locations. Idempotent stage persistence records appearances without overwriting an established profile. Character records become approved at the character approval checkpoint; locations become approved with the scene checkpoint. `StoryEvent` stores one scene beat from the validated scene action and links it to its characters/location. The beat remains pending until scene approval; edited scene actions are synchronized to the event. Only approved entities and events from earlier episodes are included in serialized prompts. These collections are created for new pipeline output; existing run snapshots are not automatically backfilled.

`MediaAsset` metadata is defined by `lib/models/mediaAsset.ts`. It records ownership and source links, storage key/provider, content type, size, SHA-256, optional media metadata, signature-validation state, storage verification, and review status. Records are idempotent by owner/idempotency key. The current service only stores signature-verified files and does not mark them playable or wire them into scene readiness.

MongoDB stores metadata and references. Image, audio, and video bytes go to object storage. `storageKey` is the pointer. A `url`, when present, is a derived delivery URL and may expire.

The application uses its own database, named `DramaStudio`, selected in `lib/db/connect.ts`. Models register on that connection.

Ownership field is `clerkUserId`. Repository methods for user data require it in the filter. Admin list methods are separate and run only after an admin check in the service.

## User

Projection of a Clerk user. Unique index on `clerkUserId`.

Fields: `email`, `name`, `avatar`, `preferences`, `subscription` (`plan`, `status` only; no payment provider), `usageCounters`, timestamps.

## Project

Fields: `clerkUserId`, `title`, `originalStoryIdea`, `productionType` (one of the eight supported content categories), `productionMode` (`standalone`, `serialized`, or `anthology`), `genre`, `language`, `visualStyle`, `tone`, `targetDurationSeconds`, `aspectRatio`, `status`, `workflowMode`, `thumbnailAssetId`, `currentStoryId`, timestamps. Existing records without the profile fields read as `fictional_drama` and `standalone`; no database backfill is required.

Indexes: `{ clerkUserId: 1, updatedAt: -1, _id: -1 }`, `{ clerkUserId: 1, status: 1 }`.

`targetDurationSeconds` accepts 60, 120, 180, 300, 600, and 900 seconds (1–15 minutes). This sets the screenplay-generation target only; it does not imply that the current mock video/render stages produce a video of that duration.

Genres/focus values include romance, family, comedy, suspense, thriller, crime, social drama, science fiction, fantasy, mystery, historical, human interest, philosophical, documentary, educational, satire, and animation style.

Aspect ratios: `16:9`, `9:16`, `1:1`.

Visual styles: `realistic`, `naturalistic`, `period`, `stylized`. The first product priority is `realistic`.

Status transitions: `docs/ARCHITECTURE.md`.

## Story

Fields: `clerkUserId`, `projectId`, `version`, `status` (`draft`, `generated`, `approved`), `title`, `synopsis`, `theme`, `setting`, `structure` (beginning, conflict, rising action, climax, resolution), `screenplay`, `creativeInstructions`, `sourceJobId`, timestamps.

Indexes: unique `{ projectId: 1, version: 1 }`, `{ clerkUserId: 1, projectId: 1 }`.

Editing creates the next version. `Project.currentStoryId` points at the selected version.

The `productionRunId` unique index is **partial**: it applies only when `productionRunId` is an ObjectId. This allows many project-level story drafts (`productionRunId: null`, one per project) while keeping one story per production run. Databases created before the partial index used a plain unique index, which treated `null` as a value and allowed only one project-level draft across the whole database; `ensureStoryIndexes` in `lib/db/ensureIndexes.ts` drops that legacy index and creates the partial one on connection startup.

## SeasonPlan

Fields: `clerkUserId`, `projectId`, season fields (`seasonObjective`, `centralConflictOrMystery`, `mainCharacterObjectives`, `overallCharacterDevelopment`, `majorStoryDevelopments`, `beginningDirection`, `middleDirection`, `endingDirection`, `importantRevelations`, `relationshipChanges`, `consequencesCarriedBetween`, `setupAndPayoff`, `unresolvedQuestions`, `intendedSeasonConclusion`), `episodeProgression` (array of episode plan items), `basedOnBibleVersion`, `basedOnBibleFingerprint`, `version`, `status` (`awaiting_approval`, `approved`, `failed`), `provider`, `model`, `fallbackFrom`, `validationFindings`, timestamps.

Index: `{ clerkUserId: 1, projectId: 1, version: -1 }`.

Versions are append-only. Approval is a conditional update from `awaiting_approval`, so two concurrent approvals cannot both succeed. Each `episodeProgression` entry also carries structured canon deltas (`characterArcChanges`, `relationshipChanges`, `objectChanges`, `locationChanges`) that are applied to the Continuity Ledger when the episode is approved.

## ContinuityLedger

Fields: `clerkUserId`, `projectId`, `events`, `characterStates`, `locationStates`, `objectStates`, `revealedSecrets`, `unresolvedThreads`, `consequences`, `timelineNotes`, `asOfEpisode`, `basedOnPlanVersion`, `version`, timestamps.

Index: `{ clerkUserId: 1, projectId: 1, version: -1 }`.

A new version is inserted only after an episode screenplay is approved. Draft episodes do not write this collection.

## Character

Fields: `clerkUserId`, `projectId`, `name`, `role`, `ageRange`, `personality`, `physicalDescription`, `clothing`, `distinguishingFeatures`, `background`, `relationships` (`characterId`, `kind`), `voiceProfile` (`provider`, `voiceId`, `label`), `referenceAssetIds`, `selectedReferenceAssetId`, timestamps.

Indexes: `{ projectId: 1 }`, `{ clerkUserId: 1, projectId: 1 }`.

Relationships must reference characters in the same project. The repository checks that before save.

## ProductionScene

Fields: `clerkUserId`, `projectId`, `productionRunId`, `episodeId`, `storyId`, `sceneNumber`, `title`, `location`, `interiorExterior`, `timeOfDay`, `charactersPresent`, `visualDescription`, `action`, `dialogue`, `cameraDirection`, `estimatedDurationSeconds`, editable `shotPlan`, video readiness/status metadata, timestamps.

Indexes: unique `{ clerkUserId: 1, productionRunId: 1, sceneNumber: 1 }`, `{ clerkUserId: 1, projectId: 1, episodeId: 1, sceneNumber: 1 }`.

Reorder rewrites `sceneNumber` for that project in one bulk write. Render sorts by `sceneNumber`.

Shot plans are creator-authored; the app does not claim they are generated or validated by a video provider. A failed/unavailable media stage does not delete a scene.

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
