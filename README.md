# AI Drama Studio

A production system for developing short drama screenplays and preparing media production pipelines.

The app supports project management, eight selectable content categories, 1–15 minute screenplay targets, a project Story Bible with explicitly approved snapshots, episode records, and LLM generation for stories, character extraction, and scene breakdowns. Serialized episodes retain their approved starting Story Bible version. Scene breakdowns are stored as editable scene records with creator-authored shot plans. Approved character/location records and reviewed scene beats provide continuity context to later serialized episodes. Documentary/educational scripts are drafts only and require external fact research and human verification.

**Document editing**: Stories and documents are editable with a Tiptap rich-text editor that supports import ( Fountain, TXT, Markdown) and export (Fountain, TXT, Markdown, JSON). A `stageOverride` flag lets a project advance past a stage without LLM generation.

**Timeline editor**: A drag-and-drop timeline (`@dnd-kit`) lets creators reorder clips, trim start/end points, adjust per-clip audio volume, and apply transitions (crossfade, wipe, slide via FFmpeg `xfade`). The timeline is approved before rendering.

**Media management**: A filterable media gallery shows all project assets with audio preview, image thumbnails, download, and delete. A `isMock` flag distinguishes mock-generated assets from real ones.

**Rendering**: FFmpeg assembles approved timeline clips into a final MP4 with subtitles, audio mixing, music ducking, and transitions. Video generation remains mock-only; mock output is labeled and cannot satisfy the render gate or mark a production as having real media.

**MCP server**: An [MCP](https://modelcontextprotocol.io) server (`npm run mcp:server`) exposes 17 tools and 6 resources so external AI assistants (ChatGPT, Claude, etc.) can read and write project data, generate stories, extract characters, break down scenes, and manage the production pipeline. This lets the app work with zero LLM cost — the external assistant provides the creative intelligence. See [docs/MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md).

## Run it

Copy `.env.example` to `.env.local` and set:

- `MONGODB_URI`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Optional: `ADMIN_USER_IDS` for `/admin`. Story generation also reads `REDIS_URL`, `LLM_FREE_ONLY`, `LLM_PROVIDER`, `LLM_FALLBACK_PROVIDERS`, `LLM_SEQUENCE_TIMEOUT_MS`, the local Ollama variables (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`), and `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, and `MISTRAL_API_KEY`. The MCP server reads `MCP_ACTOR_USER_ID`. Image and video generation remain mock-only. Audio TTS uses a local Kokoro bridge. See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for details.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in, then create a drama from the dashboard.

To run background story, character, scene, audio, and render jobs, set `REDIS_URL` and run the worker in a second terminal:

```bash
npm run worker
```

The worker calls the configured language providers sequentially for `story.generate`, `character.extract`, and `scene.breakdown`. Free-only mode defaults on unless `LLM_FREE_ONLY=false`; the default free sequence is local Ollama (`gemma3:4b`), Groq, OpenRouter, and Mistral. Ollama needs no API key: install it, run `ollama pull gemma3:4b`, and keep the daemon running. Restart the worker after changing provider configuration. A generated story does not continue to characters until you approve it on the project page. Character and scene stages use the LLM provider manager after their approval gates. `video.scene` remains a mock engine — it reports `MOCK`/`UNAVAILABLE` and cannot satisfy the render gate or mark the project completed. Audio TTS (Kokoro) and FFmpeg rendering are real. Without Redis, the app saves the job and shows that the queue is waiting.

To expose the project to an external AI assistant via MCP, run in a third terminal:

```bash
npm run mcp:server
```

This starts the MCP server on stdio. Configure `MCP_ACTOR_USER_ID` to the Clerk user id that owns the projects the assistant should access. See [docs/MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md) for tool and resource listings.

```bash
npm test
npm run typecheck
```

## Design

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system boundaries and status rules
- [docs/PRODUCTION_PIPELINE.md](docs/PRODUCTION_PIPELINE.md) — how a story becomes a video
- [docs/CASNA.md](docs/CASNA.md) — season planning, gates, continuity, and canon
- [docs/DATABASE.md](docs/DATABASE.md) — collections and ownership
- [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md) — provider contracts and licenses
- [docs/BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md) — Redis, BullMQ, and workers
- [docs/MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md) — MCP server tools and resources
- [docs/MEDIA_STORAGE.md](docs/MEDIA_STORAGE.md) — where files live
- [docs/RENDERING.md](docs/RENDERING.md) — FFmpeg assembly
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — environment variables
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — the six runtime places
- [docs/TESTING.md](docs/TESTING.md) — what each phase must prove
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases
- [docs/RISKS.md](docs/RISKS.md) — technical risks

Licensing notes in `docs/AI_PROVIDERS.md` were checked against publisher documentation on 31 October 2026. They are not legal advice. Re-read the license before enabling a model.
