# Testing

Status: Phase 2. `npm test` covers project rules and the mocked pipeline: guided completion, a failed scene leaving the other scene, retries, reload, and restart reconciliation. Playwright is planned for Phase 10. The default test script does not connect to Redis.

## Rules

- Provider tests use in-memory fakes. They do not call Gemini, Black Forest Labs, LTX, or a GPU.
- A test may call Gemini only when `GEMINI_API_KEY` is set and the test file is explicitly opt-in. The default test script will not include that file.
- FFmpeg tests use fixture clips and skip when `ffmpeg` is absent, with a clear skip message.
- Ownership tests cover anonymous (401), another user (404 or 403), the owner (200), and an admin.

## By phase

| Phase | Tests |
| --- | --- |
| 1 | Project Zod schema, status transition table, repository ownership with a mocked model, protected routes reject an anonymous caller |
| 2 | Pipeline refuses scenes before an approved story. Idempotency returns the open job. Retryable and permanent errors. A run reloads from a fixture document |
| 3 | Zod accepts a valid screenplay and rejects one whose duration does not fit a one-minute project. The Gemini adapter test uses a mocked HTTP response, not a live call |
| 4 | Selecting a reference does not delete other reference assets. The image adapter maps a fake completed submit into a storage key |
| 5 | Reorder keeps a unique `sceneNumber` sequence. Deleting one scene leaves the others |
| 6 | A video job records provider, model, and scene id. A failed scene job leaves the other scene's asset. Cancel stops a queued job |
| 7 | A fixture render produces a file and a `RenderedVideo` row. A missing scene 2 fails the render and keeps scene 1 |
| 8 | A guided run waits for approval. An automatic run enqueues the next stage from stored state |
| 9 | Failed jobs write `billable: false`. Admin routes reject a non-admin |
| 10 | Playwright: sign in, create a project, and walk a fully mocked pipeline through to a fixture video |
