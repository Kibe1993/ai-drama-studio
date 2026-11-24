# Production Pipeline Implementation Plan

> Ordered implementation phases, dependencies, preservation requirements, migrations, testing, and acceptance criteria for the 13-stage production pipeline redesign.

## 1. Implementation Principles

1. **Never break existing tests** — all 1535 passing tests must continue to pass after each phase.
2. **Incremental delivery** — each phase produces a working system. No big-bang rewrites.
3. **Backend before UI** — data models and services first, then MCP tools, then UI.
4. **Preserve existing infrastructure** — Clerk auth, MongoDB, Redis/BullMQ, LLM orchestration, MCP server, all 23 repositories.
5. **CSS Modules for new UI** — no Tailwind for new components. Existing Tailwind components remain until migrated.
6. **Strict TypeScript** — no `any` types. All new code must pass `npm run typecheck`.
7. **Test coverage** — every new service method, repository function, and API route must have tests. Target ≥90% line coverage for new code.

---

## 2. Phase Ordering

### Phase 1 — Bug Fixes & Foundation (No new features)
**Goal**: Fix broken functionality and lay groundwork for new stages.
**Dependencies**: None.
**Risk**: Low — fixes only.

### Phase 2 — Missing Backend Stages
**Goal**: Add backend for Stage 2 (Creative Planning) and Stage 9 (Production Design).
**Dependencies**: Phase 1.
**Risk**: Medium — new collections, services, MCP tools.

### Phase 3 — UI for Existing Backend
**Goal**: Build dedicated UI pages for characters, locations, scenes, and canon — backend already exists.
**Dependencies**: Phase 1.
**Risk**: Low — UI only, backend already tested.

### Phase 4 — UI for New Backend
**Goal**: Build UI for Stage 2 (Creative Planning) and Stage 9 (Production Design).
**Dependencies**: Phase 2, Phase 3.
**Risk**: Medium — new UI patterns.

### Phase 5 — Pipeline Expansion
**Goal**: Expand the 6-stage pipeline to 13 stages. Update workflow service, stage layout, navigation.
**Dependencies**: Phase 2, Phase 3, Phase 4.
**Risk**: High — touches core pipeline orchestration.

### Phase 6 — MCP Expansion
**Goal**: Add MCP tools for new stages. Persist activity log. Track assistant identity.
**Dependencies**: Phase 2, Phase 5.
**Risk**: Medium — MCP tool additions, new collection.

### Phase 7 — UI Polish & Interaction Completeness
**Goal**: Every visible element has a meaningful action. Fix manual ID entry. Add contextual navigation. Timeline visual editor. Version comparison.
**Dependencies**: Phase 3, Phase 4, Phase 5.
**Risk**: Medium — many small UI improvements.

### Phase 8 — Video & Render (Future)
**Goal**: Replace mock video generation and render engines with real providers.
**Dependencies**: All previous phases.
**Risk**: High — external provider integration.
**Note**: Deferred until providers are available. Mock engines remain clearly labeled.

---

## 3. Detailed Phase Breakdown

### Phase 1 — Bug Fixes & Foundation

| Task | Files | Description | Test |
|------|-------|-------------|------|
| Fix `ProductionScene.approvedAt` | `lib/repositories/productionSceneRepository.ts` | Set `approvedAt` in `approveShotPlan` | Unit test: verify `approvedAt` is set |
| Fix story import handler | `app/(studio)/projects/[projectId]/story/page.tsx` | Implement JSON/text import (not no-op) | E2E: import a story JSON |
| Fix episode import handler | `app/(studio)/projects/[projectId]/episodes/page.tsx` | Implement JSON import (not no-op) | E2E: import an episode JSON |
| Remove dead `DocumentEditor` | `components/editor/DocumentEditor.tsx` | Delete unused Tiptap component | Verify no imports break |
| Add `planningDocs` collection | `lib/domain/models/PlanningDocument.ts` | New model for creative planning | Model validation test |
| Add `activityLog` collection | `lib/domain/models/ActivityLog.ts` | New model for persisted activity | Model validation test |
| Add Fountain/FDX export | `lib/services/exportService.ts` | Screenplay export to Fountain format | Unit test: export format |

**Acceptance criteria**:
- `ProductionScene.approvedAt` is set on shot plan approval
- Story and episode import works
- New MongoDB collections created with proper indexes
- All 1535 existing tests still pass
- `npm run typecheck` passes

---

### Phase 2 — Missing Backend Stages

#### Stage 2: Creative Planning

| Task | Files | Description |
|------|-------|-------------|
| Planning repository | `lib/repositories/planningRepository.ts` | CRUD for planning documents |
| Planning service | `lib/services/planningService.ts` | Business logic, validation, approval |
| Planning validation | `lib/validation/planningSchema.ts` | Zod schema for planning docs |
| Planning generation | `lib/services/planningGenerationService.ts` | LLM-based concept generation |
| API routes | `app/api/projects/[projectId]/planning/route.ts` | GET/POST/PATCH |
| API approval | `app/api/projects/[projectId]/planning/approve/route.ts` | POST |

**Planning document fields**:
```
{
  projectId, version, status,
  concept: { logline, synopsis, elevatorPitch },
  themes: [string],
  centralQuestion: string,
  mainConflict: string,
  audience: { demographic, tone, contentRating },
  narrativeDirection: { structure, pov, pacing },
  alternativeDirections: [{ description, pros, cons, selected }],
  references: [{ title, type, relevance }]
}
```

#### Stage 9: Production Design

| Task | Files | Description |
|------|-------|-------------|
| Production design repository | `lib/repositories/productionDesignRepository.ts` | CRUD for shot lists, camera, lighting |
| Production design service | `lib/services/productionDesignService.ts` | Business logic, AI generation |
| Shot list generation | `lib/services/shotListGenerationService.ts` | LLM-based shot list from scene + screenplay |
| API routes | `app/api/projects/[projectId]/production-design/route.ts` | GET/POST/PATCH |
| API per-scene | `app/api/projects/[projectId]/production-design/[sceneId]/route.ts` | Per-scene design |

**Production design fields**:
```
{
  projectId, sceneId, version, status,
  shotList: [{
    shotNumber, type (wide/medium/close/establishment),
    cameraDirection, cameraMovement,
    lens, framing, duration,
    lightingSetup, lightingNotes,
    storyboardDescription,
    visualContinuityNotes
  }],
  locationDesign: { dressing, props, atmosphere },
  characterStaging: [{ characterId, position, action }]
}
```

**Acceptance criteria**:
- Planning documents can be created, validated, approved, and versioned
- Production design can be generated from approved scenes
- Shot lists include camera, lighting, and storyboard descriptions
- All new services have ≥90% test coverage
- `npm run typecheck` passes

---

### Phase 3 — UI for Existing Backend

| Task | Route | Description |
|------|-------|-------------|
| Characters page | `/projects/[id]/characters` | List, filter, detail, relationship graph, voice profile |
| Locations page | `/projects/[id]/locations` | List, filter, detail, geographic/atmosphere fields |
| Scenes page | `/projects/[id]/scenes` | List, reorder, detail, shot plan, navigation to screenplay |
| Canon page | `/projects/[id]/canon` | Facts list, contradictions, sources, resolution workflow |
| Voice profiles page | `/projects/[id]/voices` | List, create, assign to characters |
| Fix manual ID entry | Multiple pages | Replace ID input fields with contextual selectors |

**Each page includes**:
- Empty state (no data yet)
- Loading state (skeleton)
- Error state (retry button)
- Approval state (pending review banner)
- Filter/search
- Pagination (where applicable)
- CSS Modules styling

**Acceptance criteria**:
- Characters, locations, scenes, canon, voice profiles have dedicated pages
- No page requires manual ID entry — all navigation is contextual
- Each page has empty/loading/error/approval states
- All pages use CSS Modules
- `npm run typecheck` passes

---

### Phase 4 — UI for New Backend

| Task | Route | Description |
|------|-------|-------------|
| Creative planning page | `/projects/[id]/planning` | Concept editor, themes, audience, narrative direction, alternatives |
| Production design page | `/projects/[id]/production-design` | Shot list editor, camera/lighting, storyboard, per-scene view |
| Planning review | Component | Approval interface for planning documents |
| Production design review | Component | Approval interface for shot lists |

**Acceptance criteria**:
- Planning page allows concept development with AI assistance
- Production design page shows shot lists per scene with camera/lighting
- Both pages have approval workflows
- CSS Modules styling
- `npm run typecheck` passes

---

### Phase 5 — Pipeline Expansion

| Task | Files | Description |
|------|-------|-------------|
| Expand pipeline stages | `lib/services/pipelineService.ts` | 6 → 13 stages |
| Update workflow service | `lib/services/workflowService.ts` | 13-stage status, gates, blocking reasons |
| Update stage layout | `components/workflow/StageLayout.tsx` | 13-stage awareness |
| Update workflow stepper | `components/workflow/WorkflowStepper.tsx` | 13-step visual |
| Update project model | `lib/domain/models/Project.ts` | Add `currentStage` (1-13) |
| Migration script | `scripts/migrate-pipeline-stages.ts` | Map old 6-stage to new 13-stage |
| Fix workflow guard bypass | 8 pages | All pages go through StageLayout |

**Stage mapping (old → new)**:
```
story        → stages 1-4 (init, planning, bible, season)
characters   → stage 5 (characters/locations)
scenes       → stage 6 (scene breakdown)
media        → stages 9-11 (design, audio, video)
render       → stages 12-13 (timeline, render)
done         → stage 13 complete
```

**Acceptance criteria**:
- Pipeline tracks 13 stages with proper gates
- Old projects migrate correctly to new stage numbering
- All 14 project pages go through StageLayout
- Workflow stepper shows 13 steps grouped in 4 phases
- All existing tests pass (updated for new stage names)
- `npm run typecheck` passes

---

### Phase 6 — MCP Expansion

| Task | Files | Description |
|------|-------|-------------|
| Planning MCP tools | `lib/mcp/tools/planning.ts` | `planning.get`, `planning.update`, `planning.approve` |
| Production design MCP tools | `lib/mcp/tools/productionDesign.ts` | `productionDesign.get`, `productionDesign.update`, `productionDesign.generateShotList` |
| Voice assignment MCP tool | `lib/mcp/tools/voice.ts` | `voice.assign` |
| Persist activity log | `lib/repositories/activityLogRepository.ts` | MongoDB-backed activity log |
| Track assistant identity | `lib/mcp/server.ts` | Extract assistant name from session metadata |
| Activity log UI filter | `app/(studio)/mcp/page.tsx` | Per-project activity filtering |
| Update `project.context` | `lib/mcp/tools/project.ts` | Include planning + production design in context |

**New MCP tools** (7 new, total 49):
| Tool | Purpose |
|------|---------|
| `planning.get` | Read creative planning document |
| `planning.update` | Propose planning changes |
| `planning.approve` | Approve planning document |
| `productionDesign.get` | Read production design for a scene |
| `productionDesign.update` | Propose production design changes |
| `productionDesign.generateShotList` | AI-generate shot list from scene |
| `voice.assign` | Assign voice profile to character |

**Acceptance criteria**:
- 49 MCP tools total (42 existing + 7 new)
- Activity log persists to MongoDB, survives restart
- Assistant name is tracked in activity log
- `project.context` includes planning and production design
- MCP server tests pass
- `npm run typecheck` passes

---

### Phase 7 — UI Polish & Interaction Completeness

| Task | Description |
|------|-------------|
| Timeline visual editor | Replace form-row clips with time-axis positioned clips, playhead, multi-track sync |
| Version comparison UI | Side-by-side diff for bible/season plan versions |
| Version restore UI | Restore previous document version |
| Conflict resolution UI | Browse canon contradictions, understand sources, resolve |
| Project activity history | General activity log (not just MCP) — who did what, when |
| Dashboard enrichment | Stage progress, recent activity, quick actions for all 13 stages |
| Navigation grouping | Group 15 workspace sections logically (Creative, Structural, Production, Output) |
| Responsive behavior | All pages work on tablet (768px+) and desktop |
| Keyboard shortcuts | Common actions have keyboard shortcuts |
| Toast notifications | All async operations show success/error toasts |

**Acceptance criteria**:
- Every visible interactive element has a meaningful action (no dead buttons)
- Timeline editor shows visual time-axis with positioned clips
- Document versions can be compared and restored
- Canon contradictions have a dedicated resolution workflow
- Dashboard shows 13-stage progress
- All pages are responsive
- `npm run typecheck` passes

---

### Phase 8 — Video & Render (Future)

| Task | Description |
|------|-------------|
| Video provider abstraction | `lib/providers/videoProvider.ts` interface |
| Real video generation | Replace mock `video.scene` engine |
| Real final render | Replace mock `render.final` engine |
| Render configuration UI | Resolution, frame rate, codec, audio mix settings |
| Render history | Job history with retry, download, compare |

**Note**: This phase is deferred until video generation providers are available. Mock engines remain clearly labeled with `isMock` flag. No false completion.

---

## 4. Required Migrations

### MongoDB Migrations

| Migration | Phase | Description |
|-----------|-------|-------------|
| `planningdocs` collection | Phase 1 | New collection for creative planning |
| `activitylog` collection | Phase 1 | New collection for persisted activity |
| `productiondesigns` collection | Phase 2 | New collection for production design |
| Project `currentStage` field | Phase 5 | Add 1-13 stage tracking |
| Project stage mapping | Phase 5 | Map old 6-stage to new 13-stage |
| `ProductionScene.approvedAt` fix | Phase 1 | Backfill: set `approvedAt` where shot plan exists |

### Migration Strategy
- All migrations are **additive** (new collections, new fields) except the stage mapping
- Stage mapping migration: read old `currentStage`, map to new stage, write new `currentStage`
- Migrations run via `scripts/migrate-*.ts` with dry-run support
- No destructive migrations — old fields are kept for rollback

---

## 5. Testing Strategy

### Test Layers

| Layer | Framework | Coverage Target | What |
|-------|-----------|----------------|------|
| Unit | Vitest | ≥90% lines | Services, repositories, validation, utilities |
| Integration | Vitest | ≥80% lines | API routes with real MongoDB (test URI) |
| Component | Vitest + Testing Library | ≥80% lines | React components, user interactions |
| E2E | Vitest | Critical paths | Full pipeline: create → plan → bible → ... → render |
| MCP | Vitest | ≥90% lines | MCP tool contracts, approval gates, error handling |

### Test Requirements per Phase

| Phase | New Tests | Modified Tests |
|-------|-----------|----------------|
| 1 | ~50 (bug fixes, new models) | ~20 (shot plan, import) |
| 2 | ~100 (planning, production design) | ~10 (pipeline service) |
| 3 | ~80 (5 new pages) | ~5 (navigation) |
| 4 | ~60 (2 new pages) | ~5 (pipeline) |
| 5 | ~40 (pipeline expansion) | ~50 (stage names, gates) |
| 6 | ~70 (7 new MCP tools, activity log) | ~20 (MCP server, context) |
| 7 | ~100 (UI polish) | ~30 (existing components) |
| 8 | ~40 (video/render) | ~10 (mock → real) |

### Pre-existing Test Failures to Fix
- `tests/kokoro-e2e-pipeline.test.ts` — make MongoDB URI optional or use test container
- `tests/audio-worker-module-boundary.test.ts` — increase timeout or fix flakiness
- `scripts/drain-queues.ts` — fix typecheck errors
- `scripts/export-backup.ts` — fix typecheck errors

---

## 6. Acceptance Criteria (Overall)

### Must Pass
- [ ] All 1535 existing tests pass (updated for new stage names where needed)
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] No TypeScript `any` types in new code
- [ ] All new UI uses CSS Modules
- [ ] All new API routes validate with Zod
- [ ] All new services enforce stage gates
- [ ] All new MCP tools require approval for writes
- [ ] Activity log persists to MongoDB

### Must Not Break
- [ ] Clerk authentication works
- [ ] All 23 repositories function correctly
- [ ] Redis/BullMQ job system works
- [ ] LLM provider orchestration works
- [ ] MCP server (42 existing tools) works
- [ ] Canon authority and approval workflows work
- [ ] Story Bible generation works
- [ ] Season Plan validation works
- [ ] Timeline editor works
- [ ] Media gallery works
- [ ] Audio TTS works

### Must Implement
- [ ] 13-stage pipeline (up from 6)
- [ ] Creative Planning stage (Stage 2)
- [ ] Production Design stage (Stage 9)
- [ ] Dedicated pages for characters, locations, scenes, canon, voices
- [ ] Visual timeline editor
- [ ] Version comparison and restore
- [ ] Canon conflict resolution UI
- [ ] Persisted activity log with assistant identity
- [ ] 7 new MCP tools (49 total)
- [ ] No manual ID entry anywhere
- [ ] Every interactive element has a meaningful action

---

## 7. Dependency Graph

```
Phase 1 (Bug Fixes)
  ├── Phase 2 (Backend: Planning + Production Design)
  │    └── Phase 4 (UI: Planning + Production Design)
  ├── Phase 3 (UI: Characters + Locations + Scenes + Canon)
  └── Phase 5 (Pipeline Expansion)
       └── Phase 6 (MCP Expansion)
            └── Phase 7 (UI Polish)
                 └── Phase 8 (Video & Render)
```

**Parallelizable**: Phases 2 and 3 can run in parallel (both depend only on Phase 1).
**Sequential**: Phase 5 requires Phase 2 (new stages need backend). Phase 6 requires Phase 5 (MCP tools for new stages). Phase 7 requires Phases 3, 4, 5 (UI for all stages).

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Pipeline expansion breaks existing projects | Migration script with dry-run, stage mapping, rollback |
| New collections affect performance | Indexes on `projectId`, `version`, `status` from day one |
| MCP tool explosion (42 → 49) | Tool categories, lazy loading, pagination in `tools/list` |
| UI rewrite causes regressions | Component tests first, visual regression snapshots, gradual migration |
| Activity log grows unbounded | TTL index (90-day retention), aggregation for old entries |
| LLM cost from new generation services | Cost guard service (already exists), per-stage budgets |
| Canon conflicts from multi-assistant | Optimistic locking (already exists), conflict detection (already exists) |