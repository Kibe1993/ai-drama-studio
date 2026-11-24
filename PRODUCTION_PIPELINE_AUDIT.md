# Production Pipeline Audit

> Phase 0 audit of AI Drama Studio's existing functionality, partial implementations, missing features, mock-only systems, and broken/unreliable behavior.

## Audit Methodology

Inspected: all 14 project workspace pages, 30 component files, 10 hooks, 60 API route files, 23 repositories, 26 services, MCP server (42 tools, 9 resources), background job system (3 queues, 20 job types), domain models, validation schemas, and existing test suite (91 test files, 1535 passing tests).

---

## 1. Existing Functionality (Verified Working)

### Project Management
- **Create/Read/Update/Delete**: Full CRUD via `projectService` + `projectRepository`. Projects have title, genre, language, visualStyle, tone, targetDurationSeconds, aspectRatio, productionType, productionMode, status, workflowMode.
- **Archive/Restore/Duplicate**: Working via `projectService` methods + API routes.
- **Ownership**: All queries scoped by `clerkUserId`. Auth via Clerk.
- **Idempotency**: Create supports idempotency keys to prevent duplicates.

### Story Bible
- **AI Generation**: 6-section generation (identity, world, characters, narrative, guidelines, canon) via `storyBibleGenerationService`. Sequential LLM with section-by-section progress.
- **Manual Editing**: Legacy 5-field editor (premise, worldRules, themes, boundaries, canonFacts).
- **Save/Approve**: Version-tracked approval with optimistic locking (`expectedVersion`/`expectedDraftRevision`).
- **Regeneration**: Full regenerate, focused revision, per-section regeneration.
- **Read/Export**: JSON and Markdown export.

### Story Draft
- **AI Generation**: 6 sequential parts (opening, inciting incident, investigation, escalation, climax, resolution) with per-part persistence, resume, and cancellation.
- **Validation**: Canon validation + scene repair with actionable findings (blocking/warning/info). Per-finding resolution (accept as intentional, request targeted revision, mark resolved).
- **Approval**: Blocked when blocking validation findings exist. Approve advances to season plan.
- **Revalidation**: Re-run validation without regenerating.

### Season Plan
- **AI Generation**: Full season plan with episode outlines, arcs, developments, revelations, relationships, consequences, setup/payoff tracking.
- **Manual Editing**: Full editable form (8 scalar fields, 6 list fields, per-episode editing with character arc/relationship/object/location change parsers).
- **Validation**: Structural validator, climax validator, progression validator, setup-payoff validator, canon validator, character state validator, temporal validator.
- **Repair**: Automated repair engine with revision planner and impact analyzer.
- **Approval**: Version-tracked with revision history and review status.
- **Version History**: Full version listing with revision review.

### Episodes
- **Create**: Manual creation (title, premise, duration).
- **AI Generate**: Episode suggestion generation.
- **List/Status**: Episode list with status, timeline, render info.
- **Serialized Locking**: Plan approval, prior episode approval, plan review enforcement.
- **Canon Extraction**: Automated canon extraction from approved episodes with issue tracking.

### Production Pipeline
- **6 Run-Scoped Stages**: story → characters → scenes → media → render → done.
- **Guided/Automatic Modes**: Guided requires explicit approval at each gate. Automatic advances automatically.
- **Cancel/Retry**: Pipeline cancellation and per-scene retry.
- **Workflow State**: `workflowService` provides stage/step status with blocking reasons.

### Screenplay Editor
- **Per-Scene Editing**: Heading, location, time of day, characters, visual description, action, dialogue.
- **Save + Revalidate**: Saving patches story and re-runs canon validation.
- **Guard**: Only editable when story status is `awaiting_approval`.

### Timeline Editor
- **Drag-and-Drop Reordering**: `@dnd-kit` with pointer + keyboard sensors.
- **6 Track Kinds**: video, dialogue, narration, music, sfx, subtitle.
- **Clip Trimming**: Numeric inputs for start/duration.
- **Volume Control**: Per-clip volume.
- **Transitions**: Crossfade, wipe left/right, slide up/down (FFmpeg xfade).
- **Save/Approve**: Save tracks, approve timeline (blocked by validation errors).
- **Validation**: Missing assets, broken references, overlaps, duration mismatch.

### Media Gallery
- **Filtering**: By type (9 types), review status, mock/real.
- **Pagination**: 24 per page.
- **Audio Preview**: HTMLAudioElement streaming.
- **Image Thumbnails**: Lazy-loaded.
- **Download/Delete**: With two-step delete confirmation.

### Audio Production (TTS)
- **Kokoro TTS**: Real TTS generation via Kokoro.
- **3-Step Wizard**: Prerequisites → Generate → Review.
- **Segment Polling**: 3s interval progress.
- **Playback**: HTMLAudioElement per segment.
- **Retry**: Failed segment retry.
- **Voice Profiles**: Creation, approval, assignment.

### Visual Assets
- **Entity Management**: Characters, environments, objects with reference assets.
- **Reference Review**: Approve/reject reference assets.
- **Object Creation**: Create object entities.

### Rendering
- **Job Management**: Trigger render, poll status, cancel, download.
- **Presets**: Vertical (9:16), landscape (16:9), square (1:1).
- **FFmpeg**: Real FFmpeg-based rendering with transitions, subtitles, audio mix.

### MCP Server
- **42 Tools**: Full production pipeline coverage (project, document, canon, media, render, pipeline, entity, episode, scene, seasonPlan, timeline, approval, context, activity).
- **9 Resources**: Structured read access to bible, story, episodes, canon, assets, timeline, characters, scenes, season-plan.
- **HTTP Transport**: `WebStandardStreamableHTTPServerTransport` with per-user server pool.
- **Stdio Transport**: Local development via `npm run mcp:server`.
- **Auth**: Clerk session or Bearer token.
- **Service-Layer Routing**: All tools go through services, enforcing approval workflows.
- **Activity Tracking**: In-memory activity log.

### Canon System
- **Append-Only Fact Log**: `canonStore` with sequence tracking.
- **Versioned Snapshots**: `narrativeCanonRepository` with version history.
- **CASNA**: 9-stage canon-aware algorithm for narrative development.
- **Continuity Ledger**: Append-only, tracks events, character states, locations, objects, secrets, threads, consequences.
- **Canon Extraction**: Automated extraction from approved episodes with issue tracking and resolution.
- **Bridge**: `derivedToCanonState` converts derived state to canonical snapshots.

### LLM Provider Orchestration
- **ASPO Failover**: Sequential provider failover with cooldowns and budget calculation.
- **Providers**: Groq, OpenRouter, Mistral, Anthropic, OpenAI, Gemini, Ollama, LM Studio.
- **Normalization**: Response normalization and truncation detection.

---

## 2. Partial Functionality

### Character Management
- **Existing**: `canonicalEntityRepository` supports create, list, find, approve, updateVisualProfile, setDefaultReference. `visualAssetService` handles reference management.
- **Missing**: No dedicated character list/detail UI page. Characters are only visible within the production panel and visual-assets page. No relationship management UI. No voice profile management UI (API exists but no UI).
- **Assessment**: Backend is substantially built; UI is scattered and incomplete.

### Location Management
- **Existing**: Locations are canonical entities with `entityType: "location"`. Same repository support as characters.
- **Missing**: No dedicated location management UI. No geographic context, architecture, interior/exterior, atmosphere, lighting fields in the UI.
- **Assessment**: Backend supports it; UI doesn't expose it properly.

### Scene Management
- **Existing**: `productionSceneRepository` with listForRun, findById, updateOwned, approveShotPlan. `productionSceneService` with list/update. `ScenePlanner` component with shot plan editing.
- **Missing**: No dedicated scene list/detail page. Scenes are only visible within the production panel. No scene reordering UI. No scene-to-screenplay navigation.
- **Assessment**: Backend is built; UI is embedded in production panel, not standalone.

### Shot Production
- **Existing**: `shotProductionRepository` + `shotProductionService` with full lifecycle (create, verify gates, approve plan, mark in-progress/completed/failed). `/shots` page with generation and retry.
- **Missing**: No shot plan generation engine (must be manually entered). `ProductionScene.approvedAt` bug blocks the shot production gate.
- **Assessment**: Backend infrastructure exists but gate is broken and no AI generation.

### Timeline Editor
- **Existing**: Full drag-and-drop, trimming, transitions, save/approve.
- **Missing**: No visual time-axis strip (clips are form rows, not positioned on a timeline). No multi-track sync preview or playback. No playhead. No visual waveform.
- **Assessment**: Functional but lacks the visual editing experience expected of a timeline editor.

### Import/Export
- **Existing**: `ImportDialog` and `ExportDialog` components. Bible import works (JSON/text). Export works (JSON/Markdown).
- **Missing**: Story and episode import handlers are no-op stubs (`setShowImport(false)`). No screenplay import/export in standard formats (Fountain, FDX).
- **Assessment**: Import is partially stubbed; export works for bible only.

### MCP Activity Tracking
- **Existing**: In-memory activity log with `activity.list` tool and `/api/mcp/activity` endpoint. UI panel on MCP page.
- **Missing**: Not persisted to MongoDB. Lost on server restart. No per-project filtering in UI. No assistant name tracking (always null).
- **Assessment**: Works but ephemeral; needs persistence for production use.

---

## 3. Missing Functionality

### Creative Planning (Stage 2)
- No dedicated planning documents. No concept development, alternative story directions, themes, central questions, audience, or main conflict storage.
- **Gap**: The jump from project creation to Story Bible has no intermediate planning step.

### World Development (Stage 5)
- No world-specific fields beyond Story Bible sections. No historical period, cultural context, technology, social structures, or world rules as separate entities.
- **Gap**: World information is embedded in the Story Bible but not structured for MCP retrieval or canonical reference.

### Production Design (Stage 9)
- No shot list generation. No camera direction templates. No lighting plan management. No storyboard descriptions. No visual continuity requirements tracking.
- **Gap**: `ScenePlanner` has shot plan fields but no AI generation or structured workflow.

### Video Production (Stage 11)
- No real video generation. `video.scene` and `render.final` are mock-only. No shot-level footage management. No animation workspace.
- **Gap**: The entire video generation pipeline is mock-only.

### Rendering Configuration (Stage 13)
- No resolution, frame rate, or audio configuration UI. Only preset selection (vertical/landscape/square).
- **Gap**: Render configuration is minimal; no advanced settings.

### Document Versioning
- Story Bible has version tracking. Season plan has version history. But no general document version comparison UI. No restore previous version UI.
- **Gap**: Versioning exists in the backend but the UI doesn't expose comparison or restore.

### Conflict Detection
- Canon validation detects contradictions. But no UI for browsing contradictions, understanding sources, or resolving them systematically.
- **Gap**: Conflicts are surfaced as validation findings but not as a dedicated workflow.

### Project Activity History
- MCP activity log exists but no general project activity history (who did what, when, across all stages).
- **Gap**: No audit trail for manual operations (only MCP operations are logged).

---

## 4. Mock-Only Functionality

### Video Generation (`video.scene`)
- Mock engine returns mock assets. UI correctly labels as MOCK.
- **Impact**: No real video can be generated. The entire video production stage is mock.

### Final Render (`render.final`)
- Mock engine creates job records but doesn't produce real output.
- **Impact**: Render jobs can be created but produce no actual video files.
- **Note**: FFmpeg-based rendering IS real for timeline composition, but the final output encoding may still be mock depending on configuration.

### Image Generation
- No image generation engine. Visual references must be uploaded manually.
- **Impact**: No AI-generated character/location references.

---

## 5. Broken or Unreliable Functionality

### `ProductionScene.approvedAt` Bug
- `approveShotPlan` sets the shot plan but `approvedAt` is never set, breaking the shot production gate.
- **Impact**: Shot production cannot proceed even after shot plan approval.
- **File**: `lib/repositories/productionSceneRepository.ts`

### Import Handlers
- Story page import: `setShowImport(false)` — no-op.
- Episodes page import: `setShowImport(false)` — no-op.
- **Impact**: Import buttons appear functional but do nothing.

### Manual ID Entry
- Pages `assembly`, `audio`, `rendering`, `shots`, `visual-assets` require manual entry of episode IDs, sceneIDs, timelineIDs.
- **Impact**: Poor UX; users must copy IDs from other pages rather than navigating contextually.

### `DocumentEditor` Unused
- Tiptap-based `DocumentEditor` component (147 lines) exists but is not imported by any page.
- **Impact**: Dead code; no rich text editing for planning documents.

### Workflow Guard Bypass
- 8 of 14 project pages bypass `StageLayout` (timeline, media, assembly, audio, rendering, shots, video, visual-assets).
- **Impact**: Users can access production stages out of workflow order, which may cause confusion or errors if prerequisites aren't met.

### Pre-existing Test Failures
- `tests/kokoro-e2e-pipeline.test.ts` — requires `MONGODB_URI` env var.
- `tests/audio-worker-module-boundary.test.ts` — flaky 5s timeout.
- `scripts/drain-queues.ts` and `scripts/export-backup.ts` — pre-existing typecheck errors.
- **Impact**: Not blocking but indicates technical debt.

---

## 6. Summary Matrix

| Stage | Backend | UI | MCP | Status |
|-------|---------|-----|-----|--------|
| 1. Project Init | ✅ Complete | ✅ Complete | ✅ Complete | **Working** |
| 2. Creative Planning | ❌ Missing | ❌ Missing | ❌ Missing | **Not started** |
| 3. Story Bible | ✅ Complete | ✅ Complete | ✅ Complete | **Working** |
| 4. Season/Episode | ✅ Complete | ✅ Complete | ✅ Complete | **Working** |
| 5. Characters/Locations | ⚠️ Partial | ⚠️ Partial | ✅ Complete | **Partial** |
| 6. Scene Planning | ⚠️ Partial | ⚠️ Partial | ✅ Complete | **Partial** |
| 7. Screenplay | ✅ Complete | ✅ Complete | ✅ Complete | **Working** |
| 8. Canon/Continuity | ✅ Complete | ⚠️ Partial | ✅ Complete | **Working** (UI gaps) |
| 9. Production Design | ⚠️ Partial | ⚠️ Partial | ❌ Missing | **Partial** |
| 10. Audio Production | ✅ Complete | ✅ Complete | ⚠️ Stub | **Working** (MCP stub) |
| 11. Video/Animation | ❌ Mock | ⚠️ Partial | ❌ Missing | **Mock only** |
| 12. Timeline/Editing | ✅ Complete | ⚠️ Partial | ✅ Complete | **Working** (UI gaps) |
| 13. Rendering | ⚠️ Partial | ⚠️ Partial | ✅ Complete | **Partial** |

---

## 7. Existing Infrastructure to Preserve

### Must Not Break
- Clerk authentication and project ownership
- MongoDB connection and all 23 repositories
- Redis/BullMQ background job system (3 queues)
- LLM provider orchestration (ASPO failover)
- Canon authority and approval workflows
- Story Bible generation and approval
- Story Draft sequential generation (6 parts)
- Season Plan validation and repair
- Timeline editor drag-and-drop and transitions
- Media gallery filtering and pagination
- Audio TTS production (Kokoro)
- MCP server (42 tools, 9 resources, HTTP + stdio)
- All 1535 passing tests

### Can Be Extended
- Project model (add planning fields)
- Canonical entity model (add world fields)
- Production scene model (fix approvedAt bug)
- MCP server (add production design tools)
- UI components (add dedicated pages for characters, locations, scenes, canon)

### Should Be Replaced
- In-memory activity log → MongoDB-persisted
- No-op import handlers → real import logic
- Manual ID entry → contextual navigation
- Mock video/render engines → real providers (when available)