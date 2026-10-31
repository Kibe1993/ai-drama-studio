# AI Drama Studio

A production system that turns a short story idea into a finished 1–3 minute drama.

This repository is that product. Phase 1 is the signed-in studio: create, edit, duplicate, archive, restore, and delete projects. Story generation, media, and rendering are not built yet.

## Run it

Copy `.env.example` to `.env.local` and set:

- `MONGODB_URI`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Optional: `ADMIN_USER_IDS` for `/admin`. Provider, Redis, and storage variables are unused until later phases. See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in, then create a drama from the dashboard.

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
