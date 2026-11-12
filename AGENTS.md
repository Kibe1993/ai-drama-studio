# AI Drama Studio - Agent Instructions

Welcome to **AI Drama Studio**, a production system for developing short drama screenplays and preparing media production pipelines.

## Tech Stack & Architecture

- **Framework**: Next.js 15 (App Router, Turbopack), React 19, TypeScript
- **Styling**: Tailwind CSS v4, Radix UI primitives, Lucide React
- **Database & State**: MongoDB via Mongoose (`mongoose`), Redis / BullMQ (`ioredis`, `bullmq`) for background jobs
- **Authentication**: Clerk (`@clerk/nextjs`)
- **Testing**: Vitest (`npm test`), TypeScript (`npm run typecheck`), ESLint (`npm run lint`)
- **AI Integrations**: LLM Provider Manager supporting sequential failover across Gemini, Groq, OpenRouter, Mistral, Anthropic, and OpenAI

## Architecture & Code Boundaries

1. **Modular Monolith**:
   - Route handlers (`app/api/`) must stay thin: validate auth via Clerk, validate input with Zod, verify project ownership, delegate to service layer, and return HTTP responses.
   - **Repositories** (`lib/repositories/`): Own database queries and schema operations.
   - **Services** (`lib/services/`): Own business rules and stage transitions.
   - **Adapters / Providers** (`lib/providers/`): Encapsulate external APIs (LLMs, media generators).

2. **Five Engines**:
   - **Story Engine**: Structured screenplays and versioning.
   - **Character Engine**: Character profiles, relationships, and voice profiles.
   - **Scene Engine**: Ordered scene breakdowns, director notes, shot plans.
   - **Media Engine**: Image, video, and audio generation / asset tracking.
   - **Rendering Engine**: Sequence composition, subtitles, audio mix, and final export.

3. **Pipeline Rules & Gates**:
   - `story.generate` always stops for explicit human approval before moving to characters.
   - `character.extract` requires an approved story version.
   - `scene.breakdown` requires approved story and characters.
   - `video.scene` and `render.final` currently use mock engines (`MOCK`/`UNAVAILABLE`). Do not falsely mark mock runs as completed real media or bypass the render gate.

## Key Developer Commands

- Dev Server: `npm run dev`
- Background Worker: `npm run worker`
- Type Check: `npm run typecheck`
- Unit/Integration Tests: `npm test`
