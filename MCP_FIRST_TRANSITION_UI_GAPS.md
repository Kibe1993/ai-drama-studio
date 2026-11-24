# MCP-First Transition — UI Gaps

**Date:** 2026-11-24
**Status:** Read-only audit — no code modified
**Purpose:** Identify specific UI gaps that prevent the MCP-first workflow from being usable through the application interface.

---

## Executive Summary

The current UI is designed for an LLM-generation-first workflow. Every creative page defaults to "Generate with AI" buttons as the primary call-to-action, with manual editing as a secondary or hidden option. For the MCP-first architecture to work, the UI must be redesigned so that manual editing, import, and MCP-authored content are the primary paths, with LLM generation demoted to an optional "AI Assist" feature.

There are **7 major UI gaps**, **2 broken UI elements**, and **5 missing UI features** that need to be addressed.

---

## Gap 1: "Generate with AI" Buttons Are Primary Action

### Current State

Every creative page has prominent "Generate with AI" buttons as the primary call-to-action:

| Page | Button(s) | Location | Problem |
|---|---|---|---|
| Story Bible | "Create Story Bible", "Regenerate with my notes", "Start a fresh interpretation", "Regenerate section" (×6), "Apply focused revision" | `StoryBibleEditor.tsx:81-120` | 5 LLM-triggering buttons are the first visible actions |
| Story Draft | "Generate story draft", "Fix all blocking issues", "Revise draft", "Regenerate from scratch", "Revise approved story", "Request targeted revision" | `StoryDraftWorkspace.tsx:221-257` | 6 LLM-triggering buttons dominate the workspace |
| Season Plan | "Generate season plan", "Revise plan", "Regenerate plan", "Regenerate plan from current canon", "Revise approved plan", "Regenerate this episode" | `SeasonPlanWorkspace.tsx:199-253` | 6 LLM-triggering buttons are primary |
| Episodes | "Generate episode N with AI" | `EpisodeManager.tsx:141` | AI generation is the suggested path |
| Production | "Develop story", "Approve story" (cascades to character.extract), "Approve and continue" (cascades to next LLM stage) | `ProductionPanel.tsx:233-269` | Pipeline approval cascades into LLM jobs |

### Required Change

- Move all "Generate with AI" buttons to a collapsible "AI Assist" or "Advanced" section
- Add a project-level setting: "Enable AI generation" (default: off when `LLM_GENERATION_ENABLED=false`)
- Add tooltip/badge on each AI button: "Uses internal AI generation"
- Make manual edit forms and import the primary actions

### Affected Files
- `components/projects/StoryBibleEditor.tsx`
- `components/workflow/StoryDraftWorkspace.tsx`
- `components/workflow/SeasonPlanWorkspace.tsx`
- `components/projects/EpisodeManager.tsx`
- `components/production/ProductionPanel.tsx`

---

## Gap 2: Manual Editing Is Secondary/Hidden

### Current State

Manual editing forms exist but are not prominent:

| Page | Manual Edit Available? | Location | Problem |
|---|---|---|---|
| Story Bible | YES — 5-field editor + "Save manual edits" | `StoryBibleEditor.tsx:131` | Below the generate buttons, not prominent |
| Story Draft | YES — "Edit this screenplay" + "Save edit and revalidate" | `ScreenplayEditor.tsx:162` | Only visible in the Production panel, not the Story Draft workspace |
| Season Plan | YES — "Edit plan" + "Save edit and re-validate" | `SeasonPlanEditor.tsx:221` | Only visible after clicking "Edit plan" button |
| Episodes | YES — "Create episode" (manual) | `EpisodeManager.tsx:144` | Below the "Generate with AI" button |
| Characters | NO — no create/edit form | `characters/page.tsx` | Read-only display; no manual character creation |
| Scenes | NO — no create/edit form | `scenes/page.tsx` | Read-only display; no manual scene creation |
| Canon | NO — no add fact form | `canon/page.tsx` | Read-only display; no manual canon fact addition |
| Production Design | YES — shot list editor | `production-design/page.tsx` | Works but not connected to MCP workflow |

### Required Change

- Make manual edit forms the primary action on each page
- Add "Add Character" form to Characters page
- Add "Add Scene" form to Scenes page
- Add "Add Canon Fact" form to Canon page
- Add "Paste from external assistant" option to all import/edit forms

### Affected Files
- `app/(studio)/projects/[projectId]/characters/page.tsx`
- `app/(studio)/projects/[projectId]/scenes/page.tsx`
- `app/(studio)/projects/[projectId]/canon/page.tsx`
- All creative page components

---

## Gap 3: No MCP Status or Activity Visibility

### Current State

There is no UI showing:
- Whether the MCP server is running
- Recent MCP tool calls
- Which content was authored via MCP vs internal LLM vs manual UI
- Active external assistant connections

### Required Change

Add an MCP status panel to the project dashboard:

```
┌─ MCP Server ──────────────────────────┐
│ Status: ● Running (stdio + HTTP)     #     │
│ Recent Activity:                       │
│  • document.update (bible) — 2m ago    │
│  • entity.create (character) — 5m ago  │
│  • bible.approve — 12m ago             │
│ Tools@ Tools Used Today: 8             │
└────────────────────────────────────────┘
```

### Affected Files
- New: `components/mcp/McpStatusPanel.tsx` + CSS module
- `app/(studio)/projects/[projectId]/page.tsx` — add panel to dashboard

---

## Gap 4: No Authorship Source Indicators

### Current State

There is no visual distinction between:
- Content generated by internal LLM (e.g., "Generated by Gemini")
- Content authored by external assistant via MCP (e.g., "Authored by Claude via MCP")
- Content manually edited in the UI

### Required Change

Add badges/indicators on all content items:
- 🤖 "AI Generated" (internal LLM)
- 🔌 "MCP Authored" (external assistant)
- ✏️ "Manual Edit" (UI)

Requires `authorshipSource` field on documents (see Implementation Plan Phase C2).

### Affected Files
- All creative page components
- `lib/models/*.ts` — add `authorshipSource` field

---

## Gap 5: No Episode Screenplay Editor

### Current State

The Episodes page (`episodes/page.tsx`) shows episode list and metadata. There is no UI for writing or editing the full episode screenplay (scenes, dialogue, action). Episode screenplays are only generated by the `story.generate` LLM job or edited in the Production panel's `ScreenplayEditor`.

### Required Change

Add a screenplay editor to the Episodes page or a new Episode Detail page:
- Scene list with add/remove/reorder
- Per-scene editing: heading, action, dialogue (with character assignment)
- Save button that calls the same API as the new `episode.updateScreenplay` MCP tool
- Canon validation on save

### Affected Files
- `app/(studio)/projects/[projectId]/episodes/page.tsx` — add editor or link to detail page
- New: `app/(studio)/projects/[projectId]/episodes/[episodeId]/page.tsx` — episode detail with screenplay editor
- New: `components/episodes/ScreenplayWriter.tsx` + CSS module

---

## Gap 6: No "Submit for Review" on Planning Page

### Current State

The Planning page (`planning/page.tsx`) has "Save" and "Submit for Review" buttons, but the "Submit for Review" button calls `POST /api/projects/{id}/planning/submit` which exists in the API. However, the MCP `planning.approve` tool is broken because there is no `planning.submit` MCP tool (see Audit §7).

The UI itself does have a submit button (line 189: `onClick={submit}`), so the UI gap is actually in the MCP path, not the UI. But the UI should also show the approval status clearly and allow the full draft → submit → approve cycle.

### Required Change

- Verify the Planning page submit button works correctly
- Add visual status indicator: Draft → Submitted → Approved/Rejected
- Add "Rejected" state handling with rejection reason display

### Affected Files
- `app/(studio)/projects/[projectId]/planning/page.tsx`

---

## Gap 7: No Pipeline Stage Advancement Without LLM

### Current State

The Production page (`ProductionPanel.tsx`) advances pipeline stages by:
1. "Approve story" → automatically enqueues `character.extract` LLM job
2. "Approve and continue" → automatically enqueues next stage LLM job

There is no way to approve a stage and NOT trigger the next LLM job. In MCP-first mode, the user/assistant should be able to:
1. Approve the story
2. Create characters manually or via MCP
3. Approve characters
4. Create scenes manually or via MCP
5. Approve scenes
6. Continue to media/render

### Required Change

Add a "Skip AI generation" toggle or button:
- When enabled, stage approval does NOT enqueue LLM jobs
- Show a message: "Stage approved. Create [characters/scenes] manually or via MCP, then approve to continue."
- Add a "Create manually" link next to each stage

### Affected Files
- `components/production/ProductionPanel.tsx`
- `lib/services/pipelineService.ts` — add `skipAutoAdvance` option

---

## Broken UI Elements

### Bug 1: Characters Page "Approve" Button — 404

**Location:** `app/(studio)/projects/[projectId]/characters/page.tsx:118`
**Problem:** The "Approve" button calls `POST /api/projects/{id}/visual-assets/entities/{entityId}/approve`, but this API route does not exist in the codebase. The `app/api/projects/[projectId]/visual-assets/` tree has no `entities/[entityId]/approve/` directory.
**Impact:** Clicking "Approve" on a character returns a 404 error.
**Fix:** Change the endpoint to call the correct canonical entity approval API, or create the missing route.

### Bug 2: `planning.approve` via MCP — Invalid Status

**Location:** `lib/mcp/server.ts` — `planning.approve` tool
**Problem:** The `planningService.approve()` method requires the planning document to be in `submitted` status, but there is no `planning.submit` MCP tool. The `planning.update` tool only upserts into `draft`/`rejected` status.
**Impact:** `planning.approve` via MCP always throws `invalid_status` error.
**Fix:** Add `planning.submit` MCP tool (see Implementation Plan Phase A1).

---

## Missing UI Features

### Feature 1: "Paste from External Assistant" Import Option

**Need:** Users should be able to paste content authored in ChatGPT/Claude/Kimi/Qwen directly into the application.
**Implementation:** Add a "Paste from Assistant" tab in all import dialogs with a textarea and format selector (JSON, Fountain, plain text).

### Feature 2: MCP Connection Guide

**Need:** Users need guidance on how to connect external assistants to the MCP server.
**Implementation:** Add a "Connect Assistant" page or modal with:
- MCP server URL/transport info
- Available tools list
- Example prompts for common workflows
- Per-assistant setup instructions (ChatGPT,- Claude, Kimi, Qwen)

### Feature 3: Content Diff View

**Need:** When replacing LLM-generated content with MCP-authored content, users should see a diff.
**Implementation:** Add a diff viewer component that shows before/after when using `document.update` or import.

### Feature 4: Batch Operations

**Need:** External assistants may2may create multiple entities/episodes/scenes in sequence. The UI should support batch review.
**Implementation:** Add a "Pending Review" queue showing all `pending_review` entities, `draft` episodes, `submitted` plans, etc. with batch approve/reject.

### Feature 5: Pipeline Configuration UI

**Need:** Users should be able to configure whether the pipeline uses LLM generation or MCP-first mode.
**Implementation:** Add a "Pipeline Settings" panel:
- Toggle: "Enable AI generation" (maps to `LLM_GENERATION_ENABLED`)
- Toggle: "Auto-advance after approval" (maps to `skipAutoAdvance`)
- Toggle: "Show AI generate buttons" (UI preference)
- Default: All off when MCP-first mode is active

---

## UI Page-by-Page Assessment

### Pages That Work for MCP-First (minimal changes needed):

| Page | Status | Changes Needed |
|---|---|---|
| Dashboard (`page.tsx`) | **WORKS** | Add MCP status panel |
| Planning (`planning/page.tsx`) | **WORKS** | Verify submit button; add*add status indicator |
| Story Bible (`bible/page.tsx`) | **WORKS** | Demote generate buttons; promote manual edit |
| Canon (`canon/page.tsx`) | **WORKS** | Add "Add Fact" form; rebuild button already present |
| Production Design (`production-design/page.tsx`) | **WORKS** | Already uses direct editing, no LLM buttons |
| Timeline (`timeline/page.tsx`) | **WORKS** | Already uses TimelineEditor, no LLM |
| Audio (`audio/page.tsx`) | **WORKS** | Uses Kokoro TTS, not LLM |
| Video (`video/page.tsx`) | **PARTIAL** | Demote "Develop story" button |
| Rendering (`rendering/page.tsx`) | **WORKS** | Uses FFmpeg, not LLM |
| Media (`media/page.tsx`) | **WORKS** | Asset management, no LLM |

### Pages That Need Significant Changes:

| Page | Status | Changes Needed |
|---|---|---|
| Story Draft (`story/page.tsx`) | **NEEDS REWORK** | Demote 6 generate buttons; promote manual screenplay editing; add import from assistant |
| Season Plan (`plan/page.tsx`) | **NEEDS REWORK** | Demote 6 generate buttons; promote manual plan editing |
| Episodes (`episodes/page.tsx`) | **NEEDS REWORK** | Demote "Generate with AI"; add manual episode creation; add screenplay editor |
| Characters (`characters/page.tsx`) | **NEEDS REWORK** | Fix broken Approve button; add manual character creation form |
| Scenes (`scenes/page.tsx`) | **NEEDS REWORK** | Add manual scene creation form; add scene editing |
| Production (`production/page.tsx`) | **NEEDS REWORK** | Add "Skip AI generation" toggle; demote "Develop story" button |

---

## Summary

| Category | Count | Priority |
|---|---|---|
| Major UI gaps | 7 | High |
| Broken UI elements | 2 | High (bugs) |
| Missing UI features | 5 | Medium |
| Pages needing significant rework | 6 | High |
| Pages working with minimal changes | 10 | Low |

The UI gaps are **not blocking** the MCP-first transition — external assistants can already use the MCP tools directly. The UI gaps affect the **in-app experience** for users who want to see, review, and manage MCP-authored content without leaving the application.