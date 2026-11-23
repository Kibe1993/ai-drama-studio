# Restructure Audit — Stage 0 Executive Summary

**Date:** 2026-11-23
**Status:** Read-only forensic audit (Stage 0)
**Codebase:** AI Drama Studio — 493 TS/TSX files, 89,393 lines

---

## 1. What This App Is Today

AI Drama Studio is a **LLM-generation-centric short drama screenplay platform**. The core workflow is:

```
User prompt → LLM generates Story Bible → LLM generates Story → LLM generates Season Plan
→ LLM generates Episodes → Mock media generation → FFmpeg render → Export
```

The application's primary value proposition is **automated content generation via cloud LLM APIs**. All creative intelligence — story structure, character design, scene breakdown, dialogue — is produced by LLM providers (DeepSeek, Groq, OpenRouter, Mistral, Anthropic, OpenAI, Gemini, Ollama, LM Studio, Kimi).

## 2. Scale Inventory

| Layer | Files | Lines (approx) | Notes |
|-------|-------|----------------|-------|
| **App routes/pages** | 81 | ~12,000 | 21 pages, 60 API route handlers |
| **Components** | 25 | ~5,000 | Layout, projects, workflow, production |
| **Hooks** | 10 | ~1,500 | React Query data fetching |
| **Models** | 25 | ~3,500 | Mongoose schemas, all tenant-scoped |
| **Repositories** | 28 | ~4,000 | DB query layer |
| **Services** | 26 | ~6,000 | Business logic, stage transitions |
| **LLM providers** | 39 | ~8,800 | 10 adapters, ASPO, CASNA, manager |
| **Pipeline** | 17 | ~4,300 | Engines, job processing, BullMQ |
| **Validation** | 30 | ~3,100 | Zod schemas, JSON schemas, constraints |
| **Canon/continuity** | 9 | ~2,000 | 6 registries, locks, outbox |
| **Domain** | 66 | ~8,000 | Project catalog, workflow, narrative control |
| **Media providers** | 17 | ~3,500 | Video=mock, Audio=Kokoro, Image=mock, FFmpeg=real |
| **Storage** | 3 | ~400 | Local only; S3/Cloudinary throw "not implemented" |
| **Tests** | 82 | ~15,000 | 1,504 test cases, Vitest 3.2.4 |
| **Total** | **493** | **89,393** | |

## 3. What Actually Works

| Feature | Status | Evidence |
|---------|--------|----------|
| **LLM story generation** | ✅ Working | DeepSeek primary, 4 cloud fallbacks, 4x retry per provider |
| **Story Bible generation** | ✅ Working | 6-section sequential generation with empty-field retry |
| **Story Draft generation** | ✅ Working | 6-part sequential with fingerprint caching/resume |
| **Canon/continuity tracking** | ✅ Working | Append-only fact log, fencing-token locks, transactional outbox |
| **Audio TTS (Kokoro)** | ✅ Working | 54 voices, 9 languages, Python bridge, real audio output |
| **FFmpeg rendering** | ✅ Working | Concat, subtitles, audio mixing, 3 quality presets |
| **Project management** | ✅ Working | CRUD, versioning, stage gating, tenant isolation |
| **Test suite** | ✅ Working | 82 files, 1,504 cases, only 2 require external services |

## 4. What Does NOT Work / Is Stubbed

| Feature | Status | Evidence |
|---------|--------|----------|
| **Video generation** | ❌ Mock only | No real video provider adapter exists (no Veo/LTX/BFL) |
| **Image generation** | ❌ Mock only | No real image provider adapter exists |
| **S3 storage** | ❌ Not implemented | Adapter throws "not implemented" |
| **Cloudinary storage** | ❌ Not implemented | Adapter throws "not implemented" |
| **Timeline editing** | ❌ Auto-assembly only | No manual editing UI, no drag-and-drop, no trimming |
| **Animation** | ❌ None | No animation libraries, no cartoon/vector/SVG/Lottie/Remotion |
| **`/media` page** | ❌ Stub | Placeholder page |
| **`/characters` page** | ❌ Stub | Placeholder page |
| **`/admin` page** | ❌ Stub | Placeholder page |
| **MCP integration** | ❌ None | No Model Context Protocol server or client |

## 5. Over-Engineered Areas

| Area | Problem | Evidence |
|------|---------|----------|
| **6 canon registries** | NarrativeCanon, CanonFact, NarrativeRegistry, CanonicalRegistry, NarrativeGraph, ContinuityLedger — overlapping responsibilities | 9 files, ~2,000 lines for continuity tracking |
| **ASPO provider selection** | 565 lines of adaptive selection logic for 10 providers | Most users will use 1-2 providers |
| **CASNA validation pipeline** | Multi-stage canon-aware validation, 30 validation files | ~3,100 lines of schemas for LLM output validation |
| **21 BullMQ job types** | 5 queues, 21 job types for a workflow that could be simpler | Heavy async infrastructure for sequential generation |
| **66 domain files** | Project catalog, workflow, narrative control — large surface area | ~8,000 lines of domain logic |

## 6. Key Architectural Observations

### 6.1 The App Is an LLM Orchestrator, Not a Creative Tool
The entire architecture is built around **getting LLMs to produce creative content**. The UI is a 5-stage wizard (Bible → Story → Plan → Episodes → Production) that drives LLM generation jobs. There is no manual editing, no creative authoring interface, no asset management beyond auto-generated mock files.

### 6.2 Media Pipeline Is Incomplete
Video and image generation are mock-only. The only real media output is audio (Kokoro TTS) and final render (FFmpeg). This means the app cannot produce a finished video — it can only produce a storyboard with audio.

### 6.3 Canon System Is Over-Built
Six overlapping registries track narrative continuity. For a short drama platform, this is likely excessive. The system works but adds significant complexity (locks, outbox, fencing tokens, staleness stamping) that may not justify its cost.

### 6.4 No External AI Assistant Integration
The spec calls for external AI assistants (ChatGPT, Claude) to handle creative intelligence via MCP. The current architecture has zero MCP support — all AI is internal LLM API calls.

### 6.5 Storage Is Local-Only
All media assets are stored locally. S3 and Cloudinary adapters exist but throw "not implemented". This limits collaboration and deployment options.

### 6.6 Tailwind v4 Is Used, Not CSS Modules
The AGENTS.md spec mentions CSS Modules as the convention, but the codebase uses Tailwind CSS v4 (CSS-first, no config file). This is a discrepancy to resolve.

## 7. Cost Profile (Current)

| Cost Source | Status | Monthly Cost |
|-------------|--------|-------------|
| **LLM API calls** | Active — DeepSeek + 4 cloud fallbacks | Variable (pay per token) |
| **MongoDB Atlas** | Active — `cluster0.1sllugk.mongodb.net` | ~$0-10/mo (free tier likely) |
| **Redis** | Active — `redis://127.0.0.1:6379` (local) | $0 |
| **Kokoro TTS** | Active — local Python bridge | $0 |
| **FFmpeg** | Active — local binary | $0 |
| **Clerk auth** | Active | Free tier likely |
| **Storage** | Local only | $0 |

**Primary cost driver: LLM API tokens.** The restructuring goal is to eliminate this by shifting creative intelligence to external AI assistants via MCP.

## 8. Risk Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| LLM dependency — app is non-functional without LLM credits | **Critical** | MCP integration, app must work without LLM |
| No real video/image generation | **High** | Either implement real providers or reframe as pre-production tool |
| 6 canon registries — maintenance burden | **Medium** | Consolidate to 1-2 registries |
| Local-only storage — no collaboration | **Medium** | Implement S3 or keep local-only by design |
| 21 BullMQ job types — operational complexity | **Medium** | Simplify to essential jobs only |
| No manual editing UI | **High** | Add timeline editing or reframe scope |

---

**Next step:** See `CURRENT_ARCHITECTURE.md` for detailed architecture, `FEATURE_RETENTION_MATRIX.md` for feature classification, and `TARGET_ARCHITECTURE_PROPOSAL.md` for the proposed restructuring.