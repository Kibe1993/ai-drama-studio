# Testing

Status: Phase 3. `npm test` covers project rules, the mocked pipeline, Gemini story parsing, language-provider failover, and the free-only sequence. Playwright is planned for Phase 10. The default test script does not connect to Redis or call Gemini, Groq, OpenRouter, Mistral, OpenAI, Anthropic, or DeepSeek.

## Rules

- Provider tests use in-memory fakes. They do not call Gemini, Groq, OpenRouter, Mistral, OpenAI, Anthropic, DeepSeek, Black Forest Labs, LTX, or a GPU.
- `npm test` does not call a language API. `tests/story-generation.test.ts` uses a fake Gemini client. `tests/llm-failover.test.ts` uses fake provider slots. `tests/free-providers.test.ts` checks the free sequence. `tests/stage-generation.test.ts` checks character extraction and scene breakdown with fake providers. `tests/pipeline.test.ts` still uses `createMockEngines()`.
- A live language call happens only in the worker when the selected provider's API key is set.
- FFmpeg tests use fixture clips and skip when `ffmpeg` is absent, with a clear skip message.
- Ownership tests cover anonymous (401), another user (404 or 403), the owner (200), and an admin.

## By phase

| Phase | Tests |
| --- | --- |
| 1 | Project Zod schema, status transition table, repository ownership with a mocked model, protected routes reject an anonymous caller |
| 2 | Pipeline refuses scenes before an approved story. Idempotency returns the open job. Retryable and permanent errors. A run reloads from a fixture document |
| 3 | Implemented in `tests/story-generation.test.ts`. A fake client covers valid JSON, invalid JSON, schema failure, a missing key, an API failure, rate limit, and timeout. The pipeline saves one story, pauses for approval, and keeps later stages on the mock |
| 4 | Selecting a reference does not delete other reference assets. The image adapter maps a fake completed submit into a storage key |
| 5 | Reorder keeps a unique `sceneNumber` sequence. Deleting one scene leaves the others |
| 6 | A video job records provider, model, and scene id. A failed scene job leaves the other scene's asset. Cancel stops a queued job |
| 7 | A fixture render produces a file and a `RenderedVideo` row. A missing scene 2 fails the render and keeps scene 1 |
| 8 | A guided run waits for approval. An automatic run enqueues the next stage from stored state |
| 9 | Failed jobs write `billable: false`. Admin routes reject a non-admin |
| 10 | Playwright: sign in, create a project, and walk a fully mocked pipeline through to a fixture video |
