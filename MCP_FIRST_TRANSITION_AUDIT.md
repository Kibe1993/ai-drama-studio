# MCP-First Transition Audit

**Date:** 2026-11-24
**Status:** Read-only audit — no code modified
**Purpose:** Assess readiness for MCP-first architecture where external assistants (ChatGPT, Claude, Kimi, Qwen) perform creative development through MCP, while AI Drama Studio owns the project, pipeline, documents, canon, approvals, media, audio, video, timeline and rendering.

---

## Executive Summary

The application has **55 MCP tools** and **9 resources** that already provide substantial support for externally authored creative work. An external assistant can create and approve a Story Bible, create characters/locations/objects, create episode shells, create and approve season plans, add canon facts, and manage production design — all through MCP with zero internal LLM calls.

However, **9 internal LLM generation workflows remain active** and are triggered by **17+ UI buttons**. Three MCP tools (`pipeline.start`, `pipeline.generateStory`, `pipeline.generateScenes`) still enqueue internal LLM jobs. The production pipeline's character extraction and scene breakdown stages have no MCP-only path for creating new records (only updating existing ones).

The 13-stage pipeline **can** operate without internal LLM if all creative content is authored externally via MCP, but the UI does not yet surface this workflow — every creative page defaults to "Generate with AI" buttons.

---

## 1. Internal LLM Generation Workflows Still Active

### 1.1 LLM Provider System

**Provider Manager:** `lib/providers/llm/manager.ts` — `StoryProviderManager` class
- Core method: `runSequence<T>()` (line 608) — sequential failover with circuit breaker, retries, timeouts
- 10 configured providers: `ollama`, `lmstudio`, `gemini`, `groq`, `openrouter`, `mistral`, `openai`, `anthropic`, `deepseek`, `kimi`
- 13 task types routed through `runSequence`: `story`, `characters`, `scenes`, `story_bible`, `episode_suggestion`, `season_plan`, `season_architecture`, `episode_details`, `scene_repair`, `episode_revision`, `story_critic`, `canon_extraction`, `canon_fact_extraction`

**Registry:** `lib/providers/llm/registry.ts`
- Primary provider from `LLM_PROVIDER` env (default: `gemini`)
- Fallback chain from `LLM_FALLBACK_PROVIDERS` env (default: `groq,openrouter,mistral,openai,deepseek,kimi,anthropic,ollama`)
- `LLM_TEST_MODE=lmstudio` forces exclusive LM Studio mode (no fallback)

### 1.2 Active Generation Workflows (9)

| # | Workflow | Job Type | LLM Method(s) | runSequence Task(s) | Enqueued Via | MCP Bypass Available? |
|---|---|---|---|---|---|---|
| 1 | Story Bible (6 sections) | `storyBible.generate` | `llm.generateStoryBible()` ×6 | `story_bible` | BullMQ `generation` | **YES** — `document.update`/`document.import` |
| 2 | Story Draft (6 parts) | `story.draft` | `llm.generateStory()` ×6, `llm.critiqueStory()` | `story`, `story_critic` | BullMQ `generation` | **YES** — `document.update`/`document.import` |
| 3 | Episode Screenplay | `story.generate` | `llm.generateStory()`, `llm.repairScenes()`, `llm.critiqueStory()` | `story`, `scene_repair`, `story_critic` | BullMQ `generation` | **YES** — `document.update` (screenplay in `awaiting_approval` window) |
| 4 | Character Extraction | `character.extract` | `llm.generateCharacters()` | `characters` | BullMQ `generation` | **YES** — `entity.create` |
| 5 | Scene Breakdown | `scene.breakdown` | `llm.generateScenes()` | `scenes` | BullMQ `generation` | **PARTIAL** — `scene.update` edits existing scenes but cannot create new scene records |
| 6 | Season Plan | `seasonPlan.generate` | `llm.generateSeasonArchitecture()`, `llm.generateEpisodeDetails()` OR `llm.generateSeasonPlan()` | `season_architecture`, `episode_details` OR `season_plan` | BullMQ `generation` | **YES** — `seasonPlan.start`/`seasonPlan.update` |
| 7 | Episode Suggestion | `episodeSuggest.generate` | `llm.generateEpisodeSuggestion()` | `episode_suggestion` | BullMQ `generation` | **YES** — `episode.create` |
| 8 | Canon Suggestions | (none — synchronous) | `llm.generateCanonSuggestions()` | `canon_extraction` | Direct API call (not BullMQ) | **YES** — `canon.add` |
| 9 | Canon Fact Extraction | `canon.extract` | `llm.generateCanonFacts()` | `canon_fact_extraction` | BullMQ `generation` (wired but no active enqueue found) | **YES** — `canon.add` |

### 1.3 Non-LLM Pipeline Jobs (retained as-is)

| Job Type | Engine | Notes |
|---|---|---|
| `assembly.generate` | Timeline assembly | No LLM — composes timeline clips |
| `render.final` | FFmpeg render | No LLM — video composition |
| `audio.dialogue` / `audio.narration` | Kokoro TTS | No LLM — local TTS engine |
| `video.scene` / `image.*` | Mock engines | MOCK/UNAVAILABLE — not real generation |

---

## 2. UI Buttons That Trigger Internal Provider Calls

### 2.1 Story Bible Page (`bible/page.tsx` + `StoryBibleEditor.tsx`)

| Button | API Endpoint | LLM Job | Non-LLM Alternative |
|---|---|---|---|
| "Create Story Bible" / "Regenerate with my notes" | `POST /story-bible/generate` | `storyBible.generate` | Manual 5-field editor + "Save manual edits" |
| "Start a fresh interpretation" | `POST /story-bible/regenerate` | `storyBible.generate` | Manual edit |
| "Regenerate section" (×6 sections) | `POST /story-bible/sections/{section}/regenerate` | `storyBible.generate` | Manual edit |
| "Apply focused revision" | `POST /story-bible/revise` | `storyBible.generate` | Manual edit + save |

### 2.2 Story Draft Page (`story/page.tsx` + `StoryDraftWorkspace.tsx`)

| Button | API Endpoint | LLM Job | Non-LLM Alternative |
|---|---|---|---|
| "Generate story draft" | `POST /story-draft` (generate) | `story.draft` | Import dialog; manual screenplay edit |
| "Fix all blocking issues" | `POST /story-draft` (revise) | `story.draft` | Manual edit + revalidate |
| "Revise draft" | `POST /story-draft` (revise) | `story.draft` | Manual edit |
| "Regenerate from scratch" | `POST /story-draft` (regenerate) | `story.draft` | Manual edit |
| "Revise approved story" | `POST /story-draft` (revise) | `story.draft` | Manual edit |
| "Request targeted revision" | `POST /story-draft` (targeted_revision) | `story.draft` | "Accept as intentional"; manual edit |
| Story Import confirm | `POST /story-draft` (generate) | `story.draft` | Manual editing |

### 2.3 Episodes Page (`episodes/page.tsx` + `EpisodeManager.tsx`)

| Button | API Endpoint | LLM Job | Non-LLM Alternative |
|---|---|---|---|
| "Generate episode N with AI" | `POST /episodes/generate` | `episodeSuggest.generate` | "Create episode" (manual) |

### 2.4 Season Plan Page (`plan/page.tsx` + `SeasonPlanWorkspace.tsx`)

| Button | API Endpoint | LLM Job | Non-LLM Alternative |
|---|---|---|---|
| "Generate season plan" | `POST /season-plan` (generate) | `seasonPlan.generate` | "Edit plan" + "Save edit and re-validate" |
| "Revise plan" | `POST /season-plan` (revise) | `seasonPlan.generate` | Manual edit |
| "Regenerate plan" | `POST /season-plan` (regenerate) | `seasonPlan.generate` | Manual edit |
| "Regenerate plan from current canon" | `POST /season-plan` (regenerate) | `seasonPlan.generate` | Manual edit |
| "Revise approved plan" | `POST /season-plan` (revise) | `seasonPlan.generate` | Manual edit |
| "Regenerate this episode" | `POST /season-plan` (revise) | `seasonPlan.generate` | Manual edit |

### 2.5 Production Page (`production/page.tsx` + `ProductionPanel.tsx`)

| Button | API Endpoint | LLM Job | Non-LLM Alternative |
|---|---|---|---|
| "Develop story" | `POST /production` (story) | `story.generate` | "Edit this screenplay" + "Save edit and revalidate" |
| "Approve story" | `POST /stories/{storyId}/approve` | `character.extract` (cascading) | Manual screenplay edit before approving |
| "Approve and continue" | `POST /production` (approve) | Next stage LLM job (cascading) | Manual edits before approving |
| "Retry" | `POST /production` (retry) | Re-enqueues current LLM stage | N/A (recovery path) |

---

## 3. MCP Tools That Support Externally Submitted Creative Work

### 3.1 Complete Tool Classification (55 tools)

**CREATE (7):** `project.create`, `document.import` (bible), `canon.add`, `media.upload`, `entity.create`, `episode.create`, `seasonPlan.start`

**UPDATE (9):** `project.update`, `project.delete`, `document.update`, `document.import` (story), `scene.update`, `seasonPlan.update`, `entity.updateVisualProfile`, `pipeline.cancel`, `voice.assign`, `planning.update`, `productionDesign.update`

**APPROVE (8):** `pipeline.approveStory`, `pipeline.approve`, `entity.approve`, `scene.approveShotPlan`, `seasonPlan.approve`, `timeline.approve`, `bible.approve`, `story.approve`, `planning.approve`

**READ (22):** `project.list`, `project.get`, `document.get`, `document.export`, `canon.query`, `canon.summary`, `media.list`, `render.status`, `pipeline.get`, `entity.list`, `entity.get`, `episode.list`, `episode.get`, `scene.list`, `scene.get`, `seasonPlan.get`, `seasonPlan.listVersions`, `timeline.get`, `timeline.findByEpisode`, `project.context`, `activity.list`, `planning.get`, `productionDesign.get`

**GENERATE / triggers internal LLM (3):** `pipeline.start`, `pipeline.generateStory`, `pipeline.generateScenes`

**Stubs (2):** `media.generate_audio` (returns `supported:false`), `productionDesign.generateShotList` (returns static message, no job enqueued)

### 3.2 MCP Resources (9)

All read-only JSON snapshots under `project://` URI scheme:
1. `project-bible` — Story Bible
2. `project-story` — Current story draft
3. `project-episodes` — Episode by number
4. `project-canon` — Latest canon state
5. `project-assets` — All media assets
6. `project-timeline` — All timelines
7. `project-characters` — All canonical entities
8. `project-scenes` — All production scenes
9. `project-season-plan` — Current season plan

---

## 4. Can an External Assistant Create and Submit a Story Bible Without Internal LLM?

**YES — fully supported, zero LLM calls.**

Path:
1. `document.update` with `documentType:"bible"`, `data:{premise, worldRules, themes, boundaries, canonFacts, ...}`, `confirm:true`
   → `storyBibleService.save()` → `storyBibleRepository.saveDraft()` — pure repository write
2. `bible.approve` with `expectedVersion` + `expectedDraftRevision`
   → `storyBibleService.approve()` → `storyBibleRepository.approve()` — checks content exists, no LLM

Alternative: `document.import` with `documentType:"bible"`, `content:<JSON string>`, `confirm:true` → same path.

The `project-bible` resource lets the assistant read back the result.

**Verdict: WORKING.** No changes needed.

---

## 5. Can an External Assistant Develop Episodes and Screenplays Using the Same Project Data?

**PARTIALLY.**

### What works:
- `episode.create` — creates episode shell (`title`, `premise`, `targetDurationSeconds`) in `draft` status, no LLM. Enforces gate: requires approved Story Bible.
- `document.update` with `documentType:"story"` — writes the screenplay array via `storyRepository.updateScreenplay`, but **only when the story is in `awaiting_approval` status**. So an external assistant can replace the LLM-generated screenplay with its own content before approval.
- `project.context` — builds a context bundle for the assistant with project, bible, story, canon, entities, episodes, scenes data.

### What does NOT work:
- **No MCP tool to create a story draft from scratch.** Story draft creation requires `pipeline.generateStory` (LLM-backed) or the web UI's `POST /story-draft` endpoint. An external assistant cannot initiate a story draft via MCP without triggering LLM.
- **No MCP tool to write full episode screenplay/teleplay content.** `document.update` with `documentType:"episode"` only allows `title`, `premise`, `synopsis` — no screenplay payload. The episode's actual produced content (scenes, dialogue) is not writable via MCP.
- **No MCP tool to create production scenes.** Scenes come from `pipeline.generateScenes` (LLM). `scene.update` only edits existing scenes.

**Verdict: INCOMPLETE.** External assistants can create episode shells and replace story screenplays, but cannot author full episode screenplays or create scene records via MCP.

---

## 6. Can Character, Location, Scene and Canon Records Be Created and Updated Through MCP With Proper Approval?

### Characters / Locations / Objects — **YES**
- `entity.create` (with `confirm:true`) → creates in `pending_review` status, no LLM
- `entity.approve` → promotes to approved canon
- `entity.updateVisualProfile` → updates visual/voice profile
- `voice.assign` → assigns voice profile
- Gate: `pending_review → approved` enforced by repository

### Canon Facts — **YES** (append-only, no per-fact approval)
- `canon.add` (with `confirm:true`) → appends to event log, commits new canon version immediately
- No draft→approve cycle for individual facts (deliberate append-only design)

### Production Scenes — **PARTIAL**
- `scene.update` → edits `description`/`notes` on existing scenes, no LLM
- `scene.approveShotPlan` → approves shot plan
- **Cannot create new scene records via MCP** — scenes only come from `scene.breakdown` LLM job
- **Gap:** No `scene.create` MCP tool

### Season Plans — **YES**
- `seasonPlan.start` → creates draft (JSON string input), no LLM
- `seasonPlan.update` → updates existing plan, no LLM
- `seasonPlan.approve` → approves plan
- Full create/update/approve lifecycle

### Planning Documents — **PARTIAL**
- `planning.update` → creates/updates planning doc (upserts into `draft`/`rejected` status)
- `planning.approve` → approves/rejects
- **Gap:** No `planning.submit` MCP tool — service requires `submitted` status before approval, but MCP cannot transition from `draft` to `submitted`. `planning.approve` will throw `invalid_status` unless the document was submitted through the web UI.

**Verdict: MOSTLY WORKING.** Gaps: no `scene.create`, no `planning.submit`, no episode screenplay write.

---

## 7. Do All Existing Approval Gates Work for Externally Submitted Documents?

| Approval Target | MCP Tool | Same as Internal? | Notes |
|---|---|---|---|
| Story Bible | `bible.approve` | **YES** | Identical service method, content check, optimistic concurrency |
| Story draft | `story.approve` / `pipeline.approveStory` | **YES** | Identical validation finding checks |
| Pipeline stage | `pipeline.approve` | **YES** | Identical stage transition |
| Canonical entity | `entity.approve` | **YES** | Repository-level `pending_review → approved` |
| Scene shot plan | `scene.approveShotPlan` | **YES** | Identical gate |
| Season plan | `seasonPlan.approve` | **YES** | Requires `submitted` status (achievable via `seasonPlan.start`) |
| Timeline | `timeline.approve` | **YES** | Identical |
| Planning document | `planning.approve` | **BROKEN** | Service requires `submitted` status, but MCP has no `planning.submit` tool |

**Verdict: MOSTLY WORKING.** One broken gate: `planning.approve` cannot be reached via MCP alone.

---

## 8. Can the 13-Stage Production Pipeline Operate Without an Internal LLM Provider?

### Stage-by-stage analysis:

| Stage | Requires LLM? | MCP Path Available? | Notes |
|---|---|---|---|
| 1. `project_setup` | No | `project.create` | No LLM involved |
| 2. `planning` | No | `planning.update` | Direct write (but `planning.submit` gap prevents MCP-only approval) |
| 3. `bible` | No | `document.update` + `bible.approve` | Fully MCP-capable |
| 4. `episodes` | No | `episode.create` | Episode shells only; no screenplay content via MCP |
| 5. `characters` | No | `entity.create` + `entity.approve` | Fully MCP-capable |
| 6. `scenes` | **YES** (for creation) | `scene.update` (edits only) | **Cannot create scene records via MCP** |
| 7. `story` | **YES** (for generation) | `document.update` (in `awaiting_approval` window) | Can replace LLM output, but cannot initiate draft |
| 8. `canon` | No | `canon.add` | Fully MCP-capable (append-only) |
| 9. `production_design` | No | `productionDesign.update` | Fully MCP-capable |
| 10. `audio` | No (Kokoro TTS) | N/A (web UI / API) | Not LLM-dependent |
| 11. `video` | No (MOCK) | N/A | Mock engine |
| 12. `timeline` | No | `timeline.approve` | Assembly is computational |
| 13. `rendering` | No (FFmpeg) | `render.start` | Not LLM-dependent |

### Conclusion:

**The pipeline CAN operate without internal LLM IF:**
- Creative content (bible, characters, season plan, canon, production design) is authored externally via MCP
- Story screenplays are written via `document.update` after a pipeline run creates the `awaiting_approval` state
- Scene records are created through the pipeline (requires one LLM call for `scene.breakdown`) OR a new `scene.create` MCP tool is added

**The pipeline CANNOT operate without internal LLM IF:**
- The user wants to generate story drafts from scratch (requires `story.draft` or `story.generate` LLM job)
- The user wants automatic character extraction from the story (requires `character.extract` LLM job)
- The user wants automatic scene breakdown from the story (requires `scene.breakdown` LLM job)

**Verdict: PARTIALLY READY.** The pre-production stages (1-5, 8-9) are MCP-capable. The creative generation stages (6-7) require either LLM or new MCP tools to create records from scratch.

---

## 9. Provider Services, Jobs, Registry Entries and UI Components — Retirement/Retention Analysis

### Should Be RETAINED (core infrastructure, not LLM-specific):

| Component | Location | Reason |
|---|---|---|
| BullMQ queue system | `lib/pipeline/redis.ts` | Needed for audio, render, assembly jobs |
| Worker process | `workers/studio.ts` | Needed for non-LLM jobs |
| Job processing framework | `lib/pipeline/processJob.ts` | Dispatch logic for all job types |
| All repositories | `lib/repositories/` | Data access layer |
| All services | `lib/services/` | Business logic |
| All models | `lib/models/` | Database schemas |
| All validation | `lib/validation/` | Zod schemas |
| MCP server | `lib/mcp/server.ts` | External assistant interface |
| Kokoro TTS | `lib/providers/audio/` | Local audio generation |
| FFmpeg render | `lib/providers/render/` | Video composition |
| Timeline editor | `components/timeline/` | Visual editing |
| All approval flows | Various | Pipeline gates |

### Should Be Made OPTIONAL (LLM generation — retain but not default):

| Component | Location | Current Trigger | MCP-First Alternative |
|---|---|---|---|
| Story Bible engine | `lib/pipeline/storyBibleEngine.ts` | `storyBible.generate` job | `document.update` + `bible.approve` |
| Story Draft engine | `lib/pipeline/storyDraftEngine.ts` | `story.draft` job | `document.update` (screenplay) |
| Season Plan engine | `lib/pipeline/seasonPlanEngine.ts` | `seasonPlan.generate` job | `seasonPlan.start` + `seasonPlan.approve` |
| Episode Suggest engine | `lib/pipeline/episodeSuggestEngine.ts` | `episodeSuggest.generate` job | `episode.create` |
| Character extraction | `lib/pipeline/liveEngines.ts:492` | `character.extract` job | `entity.create` + `entity.approve` |
| Scene breakdown | `lib/pipeline/liveEngines.ts:531` | `scene.breakdown` job | `scene.update` (edits only — **needs `scene.create`**) |
| Canon suggestions | `lib/services/canonExtractionService.ts` | Direct API call | `canon.add` |
| Canon fact extraction | `lib/services/canonFactExtractionService.ts` | `canon.extract` job | `canon.add` |
| LLM provider manager | `lib/providers/llm/manager.ts` | All above jobs | Only needed if LLM generation is used |
| LLM provider registry | `lib/providers/llm/registry.ts` | Provider configuration | Only needed if LLM generation is used |
| LLM provider adapters | `lib/providers/llm/*.ts` | Provider API calls | Only needed if LLM generation is used |

### Should Be RETIRED (when MCP-first is confirmed):

Nothing should be retired yet. The user explicitly stated: "Do not remove existing provider integrations yet. We need to understand their dependencies and decide what should remain available as optional functionality."

### UI Components — Status:

| Component | Current Role | MCP-First Role |
|---|---|---|
| "Generate" buttons (all pages) | Primary action | **Demote** to "Advanced" or "AI Generate" secondary action |
| "Import" buttons | Alternative input | **Promote** to primary action for externally authored content |
| Manual edit forms | Fallback | **Promote** to primary action |
| Approval buttons | Pipeline gates | **Retain** as-is (identical for MCP and internal) |
| `ProjectNav` | Navigation | **Retain** as-is |
| `WorkflowStepper` | Pipeline progress | **Retain** as-is |
| `StageLayout` | Workflow guard | **Retain** as-is |
| `ProjectHeader` | Project header | **Retain** as-is |

---

## 10. Does the Existing UI Support the MCP-First Workflow?

**NO — the UI is designed for the LLM-generation workflow, not MCP-first.**

### Current UI behavior:
- Every creative page has prominent "Generate with AI" buttons as the primary call-to-action
- Manual edit forms are secondary or hidden behind expandable sections
- Import dialogs exist but are not prominent
- No UI indication that content can be authored externally via MCP
- No UI for managing MCP connections or viewing MCP activity
- No way to mark content as "externally authored" vs "internally generated"
- No "Submit for review" button on the planning page (only available via API)

### What the UI needs for MCP-first:
- Promote manual editing and import to primary actions
- Demote "Generate with AI" buttons to secondary/advanced actions
- Add visual indicators for MCP-authored content
- Add MCP connection/activity panel
- Add "Submit for review" button on planning page
- Add ability to create scenes manually (not just via LLM breakdown)
- Add ability to write episode screenplays manually (not just via LLM generation)

### Broken UI elements found:
1. **Characters page "Approve" button** (`characters/page.tsx:118`) calls `POST /api/projects/{id}/visual-assets/entities/{entityId}/approve` — this route does **not exist** in the codebase. Will return 404.
2. **`planning.approve` via MCP** is broken — service requires `submitted` status but MCP has no `planning.submit` tool.

---

## Summary Assessment

| Question | Answer |
|---|---|
| 1. Internal LLM workflows still active? | **9 active** (bible, draft, story, characters, scenes, season plan, episode suggest, canon suggestions, canon facts) |
| 2. UI buttons triggering internal providers? | **17+ buttons** across 5 pages |
| 3. MCP tools for externally submitted work? | **52 of 55 tools** support external work (3 trigger LLM) |
| 4. Story Bible via MCP without LLM? | **YES** — fully working |
| 5. Episodes/screenplays via MCP? | **PARTIAL** — episode shells yes, full screenplays no |
| 6. Characters/locations/scenes/canon via MCP? | **MOSTLY YES** — gaps: no `scene.create`, no `planning.submit` |
| 7. Approval gates for external documents? | **MOSTLY YES** — `planning.approve` broken via MCP |
| 8. Pipeline without internal LLM? | **PARTIALLY** — pre-production stages work, creative generation stages need LLM or new MCP tools |
| 9. What to retire/retain/optional? | Retain all; make LLM generation optional; nothing retired yet |
| 10. UI supports MCP-first? | **NO** — UI defaults to LLM generation; needs redesign for MCP-first |