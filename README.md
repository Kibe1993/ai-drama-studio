# AI Drama Studio

A production system that turns a short story idea into a finished 1–3 minute drama.

This repository is that product. A signed-in user can manage projects and generate a real screenplay on the free tiers of Gemini, Groq, OpenRouter, and Mistral. Paid providers stay off unless `LLM_FREE_ONLY=false`. The story waits for approval. Characters, scenes, video, and the final render are still mock stages.

## Run it

Copy `.env.example` to `.env.local` and set:

- `MONGODB_URI`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Optional: `ADMIN_USER_IDS` for `/admin`. Story generation also reads `REDIS_URL`, `LLM_FREE_ONLY`, `LLM_PROVIDER`, `LLM_FALLBACK_PROVIDERS`, `LLM_SEQUENCE_TIMEOUT_MS`, and `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, and `MISTRAL_API_KEY`. Image, video, speech, and storage variables are still unused. See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in, then create a drama from the dashboard.

To move a project through the mocked production stages, set `REDIS_URL` and run the worker in a second terminal:

```bash
npm run worker
```

The worker calls free-tier language providers, one at a time, for `story.generate`. Free-only mode is on unless `LLM_FREE_ONLY=false`. The default free order is Gemini, Groq, OpenRouter, and Mistral. OpenAI, Anthropic, and DeepSeek are not called in that mode. Restart the worker after changing those variables. A configured API key does not add a provider unless its name is in the sequence and its model is on the verified free list. If story generation fails, Develop story retries it. Character extraction, scene breakdown, scene video, and the final render stay on the mock engines. Without Redis, the app still saves the job and shows that the queue is waiting. A generated story does not continue to characters until you approve it on the project page.

```bash
npm test
npm run typecheck
```

## Design

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/PRODUCTION_PIPELINE.md](docs/PRODUCTION_PIPELINE.md)
- [docs/DATABASE.md](docs/DATABASE.md)
- [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md)
- [docs/BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md)
- [docs/MEDIA_STORAGE.md](docs/MEDIA_STORAGE.md)
- [docs/RENDERING.md](docs/RENDERING.md)
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/TESTING.md](docs/TESTING.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/RISKS.md](docs/RISKS.md)

Licensing notes in `docs/AI_PROVIDERS.md` were checked on 31 October 2026. They are not legal advice.

## Read these first

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system boundaries and status rules
- [docs/PRODUCTION_PIPELINE.md](docs/PRODUCTION_PIPELINE.md) — how a story becomes a video
- [docs/DATABASE.md](docs/DATABASE.md) — collections and ownership
- [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md) — provider contracts and licenses
- [docs/BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md) — Redis, BullMQ, and workers
- [docs/MEDIA_STORAGE.md](docs/MEDIA_STORAGE.md) — where files live
- [docs/RENDERING.md](docs/RENDERING.md) — FFmpeg assembly
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — environment variables
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — the six runtime places
- [docs/TESTING.md](docs/TESTING.md) — what each phase must prove
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases
- [docs/RISKS.md](docs/RISKS.md) — technical risks

Licensing notes in `docs/AI_PROVIDERS.md` were checked against publisher documentation on 31 October 2026. They are not legal advice. Re-read the license before enabling a model.
