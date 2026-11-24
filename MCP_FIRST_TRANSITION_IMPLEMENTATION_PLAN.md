# MCP-First Transition Implementation Plan

**Date:** 2026-11-24
**Status:** Proposal — awaiting approval
**Principle:** AI Drama Studio owns the project, pipeline, documents, canon, approvals, media, audio, video, timeline and rendering. External assistants (ChatGPT, Claude, Kimi, Qwen) perform creative development through MCP. Internal LLM generation is retained as optional functionality, not the default path.

---

## Guiding Principles

1. **Do not discard completed work** — the 13-stage pipeline, MCP server, repositories, services, and approval gates are all retained.
2. **Do not remove provider integrations** — LLM generation remains available as an optional "AI Generate" path.
3. **MCP is the primary creative interface** — external assistants author content through MCP tools; the application persists, validates, and gates it.
4. **The application is the source of truth** — all data lives in MongoDB, all approvals go through the service layer, all canon enforcement remains active regardless of who authored the content.
5. **No `any` types, CSS Modules for new UI** — maintain code quality standards.

---

## Phase A: MCP Tool Gaps (Backend, no UI changes)

**Goal:** Close the 4 identified MCP tool gaps so external assistants can fully author all creative content.

### A1. Add `planning.submit` MCP tool

**Problem:** `planning.approve` requires `submitted` status, but no MCP tool can transition from `draft`/`rejected` to `submitted`.

**Implementation:**
- Add `planning.submit` tool to `registerPlanningTools()` in `lib/mcp/server.ts`
- Input: `{ projectId: string }`
- Handler: `planningService.submit(actor, projectId)` — already exists in the service
- Class: SUBMIT
- No LLM

**Files:**
- `lib/mcp/server.ts` — add tool registration

### A2. Add `scene.create` MCP tool

**Problem:** No MCP tool to create production scene records. Scenes only come from `scene.breakdown` LLM job.

**Implementation:**
- Add `scene.create` tool to `registerSceneTools()` in `lib/mcp/server.ts`
- Input: `{ projectId: string, sceneNumber: number, heading: string, description?: string, notes?: string }`
- Handler: `productionSceneService.create()` or direct repository call
- Requires: approved story + approved characters (same gate as LLM path)
- Class: CREATE
- No LLM

**Files:**
- `lib/mcp/server.ts` — add tool registration
- `lib/services/productionSceneService.ts` — add `create()` method if not present
- `lib/repositories/productionSceneRepository.ts` — add `create()` method if not present

### A3. Add `story.createDraft` MCP tool

**Problem:** No MCP tool to create a story draft from scratch. `document.update` only works when the story is in `awaiting_approval` status, which requires a pipeline run.

**Implementation:**
- Add `story.createDraft` tool to `registerDocumentTools()` in `lib/mcp/server.ts`
- Input: `{ projectId: string, title: string, synopsis: string, structure: string, screenplay: array }`
- Handler: Create a story record in `awaiting_approval` status via `storyRepository`
- Validates against canon (same validation as internal path)
- Class: CREATE
- No LLM

**Files:**
- `lib/mcp/server.ts` — add tool registration
- `lib/services/storyDraftService.ts` — add `createFromExternal()` method
- `lib/repositories/storyRepository.ts` — add `createDraft()` method if not present

### A4. Add `episode.updateScreenplay` MCP tool

**Problem:** `document.update` with `documentType:"episode"` only allows `title`/`premise`/`synopsis`. No way to write the episode's full screenplay content via MCP.

**Implementation:**
- Add `episode.updateScreenplay` tool to `registerEpisodeTools()` in `lib/mcp/server.ts`
- Input: `{ projectId: string, episodeId: string, screenplay: array }`
- Handler: `episodeRepository.updateScreenplay()` or `storyRepository.updateScreenplay()` for the episode's story
- Validates against canon
- Class: UPDATE
- No LLM

**Files:**
- `lib/mcp/server.ts` — add tool registration
- `lib/repositories/episodeRepository.ts` — add `updateScreenplay()` method if not present

### A5. Fix `productionDesign.generateShotList` stub

**Problem:** Tool is named `generateShotList` but returns a static message without enqueuing anything. Misleading name.

**Implementation:**
- Rename to `productionDesign.shotListHint` or keep name but update description to clarify it returns a hint, not a generated result
- OR: Remove the tool and rely on `productionDesign.update` for direct shot list authoring

**Files:**
- `lib/mcp/server.ts` — update tool description or remove

---

## Phase B: Pipeline Decoupling (Backend, no UI changes)

**Goal:** Make the production pipeline work without requiring internal LLM generation. LLM jobs become optional "AI assist" actions, not mandatory pipeline steps.

### B1. Add `pipeline.startMcp` MCP tool (or modify `pipeline.start`)

**Problem:** `pipeline.start` enqueues `story.generate` LLM job. In MCP-first mode, the pipeline should create a run but wait for externally-authored content.

**Implementation:**
- Add option to `pipeline.start`: `{ workflowMode: "guided" | "automatic", source: "mcp" | "internal" }`
- When `source: "mcp"`, create the run but do NOT enqueue any LLM jobs
- The run sits at `currentStage: "story"` in `waiting_for_input` status
- External assistant writes the screenplay via `story.createDraft` or `document.update`
- Then `pipeline.approveStory` advances to character extraction

**Files:**
- `lib/services/pipelineService.ts` — add `source` parameter
- `lib/mcp/server.ts` — update `pipeline.start` tool schema

### B2. Make character extraction optional

**Problem:** `pipeline.approveStory` automatically enqueues `character.extract` LLM job. In MCP-first mode, characters are created via `entity.create`.

**Implementation:**
- Add `skipAutoAdvance` option to `pipelineService.approveStory()`
- When `skipAutoAdvance: true`, mark story approved but do NOT enqueue `character.extract`
- External assistant creates characters via `entity.create` + `entity.approve`
- Then `pipeline.approve` advances to scene breakdown

**Files:**
- `lib/services/pipelineService.ts` — add `skipAutoAdvance` parameter
- `lib/mcp/server.ts` — update `pipeline.approveStory` tool

### B3. Make scene breakdown optional

**Problem:** `pipeline.approve` at character stage automatically enqueues `scene.breakdown` LLM job. In MCP-first mode, scenes are created via `scene.create`.

**Implementation:**
- Add `skipAutoAdvance` option to `pipelineService.approve()` (same pattern as B2)
- When `skipAutoAdvance: true`, mark characters approved but do NOT enqueue `scene.breakdown`
- External assistant creates scenes via `scene.create`
- Then `pipeline.approve` advances to media/render stages

**Files:**
- `lib/services/pipelineService.ts` — add `skipAutoAdvance` parameter
- `lib/mcp/server.ts` — update `pipeline.approve` tool

### B4. Add `pipeline.advance` MCP tool

**Problem:** In MCP-first mode, the pipeline needs a way to advance stages without enqueuing LLM jobs.

**Implementation:**
- Add `pipeline.advance` tool that transitions the run to the next stage without enqueuing any job
- Input: `{ projectId: string, toStage: WorkflowStage }`
- Validates that prerequisites are met (e.g., can't advance to `rendering` without approved timeline)
- No LLM

**Files:**
- `lib/services/pipelineService.ts` — add `advanceStage()` method
- `lib/mcp/server.ts` — add tool registration

---

## Phase C: LLM Generation as Optional (Backend + UI)

**Goal:** Demote LLM generation from default to optional. The UI should default to manual/MCP authoring, with "AI Generate" as a secondary option.

### C1. Add `LLM_GENERATION_ENABLED` environment variable

**Implementation:**
- Default: `true` (preserves current behavior)
- When `false`: all "Generate with AI" buttons are hidden, all LLM job endpoints return `422 Unavailable`, MCP tools that trigger LLM (`pipeline.generateStory`, `pipeline.generateScenes`) return an error message
- This allows a clean toggle without removing code

**Files:**
- `lib/config.ts` or `lib/env.ts` — add config flag
- API routes that enqueue LLM jobs — check flag before enqueuing
- `lib/mcp/server.ts` — check flag in GENERATE-class tools

### C2. Add `source` tracking to documents

**Implementation:**
- Add `authorshipSource: "internal_llm" | "external_mcp" | "manual_ui"` field to:
  - Story Bible (`storyBibleRepository`)
  - Story records (`storyRepository`)
  - Episodes (`episodeRepository`)
  - Season plans (`seasonPlanRepository`)
  - Planning documents (`planningRepository`)
  - Canonical entities (`canonicalEntityRepository`)
  - Production scenes (`productionSceneRepository`)
- Set automatically based on the creation path:
  - LLM engine → `internal_llm`
  - MCP tool handler → `external_mcp`
  - Web UI manual edit → `manual_ui`
- Queryable for UI display and analytics

**Files:**
- `lib/models/*.ts` — add field to schemas
- `lib/repositories/*.ts` — set field on create
- `lib/mcp/server.ts` — set `external_mcp` on MCP-created records
- `lib/pipeline/*Engine.ts` — set `internal_llm` on LLM-generated records

---

## Phase D: UI Redesign for MCP-First (UI only)

**Goal:** Redesign the UI to support the MCP-first workflow. See `MCP_FIRST_TRANSITION_UI_GAPS.md` for detailed UI gaps.

### D1. Demote "Generate with AI" buttons

**Implementation:**
- Move all "Generate with AI" buttons to a collapsible "Advanced" or "AI Assist" section
- Add a toggle/setting: "Show AI generation buttons" (default: off when `LLM_GENERATION_ENABLED=false`)
- Add a badge/tooltip: "This button uses internal AI generation"

**Files:**
- `components/projects/StoryBibleEditor.tsx`
- `components/workflow/StoryDraftWorkspace.tsx`
- `components/workflow/SeasonPlanWorkspace.tsx`
- `components/projects/EpisodeManager.tsx`
- `components/production/ProductionPanel.tsx`

### D2. Promote manual editing and import

**Implementation:**
- Make manual edit forms the primary action on each page
- Make import dialogs prominent (not hidden behind a button)
- Add "Paste from external assistant" option to import dialogs
- Add visual indicators for `authorshipSource`

**Files:**
- All creative page components

### D3. Add MCP status panel

**Implementation:**
- Add a panel/section showing MCP server status, recent MCP activity, and active connections
- Use existing `activity.list` MCP tool data and `activityLogRepository`
- Show in project dashboard or settings

**Files:**
- New component: `components/mcp/McpStatusPanel.tsx`
- `app/(studio)/projects/[projectId]/page.tsx` — add panel to dashboard

### D4. Fix broken Characters page "Approve" button

**Problem:** `characters/page.tsx:118` calls a non-existent API route.

**Implementation:**
- Fix the endpoint to call `POST /api/projects/{id}/characters/{entityId}/approve` or the correct canonical entity approval route
- Or use the existing `entity.approve` path

**Files:**
- `app/(studio)/projects/[projectId]/characters/page.tsx`

### D5. Add "Submit for Review" button to Planning page

**Problem:** Planning page has no submit button — only available via API.

**Implementation:**
- Add "Submit for Review" button that calls `POST /api/projects/{id}/planning/submit`
- Show only when planning status is `draft` or `rejected`

**Files:**
- `app/(studio)/projects/[projectId]/planning/page.tsx`

### D6. Add manual scene creation UI

**Implementation:**
- Add "Add Scene" button to the Scenes page
- Form: scene number, heading, description, notes
- Calls the same API as the new `scene.create` MCP tool

**Files:**
- `app/(studio)/projects/[projectId]/scenes/page.tsx`

### D7. Add episode screenplay editor

**Implementation:**
- Add screenplay editing UI to the Episodes page or a new Episode Detail page
- Allow writing/editing the full screenplay (scenes, dialogue, action)
- Calls the same API as the new `episode.updateScreenplay` MCP tool

**Files:**
- `app/(studio)/projects/[projectId]/episodes/page.tsx` or new `episodes/[episodeId]/page.tsx`

---

## Phase E: Documentation and Testing

### E1. Update MCP server documentation

- Update `AGENTS.md` to reflect 55+ tools (not "17 tools + 6 resources")
- Document the MCP-first workflow for external assistant integration
- Add examples of common workflows (create bible, create characters, create season plan, etc.)

### E2. Update MCP collaboration workflow document

- Update `MCP_COLLABORATION_WORKFLOW.md` to reflect the MCP-first architecture
- Document which tools are primary (CREATE/UPDATE/APPROVE) vs optional (GENERATE)
- Add integration examples for ChatGPT, Claude, Kimi, Qwen

### E3. Add tests for new MCP tools

- Test `planning.submit` MCP tool
- Test `scene.create` MCP tool
- Test `story.createDraft` MCP tool
- Test `episode.updateScreenplay` MCP tool
- Test `pipeline.advance` MCP tool
- Test `LLM_GENERATION_ENABLED=false` behavior

---

## Implementation Order

| Phase | Description | Dependencies | Estimated Changes |
|---|---|---|---|
| A | MCP tool gaps | None | 5 tool additions, ~3 service methods |
| B | Pipeline decoupling | Phase A | 3 service changes, 2 MCP tool updates |
| C | LLM as optional | Phase B | 1 env var, 6 model updates, UI conditional rendering |
| D | UI redesign | Phase C | 7 UI changes, 2 new components |
| E | Documentation & testing | Phases A-D | Docs + tests |

---

## What Is NOT Changing

- **13-stage pipeline** — retained as-is, with optional LLM generation
- **All repositories, models, services** — retained, with optional `authorshipSource` field
- **All approval gates** — retained, identical for MCP and internal paths
- **Canon enforcement** — retained, all content validated against canon regardless of source
- **Continuity ledger** — retained, append-only, updated on approval
- **Media, audio, video, timeline, rendering** — retained, not LLM-dependent
- **MCP server** — retained, extended with new tools
- **BullMQ queues** — retained for non-LLM jobs (audio, render, assembly)
- **Worker process** — retained for non-LLM jobs
- **Internal LLM providers** — retained as optional, not removed

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Breaking existing LLM generation paths | `LLM_GENERATION_ENABLED` defaults to `true`; all changes are additive |
| MCP tool schema changes breaking external assistants | New tools are additions, not modifications; existing tools unchanged |
| Pipeline stage transitions without LLM | `skipAutoAdvance` is opt-in; default behavior unchanged |
| Database schema changes for `authorshipSource` | Field is optional with default; no migration required |
| UI changes confusing existing users | "AI Generate" buttons moved to "Advanced" section, not removed |