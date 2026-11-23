# Feature Retention Matrix

**Date:** 2026-11-23
**Status:** Stage 0 forensic audit (read-only)

Each feature is classified as:
- **KEEP** — Retain as-is, still valuable
- **MODIFY** — Retain but restructure/refactor
- **REPLACE** — Replace with new implementation
- **RETIRE** — Remove entirely
- **INVESTIGATE** — Needs further analysis before decision

---

## 1. Infrastructure & Core

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| Next.js 15 App Router | **KEEP** | Modern, well-supported, works well |
| React 19 | **KEEP** | Current, stable |
| TypeScript strict mode | **KEEP** | Required by spec |
| Tailwind CSS v4 | **KEEP** | Already in use, CSS-first config works |
| Radix UI primitives | **KEEP** | Accessible, minimal |
| Lucide React icons | **KEEP** | Lightweight, sufficient |
| React Hook Form | **KEEP** | Form handling works well |
| React Query (TanStack) | **KEEP** | Data fetching standard |
| Zod validation | **KEEP** | Runtime validation essential |
| Clerk authentication | **KEEP** | Working, free tier sufficient |
| MongoDB + Mongoose | **KEEP** | Working, free Atlas tier sufficient |
| Redis + BullMQ | **MODIFY** | Keep Redis for cache/queue but simplify from 21 job types to ~5-8 essential jobs |
| Local storage provider | **KEEP** | Aligns with zero-cost goal |
| S3 storage adapter (stub) | **RETIRE** | Not implemented, not needed for local-first approach |
| Cloudinary adapter (stub) | **RETIRE** | Not implemented, not needed |

## 2. Project Management

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| Project CRUD | **KEEP** | Core functionality |
| Project listing page | **KEEP** | Core UI |
| Project workspace | **KEEP** | Core UI |
| Tenant scoping (clerkUserId) | **KEEP** | Security essential |
| Project catalog domain | **MODIFY** | Simplify from 66 domain files — too much surface area |
| Versioning (StoryBible, Story, SeasonPlan) | **KEEP** | Valuable for tracking creative iterations |

## 3. LLM Provider Layer

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| 10 provider adapters | **MODIFY** | Keep adapters but reduce active set. App must work without LLM. Keep DeepSeek, Groq, OpenRouter as optional. |
| StoryProviderManager | **MODIFY** | Simplify — remove ASPO, use simple priority list. Keep retry/failover. |
| ASPO (565 lines) | **RETIRE** | Over-engineered for 1-2 provider usage. Replace with simple priority + failover. |
| CASNA validation pipeline | **MODIFY** | Keep Zod schemas, simplify the multi-stage pipeline. |
| 30 validation files | **MODIFY** | Consolidate to ~10-15 essential schemas. |
| Provider retry logic (4x) | **KEEP** | Working well, recently improved |
| Empty-field retry for Story Bible | **KEEP** | Working well, recently added |
| Fingerprint caching/resume | **KEEP** | Valuable for long generations |
| LLM generation as primary workflow | **REPLACE** | Replace with MCP-assisted workflow. LLM becomes optional enhancement, not core. |
| Free-tier policy enforcement | **RETIRE** | No longer needed if LLM is optional |

## 4. Generation Pipeline

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| 5-stage workflow (Bible→Story→Plan→Episodes→Production) | **MODIFY** | Keep stages but make them optional/manual. User should be able to skip stages or import content. |
| Stage gating | **MODIFY** | Keep gates but allow manual override / import |
| Story Bible generation | **MODIFY** | Keep as optional LLM feature. User can also manually create or import via MCP. |
| Story Draft generation | **MODIFY** | Keep as optional LLM feature. User can also manually create or import. |
| Season Plan generation | **MODIFY** | Keep as optional LLM feature. |
| Episode generation | **MODIFY** | Keep as optional LLM feature. |
| Sequential generation (6 sections/parts) | **KEEP** | Good pattern for long content |
| GenerationJob tracking | **KEEP** | Useful for status/progress |
| CostEvent tracking | **KEEP** | Useful for cost monitoring |
| 21 BullMQ job types | **MODIFY** | Reduce to ~8-10 essential jobs |
| 5 BullMQ queues | **MODIFY** | Reduce to 3 (generation, production, maintenance) |

## 5. Canon/Continuity System

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| NarrativeCanon | **MODIFY** | Consolidate into single canon store |
| CanonFact | **MODIFY** | Merge into NarrativeCanon |
| ContinuityLedger | **RETIRE** | Over-engineered, staleness can be tracked simpler |
| NarrativeRegistry | **RETIRE** | Overlaps with CanonicalRegistry |
| CanonicalRegistry | **MODIFY** | Keep as single entity registry |
| NarrativeGraph | **RETIRE** | Over-engineered for short dramas |
| CanonLock (fencing tokens) | **RETIRE** | Unnecessary complexity for single-user or small-team usage |
| CanonExtractionOutbox | **RETIRE** | Unnecessary — extract canon synchronously |
| Staleness stamping | **MODIFY** | Keep simpler version — track canon version on artifacts |
| Canon consistency validation | **KEEP** | Valuable for continuity checking |

## 6. Media Generation

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| Mock video provider | **REPLACE** | Replace with real provider OR reframe as pre-production tool (storyboard only) |
| Kokoro TTS audio | **KEEP** | Real, working, zero-cost, 54 voices |
| Mock image provider | **REPLACE** | Replace with real provider OR reframe as pre-production tool |
| FFmpeg render engine | **KEEP** | Real, working, zero-cost |
| MediaAsset tracking | **KEEP** | Useful for asset management |
| ShotProductionRecord | **KEEP** | Useful for production tracking |

## 7. Rendering & Editing

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| FFmpeg rendering | **KEEP** | Real, working |
| Timeline model | **MODIFY** | Keep but add manual editing support |
| Auto-assembly only | **REPLACE** | Add manual timeline editing UI (drag-and-drop, trimming) |
| Subtitle burning | **KEEP** | Working |
| Audio mixing | **KEEP** | Working |
| 3 quality presets | **KEEP** | Useful |
| RenderJob tracking | **KEEP** | Useful |

## 8. Animation

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| Animation (none) | **INVESTIGATE** | Spec mentions animation. Need to clarify: 2D cartoon? Motion graphics? Lottie? Remotion? This is a major new feature. |

## 9. Frontend UI

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| StudioShell layout | **KEEP** | Working well |
| Sidebar navigation | **KEEP** | Working well |
| WorkflowStepper | **MODIFY** | Make stages optional, not strictly sequential |
| Project cards/list | **KEEP** | Working well |
| Story Bible editor | **MODIFY** | Add manual editing + import capability |
| Story editor | **MODIFY** | Add manual editing + import capability |
| Episode editor | **MODIFY** | Add manual editing + import capability |
| Production panels (video, audio, rendering) | **MODIFY** | Add real status, manual controls |
| `/media` stub page | **REPLACE** | Implement real media management page |
| `/characters` stub page | **REPLACE** | Implement real character management page |
| `/admin` stub page | **INVESTIGATE** | Determine if admin functionality is needed |

## 10. MCP Integration

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| MCP server | **NEW** | Add MCP server to expose project data, documents, assets to external AI assistants |
| MCP tools (project CRUD) | **NEW** | Allow external AI to create/read/update projects |
| MCP tools (document editing) | **NEW** | Allow external AI to edit story bible, story, episodes |
| MCP tools (canon queries) | **NEW** | Allow external AI to query/update canon |
| MCP resources (assets) | **NEW** | Expose media assets as MCP resources |

## 11. Testing

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| Vitest framework | **KEEP** | Working well |
| 82 test files | **MODIFY** | Update tests for restructured code, remove tests for retired features |
| Mocked providers in tests | **KEEP** | Essential for no-cost testing |
| Kokoro integration test (auto-skip) | **KEEP** | Valuable for verifying real TTS |
| MongoDB integration test (auto-skip) | **KEEP** | Valuable for verifying real DB |

## 12. Documentation

| Feature | Classification | Rationale |
|---------|---------------|-----------|
| docs/ (17 files) | **MODIFY** | Update for restructured architecture |
| `docs/TESTING.md` | **MODIFY** | Stale, references "Phase 3", needs update |
| `.env.example` | **MODIFY** | Simplify — remove unused provider vars |
| AGENTS.md | **MODIFY** | Update for new architecture |

---

## Summary Counts

| Classification | Count | Percentage |
|----------------|-------|------------|
| **KEEP** | 32 | 41% |
| **MODIFY** | 28 | 36% |
| **REPLACE** | 7 | 9% |
| **RETIRE** | 9 | 12% |
| **INVESTIGATE** | 2 | 3% |
| **NEW** | 5 | — |
| **Total** | 78 + 5 new | — |

**Key takeaway:** ~77% of features are retained (KEEP + MODIFY). The restructuring is primarily about **simplification** (retiring over-engineered systems) and **reframing** (LLM from core to optional, adding MCP). Only 9% needs full replacement.