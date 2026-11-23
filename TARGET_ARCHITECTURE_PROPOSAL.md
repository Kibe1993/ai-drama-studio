# Target Architecture Proposal

**Date:** 2026-11-23
**Status:** Stage 0 forensic audit (read-only)

---

## 1. Design Principles

1. **Zero-cost by default** — App must function with no paid APIs, no subscriptions, no cloud services beyond free tiers
2. **LLM is optional, not core** — Creative intelligence comes from external AI assistants via MCP; LLM generation is an enhancement
3. **Local-first** — All media stored locally; no cloud storage required
4. **Simplicity over completeness** — Fewer registries, fewer job types, fewer providers — only what's needed
5. **Preserve working features** — Don't break what works (Kokoro, FFmpeg, project management, versioning)
6. **Strict TypeScript** — No `any`, full type safety, Zod validation for all external data
7. **Inspect before modifying** — No speculative rewriting, no duplicate architecture

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    External AI Assistant                   │
│              (ChatGPT, Claude, Cursor, etc.)              │
└──────────────────────┬──────────────────────────────────┘
                       │ MCP (Model Context Protocol)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    AI Drama Studio                        │
│                                                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐   │
│  │ Project  │  │ Document│  │  Media  │  │  Render   │   │
│  │ Manager  │  │  Store   │  │ Manager │  │  Engine   │   │
│  └─────────┘  └─────────┘  └─────────┘  └──────────┘   │
│                                                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐   │
│  │  Canon   │  │ Timeline│  │  Audio  │  │   LLM     │   │
│  │  Store   │  │  Editor  │  │  (TTS)  │  │ (optional)│   │
│  └─────────┘  └─────────┘  └─────────┘  └──────────┘   │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │              MCP Server (new)                     │    │
│  │  Tools: project, document, canon, media, render  │    │
│  │  Resources: assets, documents, canon facts       │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  MongoDB (free Atlas)  │  Redis (local)  │  Local FS    │
└─────────────────────────────────────────────────────────┘
```

## 3. Component Specifications

### 3.1 MCP Server (NEW — core of restructuring)

The MCP server exposes AI Drama Studio's capabilities to external AI assistants.

**Transport:** stdio (for local assistant integration) or HTTP+SSE (for remote)

**Tools:**
| Tool | Description |
|------|-------------|
| `project.list` | List all projects |
| `project.create` | Create a new project |
| `project.get` | Get project details |
| `project.update` | Update project metadata |
| `project.delete` | Delete a project |
| `document.get` | Get story bible, story, or episode content |
| `document.update` | Update document content (story bible, story, episode) |
| `document.import` | Import content from external source |
| `document.export` | Export document as markdown/JSON |
| `canon.query` | Query canon facts for a project |
| `canon.add` | Add a canon fact |
| `canon.validate` | Validate content against canon |
| `media.list` | List media assets for a project |
| `media.upload` | Upload a media asset |
| `media.generate_audio` | Generate TTS audio for text |
| `render.start` | Start a render job |
| `render.status` | Get render job status |

**Resources:**
| Resource | Description |
|----------|-------------|
| `project://{projectId}/bible` | Story Bible content |
| `project://{projectId}/story` | Story content |
| `project://{projectId}/episodes/{n}` | Episode content |
| `project://{projectId}/canon` | Canon facts |
| `project://{projectId}/assets` | Media asset list |
| `project://{projectId}/timeline` | Timeline data |

**Implementation:** `@modelcontextprotocol/sdk` (npm package)

### 3.2 Project Manager (KEEP + MODIFY)

- Project CRUD — unchanged
- Tenant scoping — unchanged
- Versioning — unchanged
- Stage workflow — **modified**: stages are optional, can be skipped or imported
- Add `stageOverride` field to allow manual stage progression

### 3.3 Document Store (MODIFY)

- Story Bible, Story, Episode, SeasonPlan — keep models and versioning
- **Add manual editing capability** — currently read-only display of LLM output
- **Add import capability** — accept content from MCP or file upload
- **Add export capability** — markdown, JSON, PDF

### 3.4 Media Manager (MODIFY + INVESTIGATE)

- **Audio (Kokoro TTS)** — KEEP as-is (working, zero-cost)
- **Video** — INVESTIGATE: either implement real provider or reframe as pre-production storyboard tool
- **Image** — INVESTIGATE: either implement real provider or reframe as pre-production tool
- **MediaAsset tracking** — KEEP
- **Local storage** — KEEP (zero-cost)
- Add `isMock` flag to MediaAsset for filtering

### 3.5 Render Engine (KEEP + MODIFY)

- **FFmpeg rendering** — KEEP as-is (working, zero-cost)
- **Subtitle burning** — KEEP
- **Audio mixing** — KEEP
- **Quality presets** — KEEP
- **RenderJob tracking** — KEEP
- **Timeline editing** — ADD: manual editing UI with drag-and-drop, trimming

### 3.6 Canon Store (SIMPLIFY)

**Current:** 6 registries + locks + outbox (~2,000 lines)
**Target:** 2 collections (~500 lines)

| Collection | Purpose |
|------------|---------|
| `Canon` | Consolidated canon store (facts + metadata) |
| `CanonicalEntity` | Entity registry (characters, locations, items) |

- Remove: ContinuityLedger, NarrativeRegistry, NarrativeGraph, CanonLock, CanonExtractionOutbox
- Keep: Canon consistency validation (simplified)
- Keep: Staleness tracking (simplified — `sourceCanonVersion` on artifacts)

### 3.7 Timeline Editor (NEW)

- Visual timeline with drag-and-drop
- Clip trimming and reordering
- Audio track management
- Subtitle editing
- Export to FFmpeg render

**Technology:** React + CSS (no heavy library; use native HTML5 drag-and-drop or lightweight DnD library)

### 3.8 LLM Provider (OPTIONAL — SIMPLIFY)

**Current:** 10 adapters, ASPO (565 lines), CASNA (30 files)
**Target:** 3-4 adapters, simple priority list, simplified validation

| Provider | Status |
|----------|--------|
| DeepSeek | Optional (primary if configured) |
| Groq | Optional (fallback if configured) |
| OpenRouter | Optional (fallback if configured) |
| Ollama | Optional (local, zero-cost) |

- Remove: ASPO, free-tier policy, provider health scoring
- Keep: Retry logic (4x), failover, empty-field retry, fingerprint caching
- Keep: Zod validation (consolidate from 30 to ~15 files)
- **App must work without any LLM configured** — all generation endpoints return 503 with helpful message

### 3.9 Audio TTS (KEEP)

- Kokoro provider — unchanged
- 54 voices, 9 languages
- Python bridge — unchanged
- AudioSegment model — unchanged

## 4. Simplified Job Architecture

**Current:** 5 queues, 21 job types
**Target:** 3 queues, 8 job types

| Queue | Job Types |
|-------|-----------|
| `generation` | `storyBible`, `story`, `seasonPlan`, `episode` |
| `production` | `audioGenerate`, `render` |
| `maintenance` | `cleanup` |

## 5. Simplified Domain Layer

**Current:** 66 files, ~8,000 lines
**Target:** ~30 files, ~4,000 lines

- Keep: project catalog, workflow (simplified), narrative control (simplified)
- Remove: ASPO domain logic, canon lock/outbox domain logic, complex stage gating
- Consolidate: overlapping domain utilities

## 6. Frontend Changes

### New Pages
- `/projects/[id]/timeline` — Timeline editor (NEW)
- `/projects/[id]/media` — Media management (REPLACE stub)

### Modified Pages
- `/projects/[id]/bible` — Add manual editing + import/export
- `/projects/[id]/story` — Add manual editing + import/export
- `/projects/[id]/episodes/[n]` — Add manual editing + import/export
- All production pages — Add real status, manual controls

### Retired Pages
- `/characters` stub — Replace with character management within project context
- `/admin` stub — Remove (or implement if needed)

### New Components
- `TimelineEditor` — drag-and-drop timeline
- `DocumentEditor` — rich text editor for manual content creation
- `ImportDialog` — import content from file or MCP
- `MCPStatus` — MCP server connection status indicator

## 7. Cost Profile (Target)

| Cost Source | Monthly Cost |
|-------------|-------------|
| MongoDB Atlas (free tier) | $0 |
| Redis (local) | $0 |
| Kokoro TTS (local) | $0 |
| FFmpeg (local) | $0 |
| Clerk (free tier) | $0 |
| Local storage | $0 |
| LLM API (optional) | $0 if not configured |
| **Total** | **$0** |

## 8. What the App Does After Restructuring

### Without LLM configured (zero-cost mode):
1. User creates a project
2. User (or external AI via MCP) creates/edits Story Bible, Story, Episodes
3. User generates audio via Kokoro TTS
4. User assembles timeline via drag-and-drop editor
5. User renders final video via FFmpeg
6. User exports finished product

### With LLM configured (enhanced mode):
1. All of the above, PLUS:
2. User can request LLM to generate Story Bible, Story, Episodes
3. LLM generation is optional enhancement, not required workflow
4. External AI assistant can use MCP to query project data and suggest improvements

### With external AI assistant (via MCP):
1. User opens ChatGPT/Claude/Cursor
2. AI assistant connects to AI Drama Studio via MCP
3. AI assistant can read project data, create/edit documents, query canon
4. AI assistant produces creative content, writes it back via MCP
5. User reviews in AI Drama Studio UI, generates audio, renders

## 9. Technology Additions

| Technology | Purpose | Cost |
|------------|---------|------|
| `@modelcontextprotocol/sdk` | MCP server | $0 (npm) |
| Rich text editor (Tiptap or similar) | Manual document editing | $0 (open source) |
| Drag-and-drop library (optional) | Timeline editing | $0 (open source) |

## 10. Technology Removals

| Technology | Reason |
|------------|--------|
| ASPO (565 lines) | Over-engineered, replaced by simple priority list |
| 4 canon registries | Consolidated to 2 |
| Canon locks + outbox | Unnecessary complexity |
| Free-tier policy | No longer needed |
| S3/Cloudinary adapters | Never implemented, not needed |
| ~13 BullMQ job types | Simplified to 8 |
| ~36 domain files | Consolidated to ~30 |

## 11. Lines of Code Impact

| Area | Current | Target | Change |
|------|---------|--------|--------|
| Canon/continuity | ~2,000 | ~500 | -1,500 |
| LLM providers (ASPO removed) | ~8,800 | ~6,000 | -2,800 |
| Validation (consolidated) | ~3,100 | ~2,000 | -1,100 |
| Domain (simplified) | ~8,000 | ~4,000 | -4,000 |
| Pipeline (fewer jobs) | ~4,300 | ~3,000 | -1,300 |
| MCP server (new) | 0 | ~1,500 | +1,500 |
| Timeline editor (new) | 0 | ~1,000 | +1,000 |
| Document editor (new) | 0 | ~800 | +800 |
| **Net** | **~89,400** | **~80,300** | **-9,100** |

**Result:** ~10% reduction in codebase size, with significantly reduced complexity and zero operating cost.