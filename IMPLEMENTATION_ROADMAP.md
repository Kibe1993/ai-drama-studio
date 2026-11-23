# Implementation Roadmap

**Date:** 2026-11-23
**Status:** Stage 0 forensic audit (read-only)

---

## Overview

11 stages (0-10) with **mandatory user approval** between each stage. Each stage is self-contained and leaves the application in a working state.

**Approval gate:** After each stage, present summary, wait for explicit user approval before proceeding.

---

## Stage 0: Forensic Audit ✅ (COMPLETE)

**Goal:** Read-only inspection of current codebase
**Deliverables:**
1. ✅ `RESTRUCTURE_AUDIT.md` — executive summary
2. ✅ `CURRENT_ARCHITECTURE.md` — detailed architecture
3. ✅ `FEATURE_RETENTION_MATRIX.md` — feature classification
4. ✅ `DATA_MIGRATION_RISKS.md` — migration risks
5. ✅ `TARGET_ARCHITECTURE_PROPOSAL.md` — target architecture
6. ✅ `IMPLEMENTATION_ROADMAP.md` — this document

**Status:** Complete. Awaiting user approval to proceed to Stage 1.

---

## Stage 1: Pre-Migration & Backup

**Goal:** Safeguard existing data and prepare for restructuring

**Tasks:**
1. Create git tag `pre-restructure-backup`
2. Backup MongoDB database (mongodump or Atlas snapshot)
3. Export all canon data to JSON archives:
   - `backups/narrative_canon.json`
   - `backups/canon_facts.json`
   - `backups/continuity_ledger.json`
   - `backups/narrative_registry.json`
   - `backups/canonical_registry.json`
   - `backups/narrative_graph.json`
4. Drain all BullMQ queues (process or fail in-flight jobs)
5. Clear all `CanonLock` documents
6. Process all `CanonExtractionOutbox` entries
7. Record current `.env` configuration to `backups/env.backup`
8. Verify backup integrity

**Verification:**
- All backup files exist and are non-empty
- All queues are empty
- No `CanonLock` documents remain
- No pending `CanonExtractionOutbox` entries
- Full test suite passes

**Approval gate:** Present backup summary, wait for approval.

---

## Stage 2: Canon System Simplification

**Goal:** Consolidate 6 canon registries to 2 collections

**Tasks:**
1. Create new `Canon` model (consolidated schema)
2. Ensure `CanonicalEntity` model has all needed fields
3. Write migration script `scripts/migrate-canon.ts`:
   - Read from `NarrativeCanon` + `CanonFact` → write to `Canon`
   - Read from `NarrativeRegistry` + `CanonicalRegistry` → write to `CanonicalEntity`
   - Dry-run mode first, then execute
4. Update all code references:
   - Repositories: remove `ContinuityLedgerRepo`, `NarrativeRegistryRepo`, `NarrativeGraphRepo`
   - Services: update `CanonService` to use new `Canon` model
   - Domain: update narrative control to use simplified canon
5. Simplify staleness tracking: keep `sourceCanonVersion` on artifacts, remove `ContinuityLedger`
6. Keep canon consistency validation (simplified)
7. Update tests for new canon schema
8. Remove old model files: `ContinuityLedger`, `NarrativeRegistry`, `NarrativeGraph`, `CanonLock`, `CanonExtractionOutbox`
9. Do NOT drop old collections yet (keep for rollback)

**Verification:**
- Migration script runs successfully in dry-run
- Migration script executes successfully
- All canon data accessible via new `Canon` collection
- Full test suite passes
- Application starts and projects load correctly

**Approval gate:** Present migration results, wait for approval.

---

## Stage 3: LLM Provider Simplification

**Goal:** Remove ASPO, simplify provider selection, make LLM optional

**Tasks:**
1. Remove ASPO code (`lib/providers/llm/aspo.ts` and related)
2. Simplify `StoryProviderManager`:
   - Replace ASPO selection with simple priority list from `.env`
   - Keep retry logic (4x with backoff)
   - Keep failover across fallback chain
   - Keep empty-field retry for Story Bible
   - Keep fingerprint caching/resume
3. Remove free-tier policy enforcement (`freePolicy.ts`)
4. Consolidate validation files (30 → ~15):
   - Merge related Zod schemas
   - Remove unused schemas
   - Keep essential validation for LLM output
5. Make LLM endpoints return 503 with helpful message when no provider configured
6. Update `.env.example` with simplified provider vars
7. Update tests: remove ASPO tests, update provider tests
8. Keep provider adapters (DeepSeek, Groq, OpenRouter, Ollama) — remove or disable others

**Verification:**
- App starts without LLM configured (no crash)
- LLM endpoints return 503 with helpful message when unconfigured
- LLM generation works when configured
- Full test suite passes

**Approval gate:** Present simplification results, wait for approval.

---

## Stage 4: MCP Server Implementation

**Goal:** Add MCP server to expose project data to external AI assistants

**Tasks:**
1. Install `@modelcontextprotocol/sdk`
2. Create `lib/mcp/server.ts` — MCP server setup
3. Implement MCP tools:
   - `project.list`, `project.create`, `project.get`, `project.update`, `project.delete`
   - `document.get`, `document.update`, `document.import`, `document.export`
   - `canon.query`, `canon.add`, `canon.validate`
   - `media.list`, `media.upload`, `media.generate_audio`
   - `render.start`, `render.status`
4. Implement MCP resources:
   - `project://{projectId}/bible`
   - `project://{projectId}/story`
   - `project://{projectId}/episodes/{n}`
   - `project://{projectId}/canon`
   - `project://{projectId}/assets`
   - `project://{projectId}/timeline`
5. Create MCP server entry point (`scripts/mcp-server.ts`)
6. Add MCP configuration documentation
7. Write tests for MCP tools and resources
8. Add `MCPStatus` component to UI (connection indicator)

**Verification:**
- MCP server starts and responds to tool calls
- External AI assistant can list projects, read/write documents
- MCP tests pass
- Full test suite passes

**Approval gate:** Present MCP server demo, wait for approval.

---

## Stage 5: Document Editing & Import

**Goal:** Add manual editing and import/export capability for all documents

**Tasks:**
1. Install rich text editor (Tiptap or similar, open-source)
2. Create `DocumentEditor` component:
   - Rich text editing for Story Bible, Story, Episodes
   - Save to DB with versioning
   - Auto-save with debounce
3. Create `ImportDialog` component:
   - Import from file (markdown, JSON, TXT)
   - Import from MCP (paste content)
   - Parse and validate imported content
4. Add export functionality:
   - Export as Markdown
   - Export as JSON
   - Export as PDF (using existing or lightweight library)
5. Update pages:
   - `/projects/[id]/bible` — add DocumentEditor + Import/Export
   - `/projects/[id]/story` — add DocumentEditor + Import/Export
   - `/projects/[id]/episodes/[n]` — add DocumentEditor + Import/Export
6. Make stage workflow optional:
   - Add `stageOverride` field to `Project` model
   - Allow manual stage progression
   - Allow skipping stages
7. Update tests

**Verification:**
- User can manually edit Story Bible, Story, Episodes
- User can import content from file
- User can export content
- Stages can be skipped
- Full test suite passes

**Approval gate:** Present editing demo, wait for approval.

---

## Stage 6: Pipeline Simplification

**Goal:** Reduce BullMQ from 21 job types to 8, simplify domain layer

**Tasks:**
1. Audit all 21 job types, identify essential 8:
   - `storyBible`, `story`, `seasonPlan`, `episode` (generation)
   - `audioGenerate`, `render` (production)
   - `cleanup` (maintenance)
2. Update worker code: remove handlers for non-essential jobs
3. Consolidate 5 queues to 3: `generation`, `production`, `maintenance`
4. Simplify domain layer (66 → ~30 files):
   - Remove ASPO domain logic (already done in Stage 3)
   - Remove canon lock/outbox domain logic (already done in Stage 2)
   - Consolidate overlapping utilities
   - Remove unused domain files
5. Update tests: remove tests for retired job types and domain files
6. Update API routes: remove endpoints for retired job types

**Verification:**
- All essential jobs work correctly
- No references to retired job types
- Domain layer is simplified
- Full test suite passes

**Approval gate:** Present simplification results, wait for approval.

---

## Stage 7: Timeline Editor

**Goal:** Add manual timeline editing with drag-and-drop

**Tasks:**
1. Create `TimelineEditor` component:
   - Visual timeline with clips
   - Drag-and-drop clip reordering
   - Clip trimming (start/end adjustment)
   - Audio track management
   - Subtitle editing
2. Create `/projects/[id]/timeline` page
3. Update `Timeline` model:
   - Add editing metadata (clip order, trim points, etc.)
   - Keep backward compatibility with auto-assembled timelines
4. Integrate with FFmpeg render:
   - Export timeline to FFmpeg render job
   - Render uses manual edit data if present, falls back to auto-assembly
5. Add timeline editor tests
6. Update production UI to link to timeline editor

**Verification:**
- User can create and edit timelines manually
- Drag-and-drop works
- Trimming works
- Manual edits are preserved in render
- Full test suite passes

**Approval gate:** Present timeline editor demo, wait for approval.

---

## Stage 8: Media Management Page

**Goal:** Replace `/media` stub with real media management

**Tasks:**
1. Create `/projects/[id]/media` page:
   - List all media assets for project
   - Filter by type (video, audio, image)
   - Preview audio assets
   - Download assets
   - Delete assets
   - Upload external assets
2. Add `isMock` flag to `MediaAsset` schema
3. Migration script: set `isMock=true` for existing mock assets
4. Update media components: filter mock assets in production UI
5. Add media management tests
6. Replace `/characters` stub with character management within project context

**Verification:**
- Media page lists all assets
- Audio preview works
- Upload/download works
- Mock assets are flagged
- Full test suite passes

**Approval gate:** Present media management demo, wait for approval.

---

## Stage 9: Animation (INVESTIGATE)

**Goal:** Determine animation scope and implement if approved

**Tasks:**
1. **Investigation phase:**
   - Clarify animation requirements with user
   - Options: 2D cartoon, motion graphics, Lottie animations, Remotion, SVG animation
   - Assess complexity and value for each option
2. **If approved for implementation:**
   - Install chosen animation library
   - Create animation components
   - Integrate with timeline editor
   - Add animation render support in FFmpeg pipeline
   - Write tests
3. **If not approved:**
   - Document decision to skip animation
   - Move to Stage 10

**Verification:**
- Animation requirements clarified
- If implemented: animation works in timeline and render
- Full test suite passes

**Approval gate:** Present animation investigation/implementation, wait for approval.

---

## Stage 10: Final Cleanup & Documentation

**Goal:** Clean up retired code, update documentation, final verification

**Tasks:**
1. Drop retired MongoDB collections (after final verification):
   - `ContinuityLedger`
   - `NarrativeRegistry`
   - `NarrativeGraph`
   - `CanonLock`
   - `CanonExtractionOutbox`
   - `NarrativeCanon` (data migrated to `Canon`)
   - `CanonFact` (data migrated to `Canon`)
   - `NarrativeRegistry` (data migrated to `CanonicalEntity`)
   - `CanonicalRegistry` (data migrated to `CanonicalEntity`)
2. Remove backup files (after user confirmation)
3. Update documentation:
   - `AGENTS.md` — update for new architecture
   - `README.md` — update for new features
   - `docs/` — update all docs
   - `docs/TESTING.md` — update test documentation
   - `.env.example` — finalize
4. Create `docs/MCP_INTEGRATION.md` — MCP setup guide
5. Final test suite run
6. Final type check
7. Final lint
8. Create git tag `post-restructure-complete`

**Verification:**
- All retired collections dropped
- All documentation updated
- Full test suite passes
- Type check passes
- Lint passes
- Application starts and all features work

**Approval gate:** Present final summary, project complete.

---

## Stage Summary

| Stage | Goal | Risk | Estimated Changes |
|-------|------|------|-------------------|
| 0 | Forensic audit | None (read-only) | 6 documents ✅ |
| 1 | Pre-migration & backup | Low | Backup scripts |
| 2 | Canon simplification | **High** | ~1,500 lines removed, migration script |
| 3 | LLM provider simplification | Medium | ~3,900 lines removed |
| 4 | MCP server | Low | ~1,500 lines added |
| 5 | Document editing & import | Low | ~1,800 lines added |
| 6 | Pipeline simplification | Medium | ~5,300 lines removed |
| 7 | Timeline editor | Low | ~1,000 lines added |
| 8 | Media management | Low | ~800 lines added |
| 9 | Animation | Investigate | TBD |
| 10 | Final cleanup | Low | Documentation updates |

**Net code change:** ~-9,100 lines (10% reduction)

---

## Rollback Plan

At any stage, if something goes wrong:
1. `git reset --hard pre-restructure-backup`
2. Restore MongoDB from backup
3. Restore `.env` from `backups/env.backup`
4. Restart workers
5. Verify application functionality

**Rollback is available until Stage 10** (after Stage 10, backups are removed with user confirmation).