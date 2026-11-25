# Full Pipeline Audit Report

**Date:** 2026-11-25  
**Commit:** `b126b6d` (Phase 1 integration foundation)  
**Test status:** 1535 passing, 6 skipped, 1 failing (kokoro e2e needs MongoDB URI)

---

## Executive Summary

AI Drama Studio is a **substantially complete system** with a well-architected modular monolith. The core creative pipeline (Story → Characters → Scenes → Media → Render) is fully implemented with proper approval gates at every stage. The LLM provider system with failover is robust. The canon/continuity system (CASNA) is extensive and deeply integrated.

The main gaps are in **media generation** (image/video are mock-only), **external tool integration** (infrastructure built but no providers registered), **cloud storage** (only local), and some **pipeline job handlers** (18 of 31 job types not directly handled).

---

## 1. Story Engine — ✅ FULLY IMPLEMENTED

| Component | Status | Files |
|-----------|--------|-------|
| 6-part sequential story draft generation | ✅ Complete | `lib/pipeline/storyDraftEngine.ts` (644 lines) |
| 6-section story bible generation | ✅ Complete | `lib/pipeline/storyBibleEngine.ts` (252 lines) |
| Story versioning | ✅ Complete | `storyRepository.ts` — version auto-incremented |
| Screenplay editing | ✅ Complete | `ScreenplayEditor.tsx` (223 lines) |
| Story approval with CASNA canon commit | ✅ Complete | `pipelineService.ts` |
| Story review display | ✅ Complete | `StoryReview.tsx` (107 lines) |
| Import/export (JSON + Markdown) | ✅ Complete | `storyBibleExport.ts`, `storyBibleImport.ts` |
| Story Draft Workspace | ✅ Complete | `StoryDraftWorkspace.tsx` (327 lines) |
| Story Bible Editor | ✅ Complete | 512 lines, 6-section editing |
| Fountain/Final Draft/PDF import | ❌ Not started | — |

---

## 2. Character Engine — ✅ FULLY IMPLEMENTED

| Component | Status | Files |
|-----------|--------|-------|
| Character extraction via LLM | ✅ Complete | `liveEngines.ts` |
| Canonical entities (character/location/object) | ✅ Complete | `canonicalEntityRepository.ts` |
| Entity approval | ✅ Complete | `visualAssetService.approveEntity` |
| Object creation | ✅ Complete | `visualAssetService.createObjectProfile` |
| Visual asset reference management | ✅ Complete | `visualAssetService.ts` (146 lines) |
| Voice assignment service | ✅ Complete | `voiceAssignmentService.ts` (107 lines) |
| Voice profiles with approval | ✅ Complete | `voiceProfileRepository.ts` |
| Character relationships via continuity events | ✅ Complete | `continuityRepository.ts` |
| Characters page | ✅ Complete | 187 lines, tabs, search, approve |
| Relationship graph editor | ⚠️ Partial | Implicit through canon facts, no explicit UI |
| Character arc visualization | ❌ Not started | — |

---

## 3. Scene Engine — ✅ FULLY IMPLEMENTED

| Component | Status | Files |
|-----------|--------|-------|
| Scene breakdown via LLM | ✅ Complete | `liveEngines.ts` |
| Scene editing before approval | ✅ Complete | `productionSceneService.ts` |
| Scene approval | ✅ Complete | Individual scene approve button |
| Shot plans with framing/camera/duration | ✅ Complete | Displayed in scene detail |
| Shot production service | ✅ Complete | `shotProductionService.ts` (174 lines) |
| Production design service | ✅ Complete | `productionDesignService.ts` (54 lines) |
| Production design page | ✅ Complete | 185 lines, shot list table editing |
| Scenes page | ✅ Complete | 278 lines, detail view, edit mode |
| Shots page | ⚠️ Partial | 129 lines, requires manual scene ID entry |
| Shot production page | ⚠️ Partial | Basic status display, no detail editing |

---

## 4. Media Engine — ⚠️ PARTIALLY IMPLEMENTED

| Component | Status | Files |
|-----------|--------|-------|
| Kokoro TTS | ✅ Complete | `lib/providers/media/audio/kokoro.ts` (220 lines), 54 voices |
| Audio generation/cancel/retry | ✅ Complete | Audio page 366 lines, 3-step workflow |
| Audio segment playback | ✅ Complete | HTML5 Audio |
| Voice profiles display | ✅ Complete | — |
| Media gallery | ✅ Complete | `MediaGallery.tsx` (311 lines) |
| Visual asset reference management | ✅ Complete | `visual-assets` page 194 lines |
| Mock image provider | ✅ Complete | `MockImageProvider` |
| Mock video provider | ✅ Complete | `MockVideoProvider` |
| `isMock` flag on assets | ✅ Complete | Distinguishes mock from real |
| **Real image providers** | ❌ **Not started** | No ComfyUI, DALL-E, SD, etc. |
| **Real video providers** | ❌ **Not started** | No Veo, Runway, etc. |
| **SFX generation** | ❌ **Not started** | — |
| **Music generation** | ❌ **Not started** | — |
| **Lip sync generation** | ❌ **Not started** | — |

---

## 5. Rendering Engine — ✅ FULLY IMPLEMENTED

| Component | Status | Files |
|-----------|--------|-------|
| FFmpeg render engine | ✅ Complete | `engine.ts` (151 lines) |
| Transitions (fade, wipe, slide) | ✅ Complete | xfade filter |
| Subtitle burn-in | ✅ Complete | — |
| Audio mixing | ✅ Complete | — |
| FFmpeg command builder | ✅ Complete | `commandBuilder.ts` (137 lines) |
| 3 presets (9:16, 16:9, 1:1) | ✅ Complete | `presets.ts` (67 lines) |
| Timeline assembly service | ✅ Complete | `timelineAssemblyService.ts` (236 lines) |
| Timeline approval with validation | ✅ Complete | Blocking error detection |
| Timeline editor (DnD) | ✅ Complete | `TimelineEditor.tsx` (543 lines) |
| Rendering page | ✅ Complete | 192 lines, preset, trigger, cancel, download |
| Assembly page | ✅ Complete | 200 lines, timeline preview, validation |
| Real video clip rendering | ⚠️ Partial | Works but depends on mock video assets |

---

## 6. Pipeline & Jobs — ⚠️ PARTIALLY IMPLEMENTED

**31 job types defined. 13 directly handled. 18 not directly handled.**

| Job Type | Status | Handler |
|----------|--------|---------|
| `story.draft` | ✅ | `processJob.ts` |
| `story.generate` | ✅ | Run-based engine dispatch |
| `storyBible.generate` | ✅ | `processJob.ts` |
| `seasonPlan.generate` | ✅ | `processJob.ts` |
| `episodeSuggest.generate` | ✅ | `processJob.ts` |
| `character.extract` | ✅ | Run-based engine dispatch |
| `scene.breakdown` | ✅ | Run-based engine dispatch |
| `canon.extract` | ✅ | Run-based engine dispatch |
| `assembly.generate` | ✅ | `processJob.ts` |
| `render.final` | ✅ | `processJob.ts` |
| `audio.dialogue` | ✅ | `processJob.ts` |
| `audio.narration` | ✅ | `processJob.ts` |
| `video.scene` | ✅ | `processJob.ts` (mock) |
| `image.character_reference` | ⚠️ Mock | Falls through to mock |
| `image.environment_reference` | ⚠️ Mock | Falls through to mock |
| `image.object_reference` | ⚠️ Mock | Falls through to mock |
| `image.shot` | ⚠️ Mock | Falls through to mock |
| `video.shot` | ⚠️ Mock | Falls through to mock |
| `audio.sfx` | ❌ Not handled | — |
| `audio.music` | ❌ Not handled | — |
| `media.validate` | ❌ Not handled | — |
| `image.comfyui` | ❌ Not handled | Phase 2 |
| `animation.2d` | ❌ Not handled | Phase 3 |
| `animation.3d` | ❌ Not handled | Phase 4 |
| `character.model` | ❌ Not handled | Phase 4 |
| `character.rig` | ❌ Not handled | Phase 4 |
| `audio.lipsync` | ❌ Not handled | Phase 5 |
| `audio.edit` | ❌ Not handled | Phase 5 |
| `render.remotion` | ❌ Not handled | Phase 6 |
| `video.veo` | ❌ Not handled | Phase 7 |
| `tool.healthcheck` | ❌ Not handled | Phase 1 (via service, not job) |

**Pipeline infrastructure:**
- ✅ 3 queues (generation, production, maintenance) with proper routing
- ✅ BullMQ worker (`workers/studio.ts`) with Redis, concurrency settings
- ✅ Pipeline service (757 lines) with full approval flow for all stages
- ✅ 6-stage state machine: story → characters → scenes → media → render → done

---

## 7. MCP Server — ✅ FULLY IMPLEMENTED (1 bug fixed)

| Component | Status | Details |
|-----------|--------|---------|
| Tools registered | ✅ 68 tools | Across 18 register functions |
| Resources registered | ✅ 9 resources | project:// URI scheme |
| HTTP transport | ✅ Complete | Session pooling, SSE streaming |
| Activity logging | ✅ Complete | Memory + MongoDB dual-write |
| Tool integration tools | ✅ 7 new tools | tools.list/get/configure/healthCheck/healthCheckAll/listByCategory/enable |
| `render.start` preset bug | ✅ FIXED | Was `["standard","high","social"]`, now `["vertical_9_16","landscape_16_9","square_1_1"]` |

---

## 8. External Tool Integration — ⚠️ PARTIALLY IMPLEMENTED

| Component | Status | Files |
|-----------|--------|-------|
| `ExternalToolProvider` interface | ✅ Complete | `types.ts` (72 lines) |
| Provider registry | ✅ Complete | `registry.ts` (33 lines) |
| Tool config model + repository | ✅ Complete | MongoDB-backed |
| Tool config service | ✅ Complete | CRUD + health check state machine |
| API routes | ✅ Complete | GET/POST/PATCH/DELETE + health checks |
| Tools settings UI | ✅ Complete | Per-tool config, enable/disable, status badges |
| MCP tools | ✅ Complete | 7 tools for integration management |
| 15 tool types defined | ✅ Complete | comfyui, blender, synfig, opentoonz, pencil2d, makehuman, mixamo, wav2lip, sadtalker, audacity, remotion, lottie, veo, ffmpeg, kokoro |
| **Actual provider registrations** | ❌ **Not started** | `registerToolProvider` never called — no providers registered |

---

## 9. LLM Providers — ✅ FULLY IMPLEMENTED

| Component | Status | Details |
|-----------|--------|---------|
| 10 providers | ✅ Complete | ollama, lmstudio, gemini, groq, openrouter, mistral, openai, anthropic, deepseek, kimi |
| Failover manager | ✅ Complete | 957 lines, circuit breakers, cooldowns |
| Free-only policy | ✅ Complete | Paid providers blocked when `LLM_FREE_ONLY=true` |
| Ollama last-resort fallback | ✅ Complete | — |
| All story/character/scene/bible methods | ✅ Complete | All providers |
| `generateCanonSuggestions` | ⚠️ Partial | Only gemini and lmstudio |
| `generateCanonFacts` | ⚠️ Partial | Only lmstudio |
| `reasonSeasonPlan` | ❌ Not started | Declared but not implemented |

---

## 10. Storage — ⚠️ PARTIALLY IMPLEMENTED

| Component | Status | Files |
|-----------|--------|-------|
| Local storage | ✅ Complete | `local.ts` (104 lines), SHA256 verification |
| S3 storage | ❌ Not started | Throws `s3_storage_adapter_not_implemented` |
| Cloudinary storage | ❌ Not started | Throws `cloudinary_storage_adapter_not_implemented` |

---

## 11. UI Pages — ✅ FULLY IMPLEMENTED

**20 project-scoped pages + 7 top-level pages. All have loading/error/empty states. All buttons functional.**

| Page | Status | Notes |
|------|--------|-------|
| Dashboard | ✅ | 4-phase pipeline visualization, stats grid |
| Planning | ✅ | Create/save/submit/approve, version history |
| Canon | ✅ | Facts/proposals/contradictions, filter, search, rebuild |
| Characters | ✅ | Tabs, search, approve, create object |
| Scenes | ✅ | List, detail, edit mode, approve |
| Shots | ⚠️ | Requires manual scene ID entry |
| Production Design | ✅ | Shot list table editing, approve |
| Story | ✅ | Import, export, generate, approve, regenerate, revise |
| Episodes | ✅ | List, detail |
| Bible | ✅ | 6-section editing, import/export, approve |
| Visual Assets | ✅ | Load references, approve/reject |
| Audio | ✅ | 3-step workflow, generate/stop/retry/play |
| Assembly | ⚠️ | Requires manual episode ID entry |
| Rendering | ⚠️ | Requires manual episode + timeline ID entry |
| Timeline | ⚠️ | Requires manual episode ID entry |
| Video | ✅ | 3-step workflow, approve/stop/retry |
| Media | ✅ | Filter, download, delete |
| Review | ✅ | Aggregates all pending items |
| Settings | ✅ | Language preference |
| Settings/Tools | ✅ | External tool config, health checks |
| MCP | ✅ | Tool list, assistant configs |

---

## 12. Planning & Canon — ✅ FULLY IMPLEMENTED

| Component | Status | Files |
|-----------|--------|-------|
| Planning document workflow | ✅ Complete | Create/save/submit/approve, version history |
| Season plan workspace | ✅ Complete | 269 lines, generate/validate/approve |
| Season plan validation | ✅ Complete | 201 lines |
| Canon page | ✅ Complete | Facts/proposals/contradictions, filter, search |
| CASNA context loading | ✅ Complete | `lib/pipeline/casnaContext.ts` |
| Canon fact extraction | ✅ Complete | 564 lines, evidence verification |
| Canon system (9 files) | ✅ Complete | store, verifier, bridge, schema, model, reduce, views |
| Narrative control (19 files) | ✅ Complete | orchestrator, canonResolution, findings, temporal, causal |
| Plan validation (16 files) | ✅ Complete | Validators for canon, character state, climax, progression |
| Continuity ledger | ✅ Complete | Append-only, updated on approval |

---

## 13. Review & Approval — ✅ FULLY IMPLEMENTED

| Component | Status | Details |
|-----------|--------|---------|
| Review inbox | ✅ Complete | Aggregates ALL pending items from 8 services |
| Review API | ✅ Complete | `Promise.allSettled` for resilience |
| Story approval gate | ✅ Complete | Commits canon, advances to characters |
| Character approval gate | ✅ Complete | Advances to scenes, continuity commit |
| Scene approval gate | ✅ Complete | Advances to media, continuity commit |
| Media approval gate | ✅ Complete | Advances to render |
| Render approval gate | ✅ Complete | Completes run |
| `skipAutoAdvance` | ✅ Complete | Available at every stage |
| Visual asset review | ✅ Complete | Approve/reject with version chaining |
| Production design approval | ✅ Complete | Version conflict detection |
| Timeline approval | ✅ Complete | Blocking validation |
| Shot plan approval | ✅ Complete | Required before production |
| Planning document approval | ✅ Complete | Submit/approve workflow |
| Season plan approval | ✅ Complete | — |

---

## 14. Tests — ✅ COMPREHENSIVE

| Metric | Value |
|--------|-------|
| Test files | 91 |
| Total test lines | 32,516 |
| Passing | 1,535 |
| Skipped | 6 |
| Failing | 1 (kokoro e2e — needs MongoDB URI) |

**Coverage areas:** canon (12+ files), continuity (7+ files), LLM providers (ollama, lmstudio, failover, free-providers), pipeline, MCP server, media (kokoro, ffmpeg, storage, probe), season plan, story (draft, bible, generation, architecture), revision, workflow, CASNA domain, house integration, narrative control, validator regression.

---

## Bugs & Issues Summary

| # | Severity | Area | Issue | Status |
|---|----------|------|-------|--------|
| 1 | **BUG** | MCP Server | `render.start` preset IDs mismatch | ✅ Fixed in this commit |
| 2 | **GAP** | External Tools | No providers registered | Phase 2-7 |
| 3 | **GAP** | LLM Providers | `reasonSeasonPlan` not implemented | Low priority |
| 4 | **GAP** | LLM Providers | `generateCanonFacts` only in lmstudio | Medium |
| 5 | **GAP** | Storage | S3/Cloudinary not implemented | Phase 6 |
| 6 | **GAP** | Media | Real image/video providers not implemented | Phase 2-7 |
| 7 | **GAP** | Pipeline | 18 job types not directly handled | Phase 2-7 |
| 8 | **UX** | UI Pages | No route-level error boundaries | Low priority |
| 9 | **UX** | UI Pages | Manual ID entry on some pages | Low priority |
| 10 | **GAP** | Story Engine | No Fountain/FDX/PDF import | Low priority |

---

## Implementation Phases

### Phase 1: Integration Foundation — ✅ COMPLETE
- ✅ External tool config model, repository, service
- ✅ ExternalToolProvider interface + registry
- ✅ Health check system with evidence-based status
- ✅ 15 tool types, 8 status states, connection state machine
- ✅ Tools settings UI page
- ✅ 7 MCP tools for integration management
- ✅ 10 new media asset types
- ✅ 10 new job types
- ✅ Bug fixes (visualAssetService, productionStatus, MCP presets)

### Phase 2: ComfyUI Image Generation — ❌ NOT STARTED
1. ComfyUI provider adapter (implements `ExternalToolProvider`)
2. Register provider in registry
3. ComfyUI workflow management (store/load JSON workflows)
4. Model management (list checkpoints/LoRAs via API)
5. Job handler for `image.comfyui`
6. Connect to media asset system
7. UI: Image generation page with workflow/model selection
8. MCP tools: `comfyui.workflows`, `comfyui.execute`

### Phase 3: 2D Animation — ❌ NOT STARTED
1. Synfig adapter (file-based export/import)
2. OpenToonz adapter (file-based)
3. Pencil2D adapter (file-based)
4. Blender Grease Pencil adapter (Python script)
5. FFmpeg `concatImages` operation (frame sequence → video)
6. Job handler for `animation.2d`
7. UI: Animation page with tool selection, export/import

### Phase 4: 3D Animation — ❌ NOT STARTED
1. Blender 3D adapter (Python script for headless render)
2. MakeHuman adapter (character model generation)
3. Mixamo adapter (rig and animation download)
4. Extend CanonicalEntity visual profile with 3D fields
5. Job handlers for `animation.3d`, `character.model`, `character.rig`
6. UI: 3D character page with model preview, rig selection

### Phase 5: Audio & Lip Sync — ❌ NOT STARTED
1. Kokoro improvements (voice cloning, emotion control, batch)
2. Audacity adapter (ModScript/Nyquist export/import)
3. Wav2Lip adapter (audio + image → lip-synced video)
4. SadTalker adapter (audio + image → talking head video)
5. Job handlers for `audio.lipsync`, `audio.edit`
6. UI: Audio editing page, lip-sync generation page

### Phase 6: Editing & Rendering — ❌ NOT STARTED
1. FFmpeg standalone operations (transcode, trim, extractFrames, extractAudio, replaceAudio, overlay)
2. Remotion integration (React-based video composition)
3. SVG/Lottie animation support (parse and render Lottie JSON)
4. External final editing export/import (EDL/XML/JSON)
5. S3 storage provider implementation
6. Job handler for `render.remotion`
7. UI: Advanced render settings, Remotion preview, Lottie preview

### Phase 7: Optional Cloud Generation — ❌ NOT STARTED
1. Google Veo provider adapter (implements `VideoProvider`)
2. Cost tracking and budget controls
3. Job handler for `video.veo`
4. UI: Veo settings (disabled by default, requires API key)
5. MCP tool: `veo.generate`