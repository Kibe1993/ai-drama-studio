# AI Drama Studio - Agent Instructions

Welcome to **AI Drama Studio**, a production system for developing short drama screenplays and preparing media production pipelines.

## Tech Stack & Architecture

- **Framework**: Next.js 15 (App Router, Turbopack), React 19, TypeScript
- **Styling**: Tailwind CSS v4, Radix UI primitives, Lucide React
- **Database & State**: MongoDB via Mongoose (`mongoose`), Redis / BullMQ (`ioredis`, `bullmq`) for background jobs
- **Authentication**: Clerk (`@clerk/nextjs`)
- **Testing**: Vitest (`npm test`), TypeScript (`npm run typecheck`), ESLint (`npm run lint`)
- **AI Integrations**: LLM Provider Manager with sequential failover (Gemini, Groq, OpenRouter, Mistral, Anthropic, OpenAI) + MCP server for external AI assistants
- **Rich Text**: Tiptap (`@tiptap/react`, `@tiptap/starter-kit`) for document editing
- **Drag & Drop**: @dnd-kit for timeline clip reordering

## Architecture & Code Boundaries

1. **Modular Monolith**:
   - Route handlers (`app/api/`) must stay thin: validate auth via Clerk, validate input with Zod, verify project ownership, delegate to service layer, and return HTTP responses.
   - **Repositories** (`lib/repositories/`): Own database queries and schema operations.
   - **Services** (`lib/services/`): Own business rules and stage transitions.
   - **Adapters / Providers** (`lib/providers/`): Encapsulate external APIs (LLMs, media generators).

2. **Five Engines**:
   - **Story Engine**: Structured screenplays and versioning with rich text editing and import/export.
   - **Character Engine**: Character profiles, relationships, and voice profiles.
   - **Scene Engine**: Ordered scene breakdowns, director notes, shot plans.
   - **Media Engine**: Image, video, and audio generation / asset tracking with media management page.
   - **Rendering Engine**: Sequence composition, subtitles, audio mix, transitions, and final export.

3. **Pipeline Rules & Gates**:
   - `story.generate` always stops for explicit human approval before moving to characters.
   - `character.extract` requires an approved story version.
   - `scene.breakdown` requires approved story and characters.
   - `video.scene` and `render.final` currently use mock engines (`MOCK`/`UNAVAILABLE`). Do not falsely mark mock runs as completed real media or bypass the render gate.

4. **Background Queues** (3 queues):
   - `generation` — LLM jobs (story, character, scene, canon, assembly)
   - `production` — audio TTS + FFmpeg render
   - `maintenance` — mock image/video + media validation

5. **MCP Server**:
   - `lib/mcp/server.ts` exposes 17 tools + 6 resources for external AI assistants.
   - Run with `npm run mcp:server` (stdio transport).
   - Config: `MCP_ACTOR_USER_ID` env var.

6. **Timeline Editor**:
   - `components/timeline/TimelineEditor.tsx` — drag-and-drop clip reordering, trimming, audio volume.
   - Per-clip transitions: crossfade, wipe, slide (via FFmpeg `xfade` filter).
   - API: `GET/POST/PATCH /api/.../timeline` + `POST /api/.../timeline/approve`.

7. **Media Management**:
   - `components/media/MediaGallery.tsx` — filterable asset grid with audio preview, image thumbnails, download, delete.
   - `isMock` flag on `MediaAsset` distinguishes mock-generated from real assets.
   - API: `GET /api/.../media` (filtered, paginated) + `DELETE /api/.../media/[assetId]`.

## Key Developer Commands

- Dev Server: `npm run dev`
- Background Worker: `npm run worker`
- MCP Server: `npm run mcp:server`
- Type Check: `npm run typecheck`
- Unit/Integration Tests: `npm test`
