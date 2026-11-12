# Implementation roadmap

Updated: 12 November 2026

## Current state

- Project management, authentication, MongoDB persistence, and BullMQ orchestration are implemented.
- Story, character, and scene breakdown call the configured LLM sequence. Paid LLM providers are excluded while `LLM_FREE_ONLY=true`.
- Eight production categories and 1–15 minute screenplay targets are configurable.
- The Story Bible has creator-approved immutable snapshots. Serialized episodes retain the snapshot version they were created from.
- Episodes, production scenes, canonical characters/locations, and per-scene story beats are durable records. Scene details and creator-authored shot plans can be edited before scene approval. Only stage-approved canon is fed into later serialized episodes.
- Video and final rendering remain mocks and are reported as unavailable. No completed video is claimed without validated stored media.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Product and architecture handover | Complete |
| 1 | Next.js app, MongoDB, Clerk, project CRUD and dashboard | Complete |
| 2 | Production runs, BullMQ, Redis, jobs, worker and mock engines | Complete; mock media cannot complete a production |
| 3 | Free-only LLM manager, screenplay generation and approval, character extraction, scene breakdown | Complete for text stages |
| 4 | Truthful media state, project categories, production modes and longer screenplay targets | Complete |
| 5 | Story Bible, episodes, persistent scenes, canonical characters/locations, and reviewed story beats | Implemented for new runs; legacy run history is not backfilled |
| 6 | MediaAsset and storage foundation; later, one verified video provider only if free eligibility and usage limits are enforceable | Local storage, owner-checked reads, and dry-run orphan audit implemented. Probe parser exists, but FFprobe is unavailable on this machine; no verified free video provider is active |
| 7 | Local Kokoro adapter and FFmpeg rendering worker, after local runtime and tool availability are verified | Not started |
| 8 | Timeline editing, variants, preview and download from actual stored media | Not started |
| 9 | Usage limits, provider controls and admin usage views | Not started |
| 10 | Integration coverage and production limits documentation | Ongoing |

## Next work

Next verify an FFprobe installation and run the probe on a real test media fixture. Then connect asset persistence to a controlled worker stage. Do not add paid video fallbacks or claim availability for a free tier that cannot be verified and bounded.

Each phase should end with a report of implementation, tests, known limits, and the next dependency. Do not start an unrelated phase in the same increment.
