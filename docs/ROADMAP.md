# Implementation roadmap

Status: Phases 1 and 2 are implemented. Phases 3–10 have not started. The Phase 2 engines are mocks.

Each phase ends with a report: what was built, files, decisions, test results, and what the next phase needs. The next phase does not start in the same step.

| Phase | Builds | Done when | Depends on |
| --- | --- | --- | --- |
| 0 | This design | Documents describe a standalone app | Complete |
| 1 | Next.js app, MongoDB connection, core models, Clerk, repositories, services, Zod, project CRUD, dashboard | Implemented. A signed-in user can create, list, edit, duplicate, archive, restore, and delete a project | Clerk keys and `MONGODB_URI` |
| 2 | `ProductionRun`, pipeline service, BullMQ, Redis, job documents, mocked engines | Implemented. A mocked run moves story → characters → scenes → media → render, survives a reload, and rejects illegal transitions | `REDIS_URL` and `npm run worker` for a live queue |
| 3 | `LLMProvider`, Gemini adapter, story Zod schema, versions, story editor | A story version is stored from a mocked Gemini response. A live call happens only if `GEMINI_API_KEY` is set, and the report says which happened | Phase 2 jobs |
| 4 | Character profiles and one image adapter (BFL, FLUX.2 klein 4B) | Reference images are assets that can be selected and passed forward. Without an image key, profiles still save and the adapter reports unavailable | Image provider key for a live test |
| 5 | Scene breakdown and editor | Scenes are ordered, editable, and individually regeneratable as data | An approved story |
| 6 | One video adapter (LTX hosted) and Kokoro speech | One scene clip and one dialogue asset can be produced and stored. Wan 2.2 stays behind the same interface, off until a GPU service exists | LTX key for a live video test. Kokoro runtime on the worker for a live audio test |
| 7 | FFmpeg worker | Two fixture clips assemble, upload, and show as a rendered video | FFmpeg on the worker |
| 8 | Guided and automatic modes, resume, per-scene regenerate, preview, download | A project can finish on mocks end to end, and on live providers only where keys exist | Phases 3–7 |
| 9 | Usage events, limits, admin views, provider enablement | Admin can see jobs and costs. Secrets are not in the payload | Phase 2 jobs |
| 10 | Broader tests and an honest limits document | Unit, integration, and the mocked end-to-end path pass. Known gaps are listed from observed behavior | All previous phases |

Out of scope until after Phase 8: payments, lip sync, music generation, Wan A14B, several video providers at once, and microservices.
