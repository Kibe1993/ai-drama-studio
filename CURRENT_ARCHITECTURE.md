# Current Architecture — Detailed Description

**Date:** 2026-11-23
**Status:** Stage 0 forensic audit (read-only)

---

## 1. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router, Turbopack) | 15.5.28 |
| UI | React | 19.1.4 |
| Language | TypeScript (strict) | 5.x |
| Styling | Tailwind CSS (CSS-first, no config) | 4.x |
| UI Primitives | Radix UI (label, slot) | latest |
| Icons | Lucide React | 0.552.0 |
| Forms | React Hook Form + @hookform/resolvers | 7.65 / 3.10 |
| Data fetching | @tanstack/react-query | 5.90.5 |
| Database | MongoDB via Mongoose | 8.19.2 |
| Queue/Cache | Redis via ioredis + BullMQ | 6.0 / 6.5.3 |
| Auth | Clerk (@clerk/nextjs) | 6.36.8 |
| Validation | Zod | 3.25.76 |
| HTTP | undici | 8.13.0 |
| Testing | Vitest | 3.2.4 |
| Linting | ESLint + eslint-config-next | 9.x |
| AI SDKs | @anthropic-ai/sdk, @google/genai, openai | latest |

## 2. Directory Structure

```
ai-drama-studio/
├── app/                      # Next.js App Router
│   ├── (auth)/               # Auth-gated routes
│   ├── api/                  # 60 API route handlers
│   │   ├── projects/         # Project CRUD, stages, generation
│   │   ├── canon/            # Canon facts, continuity
│   │   ├── production/       # Video, audio, rendering, assembly
│   │   ├── media/            # Media assets, visual assets
│   │   └── admin/            # Admin endpoints
│   ├── projects/             # Project workspace pages
│   ├── media/                # Stub page
│   ├── characters/           # Stub page
│   ├── admin/                # Stub page
│   └── layout.tsx            # Root layout with Clerk
├── components/               # 25 React components
│   ├── layout/               # StudioShell, sidebar, header
│   ├── projects/             # Project cards, lists, forms
│   ├── workflow/             # WorkflowStepper, stage UI
│   └── production/           # Video, audio, rendering panels
├── hooks/                    # 10 React hooks (React Query)
├── lib/
│   ├── models/               # 25 Mongoose models
│   ├── repositories/         # 28 repository classes
│   ├── services/             # 26 service classes
│   ├── providers/
│   │   ├── llm/              # 39 files — 10 adapters, ASPO, CASNA, manager
│   │   ├── media/            # 17 files — video(mock), audio(kokoro), image(mock), ffmpeg
│   │   └── storage/          # 3 files — local, S3(stub), Cloudinary(stub)
│   ├── pipeline/             # 17 files — engines, job processing
│   ├── validation/           # 30 files — Zod schemas, JSON schemas
│   ├── canon/                # 9 files — 6 registries, locks, outbox
│   ├── domain/               # 66 files — project catalog, workflow, narrative control
│   └── db/                   # Connection, index migration
├── workers/                  # BullMQ worker process
├── tests/                    # 82 test files, 1,504 cases
├── scripts/                  # 12 utility scripts
├── docs/                     # 17 documentation files
└── specs/                    # 4 spec files
```

## 3. Application Workflow

The app implements a **5-stage guided workflow** with stage gating:

```
Stage 1: Story Bible    → LLM generates 6 sections (identity, world, characters, etc.)
Stage 2: Story           → LLM generates 6 parts (synopsis, acts, scenes, dialogue)
Stage 3: Season Plan     → LLM generates episode breakdown
Stage 4: Episodes        → LLM generates per-episode content
Stage 5: Production      → Mock video/image + real audio + FFmpeg render
```

### Stage Gates (enforced in services):
- `story.generate` → stops for explicit human approval before characters
- `character.extract` → requires approved story version
- `scene.breakdown` → requires approved story AND characters
- `video.scene` and `render.final` → use mock engines (MOCK/UNAVAILABLE)

### Navigation:
- `StudioShell` — sidebar layout with project selection
- `WorkflowStepper` — visual stage progress with gating
- Production sub-pages: video, audio, rendering, assembly, shots, visual-assets

## 4. Database Layer

### 4.1 Models (25 Mongoose schemas)

All collections are **tenant-scoped** via `clerkUserId`.

**Core project models:**
- `Project` — top-level container
- `StoryBible` — versioned (identity, world, characters, tone, structure, metadata)
- `Story` — versioned (synopsis, acts, scenes, dialogue)
- `Episode` — per-episode content
- `SeasonPlan` — versioned episode breakdown

**Production models:**
- `ProductionRun` — render job container
- `ProductionScene` — per-scene production data
- `Timeline` — sequence composition
- `RenderJob` — FFmpeg render tracking
- `AudioSegment` — TTS audio segments
- `MediaAsset` — generated media tracking
- `ShotProductionRecord` — per-shot production state

**Canon/continuity models (6 registries):**
- `NarrativeCanon` — append-only canon store
- `CanonFact` — append-only fact log
- `ContinuityLedger` — staleness tracking
- `NarrativeRegistry` — entity registry
- `CanonicalRegistry` — canonical entity registry
- `NarrativeGraph` — relationship graph

**Canon infrastructure:**
- `CanonLock` — fencing-token lock for canon commits
- `CanonExtractionOutbox` — transactional outbox for async canon extraction
- `CanonicalEntity` — canonical entity definition
- `VoiceProfile` — character voice configuration

**Infrastructure models:**
- `GenerationJob` — LLM generation job tracking
- `CostEvent` — cost tracking per generation
- `StoryEvent` — story lifecycle events

### 4.2 Repositories (28)
Standard CRUD + specialized queries. Each repository wraps a Mongoose model and enforces tenant scoping. Key patterns:
- `findByProjectId()` — scoped project queries
- `createVersion()` — versioned document creation
- `approveVersion()` — stage transition with approval

### 4.3 Services (26)
Business logic layer. Key services:
- `ProjectService` — project lifecycle, stage transitions
- `StoryBibleService` — bible generation orchestration
- `StoryService` — story generation orchestration
- `SeasonPlanService` — season planning
- `EpisodeService` — episode generation
- `CanonService` — canon fact management, continuity validation
- `ProductionService` — production run management
- `RenderService` — render job management
- `CostService` — cost tracking and aggregation

## 5. LLM Provider Layer (39 files, ~8,800 lines)

### 5.1 Provider Adapters (10)
Each adapter implements a common interface:

| Provider | SDK | Status |
|----------|-----|--------|
| DeepSeek | openai SDK (compatible) | ✅ Primary |
| Groq | openai SDK (compatible) | ✅ Fallback 1 |
| OpenRouter | openai SDK (compatible) | ✅ Fallback 2 |
| Mistral | openai SDK (compatible) | ✅ Fallback 3 |
| Anthropic | @anthropic-ai/sdk | ✅ Available |
| OpenAI | openai SDK | ⚠️ No credits |
| Gemini | @google/genai | ✅ Available |
| Ollama | openai SDK (local) | ⚠️ Disabled |
| LM Studio | openai SDK (local) | ⚠️ Disabled |
| Kimi | openai SDK (compatible) | ✅ Available |

### 5.2 StoryProviderManager (1,029 lines)
- Provider selection via ASPO
- 4x retry per provider with exponential backoff (2s, 4s, 8s)
- Failover across fallback chain
- Health tracking and circuit breaking
- Empty-field retry for Story Bible (3 retries with hints)
- Sequential generation with fingerprint-based caching/resume

### 5.3 ASPO — Adaptive Selection with Priority and Observation (565 lines)
- Provider priority ordering
- Health observation and scoring
- Free-tier policy enforcement (`LLM_FREE_ONLY`)
- Cost-aware selection
- Failover chain construction

### 5.4 CASNA — Canon-Aware Seasonal Narrative Architecture
- Multi-stage validation pipeline
- 30 validation files (~3,100 lines)
- Zod schemas for all LLM outputs
- JSON schemas for provider-level validation
- Revision safety constraints
- Canon consistency validation

### 5.5 Generation Flow
```
User triggers generation
  → Service creates GenerationJob
  → StoryProviderManager selects provider (ASPO)
  → Provider adapter calls LLM API
  → Response parsed via parseStructured()
  → Validated against Zod schema (CASNA)
  → Empty-field detection → retry if needed (3x)
  → Provider retry on transient errors (4x)
  → Failover to next provider on exhaustion
  → Result saved to DB with versioning
  → Canon extraction queued (outbox)
  → Stage transition if approved
```

## 6. Media Provider Layer (17 files)

### 6.1 Video Generation — MOCK
- `MockVideoProvider` — returns placeholder video URLs
- No real video provider adapter exists
- No Veo, LTX, BFL, or other video generation integration

### 6.2 Audio Generation (TTS) — REAL (Kokoro)
- `KokoroAudioProvider` — real TTS via Python bridge
- 54 voices, 9 languages
- Local execution, no API cost
- Audio segments stored as files

### 6.3 Image Generation — MOCK
- `MockImageProvider` — returns placeholder image URLs
- No real image provider adapter exists

### 6.4 FFmpeg Rendering — REAL
- `FFmpegRenderEngine` — real video composition
- Concatenation of video clips
- Subtitle burning
- Audio mixing (dialogue + background)
- 3 quality presets (draft, standard, high)
- Local execution via FFmpeg binary

### 6.5 Storage (3 files)
- `LocalStorageProvider` — file system storage (working)
- `S3StorageProvider` — throws "not implemented"
- `CloudinaryStorageProvider` — throws "not implemented"

## 7. Pipeline Layer (17 files, ~4,300 lines)

### 7.1 Job Queues (BullMQ, 5 queues, 21 job types)
- `generation` queue — story bible, story, season plan, episode generation
- `production` queue — video, audio, image generation
- `render` queue — FFmpeg render jobs
- `canon` queue — canon extraction, continuity validation
- `maintenance` queue — cleanup, health checks

### 7.2 Engines
- `StoryEngine` — structured screenplays and versioning
- `CharacterEngine` — character profiles, relationships, voice profiles
- `SceneEngine` — ordered scene breakdowns, director notes, shot plans
- `MediaEngine` — image, video, audio generation / asset tracking
- `RenderingEngine` — sequence composition, subtitles, audio mix, export

### 7.3 Job Processing
- Worker process (`workers/`) runs BullMQ workers
- Jobs are idempotent with fingerprint-based deduplication
- Failed jobs retry with exponential backoff
- Canon extraction uses transactional outbox pattern

## 8. Validation Layer (30 files, ~3,100 lines)

- Zod schemas for all LLM output structures
- JSON schemas for provider-level validation
- Revision safety constraints
- Canon consistency validators
- Story Bible section schemas (identity, world, characters, tone, structure, metadata)
- Story part schemas (synopsis, acts, scenes, dialogue)
- Episode schemas
- Production schemas (timeline, render, audio)

## 9. Canon/Continuity Layer (9 files, ~2,000 lines)

### 9.1 Six Registries (over-engineered)
1. `NarrativeCanon` — append-only canon store
2. `CanonFact` — append-only fact log
3. `ContinuityLedger` — staleness tracking
4. `NarrativeRegistry` — entity registry
5. `CanonicalRegistry` — canonical entity registry
6. `NarrativeGraph` — relationship graph

### 9.2 Infrastructure
- **Fencing-token lock** (`CanonLock`) — prevents concurrent canon commits
- **Transactional outbox** (`CanonExtractionOutbox`) — async canon extraction
- **Staleness stamping** — `sourceCanonVersion` on all production artifacts
- **Provenance tracking** — artifact lineage back to canon version

## 10. Domain Layer (66 files, ~8,000 lines)

- `projectCatalog` — project listing, filtering, sorting
- `workflow` — stage transitions, gating, approval
- `narrativeControl` — canon queries, continuity checks
- Various domain utilities and helpers

## 11. Frontend Architecture

### 11.1 Pages (21)
- `/` — landing/redirect
- `/sign-in`, `/sign-up` — Clerk auth
- `/projects` — project list
- `/projects/[id]` — project workspace
- `/projects/[id]/bible` — Story Bible editor
- `/projects/[id]/story` — Story editor
- `/projects/[id]/plan` — Season Plan
- `/projects/[id]/episodes` — Episode list
- `/projects/[id]/episodes/[n]` — Episode editor
- `/projects/[id]/production/*` — Production sub-pages (video, audio, rendering, assembly, shots, visual-assets)
- `/media` — stub
- `/characters` — stub
- `/admin` — stub

### 11.2 Components (25)
- `layout/` — StudioShell, Sidebar, Header, ThemeToggle
- `projects/` — ProjectCard, ProjectList, ProjectForm, ProjectHeader
- `workflow/` — WorkflowStepper, StageGate, ApprovalDialog
- `production/` — VideoPanel, AudioPanel, RenderingPanel, AssemblyPanel
- `ui/` — Button, Input, Label, Card, Dialog (Radix-based)

### 11.3 Hooks (10)
- `useProjects` — project list queries
- `useProject` — single project queries
- `useStoryBible` — bible queries/mutations
- `useStory` — story queries/mutations
- `useProduction` — production queries/mutations
- `useCanon` — canon queries
- etc.

## 12. Test Architecture (82 files, 1,504 cases)

- **Framework:** Vitest 3.2.4
- **Location:** `tests/` directory
- **External services:** Only 2 tests require real services (Kokoro + MongoDB), both auto-skip
- **Mocking:** All LLM, media, and storage providers are mocked in tests
- **Coverage:** Unit + integration tests for providers, services, repositories, validation, pipeline
- **Config:** `vitest.config.ts` sets `LLM_PROVIDER_RETRY_COUNT=1` for fast tests

## 13. Configuration

### 13.1 Environment Variables (~50 vars)
- **LLM:** `LLM_PROVIDER`, `LLM_FALLBACK_PROVIDERS`, `LLM_FREE_ONLY`, `LLM_PROVIDER_RETRY_COUNT`, per-provider API keys
- **Database:** `MONGODB_URI`
- **Queue:** `REDIS_URL`
- **Auth:** Clerk keys
- **Media:** Kokoro paths, FFmpeg path
- **Storage:** Local path, S3/Cloudinary keys (unused)
- **Generation:** Section timeouts, retry counts, strict schema flags

### 13.2 Current Active Configuration
```
LLM_PROVIDER=deepseek
LLM_FALLBACK_PROVIDERS=groq,openrouter,mistral
LLM_FREE_ONLY=false
LLM_PROVIDER_RETRY_COUNT=4
MONGODB_URI=mongodb+srv://...cluster0.1sllugk.mongodb.net/
REDIS_URL=redis://127.0.0.1:6379
```

## 14. Deployment

- **No deployment config found** (no Dockerfile, no docker-compose, no Vercel config)
- App runs locally via `npm run dev` + `npm run worker`
- MongoDB Atlas (cloud) + Redis (local) + Kokoro (local) + FFmpeg (local)
- All media stored locally on disk