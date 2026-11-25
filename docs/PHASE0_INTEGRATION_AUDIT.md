# Phase 0: Integration Architecture Audit Report

**Date:** 2026-11-24  
**Status:** Complete — awaiting approval before Phase 1  
**Hardware:** AMD Ryzen 5 PRO 2600 (6c/12t), 16GB DDR4 RAM, AMD Radeon R7 430 (2GB VRAM)

---

## 1. Executive Summary

AI Drama Studio has a mature foundation for LLM-driven screenplay generation, canonical entity management, and a mock-backed media production pipeline. The system is **not** starting from zero — it has:

- A **provider registry** with a clean adapter pattern (image/video/audio), currently populated only with mocks + Kokoro TTS
- A **media asset system** with 9 asset types, versioning, review workflow, and idempotent storage
- A **pipeline service** with 6-stage state machine and 21 job types across 3 BullMQ queues
- An **MCP server** with 61 tools and 9 resources for external AI assistant collaboration
- An **FFmpeg render engine** with concat, transitions (xfade), audio mixing, and subtitle burn-in
- A **Kokoro TTS provider** with 54 voices across 9 languages via Python bridge

What's **entirely missing** is real integration with external creative tools: ComfyUI, Blender, Synfig, OpenToonz, Pencil2D, MakeHuman, Mixamo, Wav2Lip, SadTalker, Audacity, Remotion, SVG/Lottie, and Google Veo. No health-check system, no tool configuration management, no connection-status tracking, and no export/import workflow for tools that lack APIs.

---

## 2. Current State Assessment

### 2.1 Provider Architecture (Extension Point)

**File:** `lib/providers/media/registry.ts`

The `ProviderRegistry` class accepts arrays of `ImageProvider[]`, `VideoProvider[]`, `AudioProvider[]` and always appends mock fallbacks. Selection is capability-based via `capabilitySatisfies()`.

**Interfaces:**
| Provider | Interface | Key Methods | Request Shape |
|----------|-----------|-------------|---------------|
| Image | `ImageProvider` | `generate()` | `ImagePrompt` (subject, environment, style, lighting, camera, composition, continuityNotes) + referenceImages + model + settings |
| Video | `VideoProvider` | `submit()`, `poll()`, `cancel?()` | `VideoPrompt` (staticScene, motion, cameraMovement, durationSeconds) + referenceImage + model + settings |
| Audio | `AudioProvider` | `generate()` | `AudioGenerationRequest` (kind: dialogue/narration/sfx, text, voiceProfile, settings) |

**Capability type:** `ProviderCapability` has `supportsImageToImage`, `supportsImageToVideo`, `supportsReferenceGuidedVideo`, `maxClipDurationSeconds`, `maxImageDimension`, `isMock`, `isPaid`, `supportedModels`.

**Assessment:** The interfaces are designed for AI generation, not for external tool coordination. They assume the provider generates media from prompts. For tools like Blender/Synfig/Audacity that operate on files (not prompts), we need a **new provider category**: `ExternalToolProvider` with file-based operations (open, export, import, render, check-status).

### 2.2 Media Asset System (Reusable)

**Files:** `lib/models/mediaAsset.ts`, `lib/repositories/mediaAssetRepository.ts`, `lib/services/mediaAssetService.ts`, `lib/validation/mediaAsset.ts`

**9 asset types:** `character_reference`, `scene_image`, `scene_video`, `dialogue_audio`, `narration_audio`, `music`, `sound_effect`, `subtitle`, `final_render`

**Review workflow:** `pending` → `approved` / `rejected` / `archived` with version chain (`previousVersionId` / `replacedById`).

**Storage:** `local` (implemented), `s3` (throws `not_implemented`), `cloudinary` (throws `not_implemented`).

**Assessment:** The asset system is solid and reusable. New asset types needed for the integration:
- `character_model_3d` — MakeHuman/Blender character models (.glb, .fbx)
- `character_rig` — Mixamo rigs/animations
- `animation_2d` — Synfig/OpenToonz/Pencil2D exports
- `animation_3d` — Blender animation exports
- `lip_sync_video` — Wav2Lip/SadTalker outputs
- `project_file` — External tool project files (.blend, .sifz, .otx, .pclx, .aup)
- `lottie_animation` — SVG/Lottie animation files (.json)
- `remotion_composition` — Remotion project files

**Bug found:** `visualAssetService.uploadReference` (line 75) always types assets as `character_reference` even for locations/objects — redundant ternary where both branches yield the same value.

### 2.3 Pipeline & Job System (Reusable)

**Files:** `lib/pipeline/types.ts`, `lib/services/pipelineService.ts`, `lib/pipeline/processJob.ts`, `workers/studio.ts`

**6-stage state machine:** `story` → `characters` → `scenes` → `media` → `render` → `done` (with approval gates)

**21 job types** across 3 queues:
- `generation` — LLM jobs (story, character, scene, canon, assembly, planning)
- `production` — audio TTS + FFmpeg render (serial)
- `maintenance` — mock image/video + media validation

**Assessment:** The job system is extensible — new job types can be added to `JOB_TYPES` array and handled in `processJob.ts`. New job types needed:
- `image.comfyui` — ComfyUI workflow execution
- `animation.2d` — 2D animation tool export/render
- `animation.3d` — Blender render
- `character.model` — MakeHuman generation
- `character.rig` — Mixamo rig/animation
- `audio.lipsync` — Wav2Lip/SadTalker
- `audio.edit` — Audacity processing
- `render.remotion` — Remotion composition render
- `video.veo` — Google Veo generation (optional)

### 2.4 MCP Server (Reusable)

**File:** `lib/mcp/server.ts`

**61 tools** across 17 categories, **9 resources** on `project://` URI scheme. HTTP transport with per-user server pooling, Bearer token auth, SSE streaming.

**Assessment:** The MCP server is the primary collaboration interface. New tools needed for integration management:
- `tools.list` — List all configured external tools and their status
- `tools.configure` — Configure an external tool (endpoint, path, credentials)
- `tools.healthCheck` — Run health check on a specific tool
- `tools.importAsset` — Import an asset from an external tool
- `tools.exportAsset` — Export an asset to an external tool
- `comfyui.workflows` — List available ComfyUI workflows
- `comfyui.execute` — Execute a ComfyUI workflow
- `blender.render` — Trigger Blender render
- `animation.render` — Trigger 2D/3D animation render

### 2.5 FFmpeg Engine (Reusable + Extensible)

**Files:** `lib/providers/media/ffmpeg/`

**Current capabilities:** concat, xfade transitions (fade/wipe/slide), audio mixing, subtitle burn-in, 3 presets (9:16, 16:9, 1:1), H.264/AAC/30fps.

**Assessment:** FFmpeg is solid for final assembly. Missing operations that should be added as standalone services:
- `transcode` — Convert between formats/codecs
- `extractFrames` — Extract frames as image sequence
- `trim` — Trim video without re-encoding (stream copy)
- `extractAudio` — Extract audio track
- `replaceAudio` — Replace audio track
- `concatImages` — Image sequence to video (for animation frames)
- `overlay` — Composite/overlay video layers

### 2.6 Canonical Entity System (Reusable + Extensible)

**File:** `lib/models/canonicalEntity.ts`

**Entity types:** `character`, `location`, `object`  
**Visual profiles:** Character (hair, eyes, build, skin, clothing, distinctive), Location (timeOfDay, weather, architecturalStyle, lighting), Object (material, color, size, shape)

**Assessment:** Visual profiles need extension for 3D/animation:
- Character: `model3dAssetId`, `rigAssetId`, `animationLibrary[]`, `blendshapeSet`
- Location: `environmentModelAssetId`, `lightingSetupAssetId`
- Object: `model3dAssetId`, `animationAssetId`

### 2.7 Timeline Editor (Reusable)

**File:** `components/timeline/TimelineEditor.tsx` (544 lines)

**6 track kinds:** `video`, `dialogue`, `narration`, `music`, `sfx`, `subtitle`  
**Per-clip:** trim (in/out), volume, offset, transitions (crossfade, wipe, slide)

**Assessment:** Timeline is mature. May need new track kinds:
- `animation` — For 2D/3D animation overlays
- `effects` — For visual effects layers

### 2.8 Shot Production System

**Three concepts:**
1. `ProductionScene.shotPlan` — Lightweight shot list (≤20 shots, inline)
2. `ProductionDesign.shotList` — Rich, versioned, approvable (≤50 shots)
3. `ShotProductionRecord` — Execution record with segments and productionStatus

**Inconsistency found:** Scenes use `productionStatus: "complete"` while shots use `productionStatus: "completed"` — should be unified.

### 2.9 Storage Abstraction

**File:** `lib/providers/storage/types.ts`

**Interface:** `put`, `get`, `openRead`, `stat`, `head`, `delete`, `list`  
**Implemented:** `local` only. `s3` and `cloudinary` throw `not_implemented`.

**Assessment:** The interface is clean. S3 implementation should be added for larger media files (3D models, animation sequences, video renders) that may exceed local disk capacity.

### 2.10 Configuration

**File:** `lib/config.ts`

**Single feature flag:** `LLM_GENERATION_ENABLED`

**Assessment:** Need a more granular configuration system for external tools:
- Per-tool enable/disable
- Per-tool endpoint/path configuration
- Per-tool model/credential configuration
- Connection status tracking (not_installed → installed → configured → connected → available → processing → failed → unavailable)

---

## 3. Gap Analysis

### 3.1 What Exists (Reusable Without Changes)

| Component | Location | Status |
|-----------|----------|--------|
| Provider registry pattern | `lib/providers/media/registry.ts` | Extensible — add new providers to arrays |
| Media asset model & repository | `lib/models/mediaAsset.ts`, `lib/repositories/` | Extensible — add new asset types to enum |
| Pipeline state machine | `lib/services/pipelineService.ts` | Extensible — add new stages/job types |
| BullMQ worker | `workers/studio.ts` | Extensible — add new job handlers |
| MCP server | `lib/mcp/server.ts` | Extensible — add new tools/resources |
| FFmpeg engine | `lib/providers/media/ffmpeg/` | Extensible — add new operations |
| Storage abstraction | `lib/providers/storage/types.ts` | Extensible — implement S3/cloudinary |
| Canonical entity | `lib/models/canonicalEntity.ts` | Extensible — add 3D/animation fields |
| Timeline editor | `components/timeline/TimelineEditor.tsx` | Extensible — add track kinds |
| Shot production records | `lib/models/shotProductionRecord.ts` | Reusable as-is |
| Activity logging | `lib/mcp/activityLog.ts` | Reusable as-is |
| Review workflow | `app/api/projects/[projectId]/review/` | Reusable as-is |

### 3.2 What's Missing (Must Build)

| Component | Priority | Phase |
|-----------|----------|-------|
| External tool configuration model & UI | Critical | 1 |
| Health check system (per-tool) | Critical | 1 |
| Connection status state machine | Critical | 1 |
| `ExternalToolProvider` interface (file-based ops) | Critical | 1 |
| Asset import/export contract system | Critical | 1 |
| ComfyUI provider adapter | High | 2 |
| ComfyUI workflow management | High | 2 |
| 2D animation tool adapters (Synfig, OpenToonz, Pencil2D) | High | 3 |
| Blender Grease Pencil adapter | High | 3 |
| Blender 3D adapter | High | 4 |
| MakeHuman adapter | High | 4 |
| Mixamo adapter | High | 4 |
| 3D model/animation association system | High | 4 |
| Kokoro improvements (voice cloning, emotion control) | Medium | 5 |
| Audacity workflow adapter | Medium | 5 |
| Wav2Lip adapter | Medium | 5 |
| SadTalker adapter | Medium | 5 |
| FFmpeg standalone operations (transcode, trim, extract) | Medium | 6 |
| Remotion integration | Medium | 6 |
| SVG/Lottie animation support | Medium | 6 |
| External final editing export/import | Medium | 6 |
| S3 storage provider | Low | 1-6 |
| Google Veo provider (optional) | Low | 7 |

### 3.3 Architectural Conflicts & Issues Found

| Issue | Location | Severity | Fix |
|-------|----------|----------|-----|
| `productionStatus` enum inconsistency | Scenes use `"complete"`, shots use `"completed"` | Medium | Unify to `"completed"` |
| `visualAssetService.uploadReference` bug | Line 75: always types as `character_reference` | Medium | Fix ternary to use correct type for locations/objects |
| MCP page shows 44 tools (hardcoded) | `app/(studio)/mcp/page.tsx` | Low | Dynamically read from server |
| AGENTS.md says 17 tools + 6 resources | `AGENTS.md` | Low | Update to 61 tools + 9 resources |
| No direct upload endpoint | `/api/projects/[projectId]/media/` | Medium | Add POST endpoint for direct asset upload |
| `storeVerified` hardcodes `isMock: false` | `lib/services/mediaAssetService.ts` | Low | Accept `isMock` parameter |
| Single feature flag | `lib/config.ts` | Medium | Add per-tool configuration system |
| No tool health check system | — | Critical | Build in Phase 1 |

---

## 4. Integration Architecture

### 4.1 New Provider Category: ExternalToolProvider

The existing `ImageProvider`/`VideoProvider`/`AudioProvider` interfaces assume prompt-based generation. External tools like Blender, Synfig, and Audacity operate on **files**, not prompts. A new interface is needed:

```
ExternalToolProvider {
  readonly id: string;
  readonly toolType: ToolType;  // "comfyui" | "blender" | "synfig" | ...
  readonly capabilities: ToolCapability;
  
  healthCheck(): Promise<HealthStatus>;
  listWorkflows?(): Promise<Workflow[]>;
  executeWorkflow(workflowId, params): Promise<JobHandle>;
  pollJob(handle): Promise<JobResult>;
  cancelJob?(handle): Promise<void>;
  
  // File-based operations (for tools without API)
  exportProject(params): Promise<{ filePath: string }>;
  importResult(filePath: string): Promise<AssetImport>;
}
```

### 4.2 Tool Configuration Model

```
ExternalToolConfig {
  toolType: string;           // "comfyui" | "blender" | "synfig" | ...
  displayName: string;
  enabled: boolean;
  
  // Connection
  endpoint?: string;          // API URL (if tool has API)
  executablePath?: string;    // Local executable (if no API)
  workingDirectory?: string;  // Working dir for file-based ops
  
  // Credentials
  apiKey?: string;            // Encrypted
  
  // Status (managed by health check system)
  status: ToolStatus;         // not_installed → installed → configured → connected → available → processing → failed → unavailable
  lastHealthCheck?: Date;
  lastHealthCheckResult?: HealthCheckResult;
  
  // Tool-specific config (flexible schema)
  config: Record<string, unknown>;
}
```

### 4.3 Connection Status State Machine

```
not_installed → installed → configured → connected → available
                                                      ↓
                                              processing → available
                                                      ↓
                                                   failed → unavailable
```

**Critical rule:** Never display "connected" simply because a tool name is configured. Status transitions require evidence:
- `not_installed` → `installed`: Executable found or endpoint reachable
- `installed` → `configured`: Required config fields filled
- `configured` → `connected`: Health check passed
- `connected` → `available`: Ready to accept jobs
- `available` → `processing`: Job submitted
- `processing` → `available`: Job completed successfully
- `processing` → `failed`: Job failed
- `failed` → `unavailable`: After retry exhaustion

### 4.4 New Media Asset Types

```
"character_model_3d"      // .glb, .fbx, .obj
"character_rig"           // Rig + animation data
"animation_2d"            // Synfig/OpenToonz/Pencil2D exports
"animation_3d"            // Blender animation exports
"lip_sync_video"          // Wav2Lip/SadTalker outputs
"project_file"            // External tool project files
"lottie_animation"        // SVG/Lottie .json
"remotion_composition"    // Remotion project
"frame_sequence"          // Image sequence (for animation)
```

### 4.5 New Job Types

```
"image.comfyui"           // ComfyUI workflow execution
"animation.2d"            // 2D animation render
"animation.3d"            // Blender 3D render
"character.model"         // MakeHuman generation
"character.rig"           // Mixamo rig/animation
"audio.lipsync"           // Wav2Lip/SadTalker
"audio.edit"              // Audacity processing
"render.remotion"         // Remotion composition
"video.veo"               // Google Veo (optional)
"tool.healthcheck"        // Periodic health checks
```

---

## 5. Recommended Implementation Order

### Phase 1: Integration Foundation
**Goal:** Build the infrastructure that all subsequent phases depend on.

1. **Tool configuration model** — `ExternalToolConfig` MongoDB model + repository + service
2. **Tool configuration UI** — Settings page section for managing external tools (list, add, edit, delete, enable/disable)
3. **Health check system** — Per-tool health check service with scheduled periodic checks
4. **Connection status state machine** — Status transitions with evidence-based validation
5. **`ExternalToolProvider` interface** — New provider category for file-based tools
6. **Asset import/export contracts** — Standardized contract for importing/exporting assets to/from external tools
7. **New media asset types** — Add 9 new types to `MEDIA_ASSET_TYPES`
8. **New job types** — Add 10 new types to `JOB_TYPES`
9. **MCP tools for integration management** — `tools.list`, `tools.configure`, `tools.healthCheck`, `tools.importAsset`, `tools.exportAsset`
10. **Fix existing bugs** — `productionStatus` inconsistency, `visualAssetService.uploadReference` bug

### Phase 2: Image Generation (ComfyUI)
**Goal:** Real image generation via ComfyUI, replacing mock image provider.

1. **ComfyUI provider adapter** — Implements `ImageProvider` interface, connects to ComfyUI API
2. **Workflow management** — Store and select ComfyUI workflows (JSON graph definitions)
3. **Model management** — List installed checkpoints/LoRAs, don't assume availability
4. **Job tracking** — ComfyUI prompt submission → polling → result download
5. **Connect to asset system** — Generated images stored as `MediaAsset` with proper type and associations
6. **UI integration** — Image generation page with workflow selection, model selection, prompt input
7. **MCP tools** — `comfyui.workflows`, `comfyui.execute`

### Phase 3: 2D Animation
**Goal:** Coordinate 2D animation tools for scene/shot animation.

1. **Synfig adapter** — Export/import workflow (Synfig has limited API; use file-based)
2. **OpenToonz adapter** — Export/import workflow
3. **Pencil2D adapter** — Export/import workflow
4. **Blender Grease Pencil adapter** — Blender Python script for 2D animation
5. **Frame sequence to video** — FFmpeg `concatImages` operation
6. **Animation asset management** — Store animation exports as `animation_2d` assets
7. **UI integration** — Animation page with tool selection, export/import, frame preview

### Phase 4: 3D Animation
**Goal:** 3D character models, rigs, and animations.

1. **Blender 3D adapter** — Python script for headless render
2. **MakeHuman adapter** — Character model generation
3. **Mixamo adapter** — Rig and animation download (web automation or API)
4. **3D model/animation association** — Extend `CanonicalEntity` visual profile with 3D fields
5. **Character model pipeline** — MakeHuman → Mixamo rig → Blender render
6. **UI integration** — 3D character page with model preview, rig selection, animation library

### Phase 5: Audio & Lip Sync
**Goal:** Improved TTS, audio editing, and lip-sync animation.

1. **Kokoro improvements** — Voice cloning, emotion control, batch processing
2. **Audacity adapter** — Export/import workflow for audio editing (ModScript/Nyquist)
3. **Wav2Lip adapter** — Audio + image/video → lip-synced video
4. **SadTalker adapter** — Audio + image → talking head video
5. **Lip-sync asset management** — Store outputs as `lip_sync_video` assets
6. **UI integration** — Audio editing page, lip-sync generation page

### Phase 6: Editing & Rendering
**Goal:** Enhanced final assembly and rendering options.

1. **FFmpeg standalone operations** — transcode, trim, extractFrames, extractAudio, replaceAudio, overlay
2. **Remotion integration** — React-based video composition for complex sequences
3. **SVG/Lottie animation support** — Parse and render Lottie JSON to video
4. **External final editing export/import** — Export timeline to EDL/XML/JSON for external NLEs
5. **UI integration** — Advanced render settings, Remotion preview, Lottie preview

### Phase 7: Optional Cloud Generation (Google Veo)
**Goal:** Optional cloud video generation for high-quality output.

1. **Google Veo provider adapter** — Implements `VideoProvider` interface
2. **Cost tracking and budget controls** — Veo is paid; require explicit user opt-in
3. **UI integration** — Veo settings (disabled by default, requires API key)
4. **MCP tools** — `veo.generate` (only available if configured and enabled)

---

## 6. Risk Assessment

| Risk | Mitigation |
|------|------------|
| 2GB VRAM insufficient for local video generation | Don't make Wan/Hunyuan/LTX mandatory; use ComfyUI with lightweight models or cloud |
| External tools lack APIs | Use export/import workflow; never pretend direct integration |
| ComfyUI model not installed | Health check must verify model availability, not just ComfyUI connectivity |
| Blender headless render resource usage | Run as background job with resource limits; queue, don't block |
| Mixamo requires web login | Use session-based download or manual upload workflow |
| Large media files exceed local disk | Implement S3 storage provider in Phase 1 |
| Tool configuration complexity | Start with minimal config; add per-tool config schema as needed |
| MCP tool count drift | Dynamically read tool count from server, don't hardcode |

---

## 7. Key Design Principles

1. **Coordinate, don't replicate** — AI Drama Studio manages assets and workflow; external tools do the creative work.
2. **Evidence-based status** — Never claim "connected" without proof. Health checks are mandatory.
3. **File-based fallback** — Where no API exists, use explicit export/import. Never fake direct integration.
4. **Hardware-aware** — Don't assume heavy local models work. Make everything optional and configurable.
5. **Reuse existing infrastructure** — Extend provider registry, media asset system, pipeline, and MCP server. Don't duplicate.
6. **Independent integrations** — Each tool integration is independent from creative planning and canon systems.
7. **Strict type safety** — No `any`. All tool configs, capabilities, and results are typed.
8. **CSS Modules** — No Tailwind for new styling. Use existing Next.js architecture.
9. **Every button works** — No placeholder controls. Every UI action has a real implementation.
10. **Full state coverage** — Loading, success, error, and empty states for all operations.

---

## 8. Approval Gate

**This report is the Phase 0 deliverable.** Implementation of Phase 1 will begin only after explicit user approval.

**To approve:** Respond with "proceed" or "approved".  
**To modify:** Specify what changes you'd like to the architecture or implementation order.  
**To discuss:** Ask questions about any section before approving.