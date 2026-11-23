# LM Studio Integration and Testing

## Overview

LM Studio is integrated as a local LLM provider in AI Drama Studio. It uses LM Studio's OpenAI-compatible API at `http://127.0.0.1:1234/v1` and follows the existing provider architecture — no second provider-management system was created.

## Architecture Integration Point

LM Studio is wired into the existing provider registry (`lib/providers/llm/registry.ts`) as a new provider ID `"lmstudio"`. The adapter (`lib/providers/llm/lmstudio.ts`) uses the existing `chatJson` and `bindChatStages` utilities — the same OpenAI Chat Completions code path used by the OpenAI, Groq, and Mistral adapters — with `baseURL` pointing to LM Studio's local server.

**Key files:**

| File | Role |
|------|------|
| `lib/providers/llm/lmstudio.ts` | LM Studio adapter (env readers, health check, provider class) |
| `lib/providers/llm/registry.ts` | Provider registry (wired `lmstudio` into IDs, adapter, credential check, exclusive mode) |
| `lib/providers/llm/freePolicy.ts` | Free-tier policy (LM Studio is always free) |
| `tests/lmstudio-provider.test.ts` | Unit tests for adapter (29 tests) |
| `tests/lmstudio-exclusive-mode.test.ts` | Exclusive mode tests (15 tests) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LMSTUDIO_BASE_URL` | `http://127.0.0.1:1234/v1` | LM Studio OpenAI-compatible API endpoint |
| `LMSTUDIO_MODEL` | `qwen3-4b-instruct-2507` | Model identifier loaded in LM Studio |
| `LMSTUDIO_API_KEY` | `lm-studio` | Dummy API key (LM Studio does not require a real key) |
| `LMSTUDIO_TIMEOUT_MS` | `900000` | Default request timeout (15 minutes) |
| `LMSTUDIO_SECTION_TIMEOUT_MS` | `600000` | Story Bible section timeout (10 minutes) |
| `LMSTUDIO_STORY_TIMEOUT_MS` | `900000` | Story Draft timeout (15 minutes) |
| `LMSTUDIO_ENABLED` | `true` | Set to `false` to disable LM Studio |
| `LLM_TEST_MODE` | (unset) | Set to `lmstudio` for exclusive testing mode |

## Starting LM Studio's API Server

1. Open LM Studio application.
2. Go to the **Developer** tab (or **Local Server** tab depending on version).
3. Start the server — it listens on `http://127.0.0.1:1234` by default.
4. Load the model:

```powershell
lms load qwen3-4b-instruct-2507
```

5. Verify the server is running:

```powershell
curl http://127.0.0.1:1234/v1/models
```

The response should list `qwen3-4b-instruct-2507` in the `data` array.

## Verifying Connectivity

### Health Check

The `checkLmStudioHealth()` function queries `GET /v1/models` and returns one of three states:

| Status | Meaning |
|--------|---------|
| `unavailable` | LM Studio server is not running (connection refused) |
| `server_running` | API server is up but the configured model is not loaded |
| `model_loaded` | Model is loaded and ready for generation |

### From the application

When `LLM_TEST_MODE=lmstudio` is set, the application logs `"exclusive test mode active"` at startup. All LLM requests go to LM Studio only.

## Enabling Exclusive Testing Mode

Add these variables to `.env` (or `.env.local`):

```env
LLM_TEST_MODE=lmstudio
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
LMSTUDIO_MODEL=qwen3-4b-instruct-2507
LMSTUDIO_API_KEY=lm-studio
LMSTUDIO_ENABLED=true
```

When exclusive mode is active:
- All LLM generation requests go to LM Studio only.
- No other provider (Ollama, Groq, OpenRouter, Mistral, Gemini, OpenAI, Anthropic, DeepSeek, Kimi) is attempted.
- No cloud fallback occurs.
- If LM Studio fails, the actual failure is reported clearly.
- ASPO availability management and task routing are disabled (single-provider mode).

## Running Tests

### Unit tests (adapter)

```bash
npx vitest run tests/lmstudio-provider.test.ts
```

Tests: environment readers, provider construction, health check (unavailable, server running, model loaded, error handling).

### Exclusive mode tests

```bash
npx vitest run tests/lmstudio-exclusive-mode.test.ts
```

Tests: `buildSlots` returns only LM Studio, no cloud providers in exclusive mode, reversible by unsetting `LLM_TEST_MODE`, failure reporting without fallback, timeout configuration.

### Regression tests

```bash
npx vitest run tests/ollama-last-resort-fallback.test.ts tests/ollama-provider.test.ts tests/provider-management.test.ts tests/free-providers.test.ts
```

### Progressive testing (manual, against real LM Studio)

**Test A — Provider connectivity:**

```bash
# With LM Studio running and model loaded:
curl http://127.0.0.1:1234/v1/models
```

**Test B — Basic generation:**
Start the dev server with `LLM_TEST_MODE=lmstudio` and trigger a simple generation task (e.g. episode suggestion).

**Test C — JSON generation:**
Trigger a Story Bible section generation (e.g. Identity section) and verify the JSON response parses and validates.

**Test D — Story Bible Identity:**
Use the actual Story Bible Identity task through the application UI or API.

**Test E — Remaining Story Bible sections:**
Proceed through World, Characters, Narrative, Guidelines, and Canon sections individually.

**Test F — Story Draft:**
Only after Story Bible tests are evaluated, trigger Story Draft generation and record prompt size, generation time, completion status, and validation results.

## Disabling Testing Mode

To return to normal multi-provider operation:

1. Remove or comment out `LLM_TEST_MODE=lmstudio` in `.env`.
2. Restart the application.

The application will use `LLM_PROVIDER` and `LLM_FALLBACK_PROVIDERS` as before. All existing providers, adapters, fallback mechanisms, and ASPO availability management are preserved.

## Restoring Previous Provider Configuration

No existing providers were deleted or disabled. The previous configuration (e.g. `LLM_PROVIDER=ollama` with `LLM_FALLBACK_PROVIDERS=groq,openrouter,mistral`) works unchanged when `LLM_TEST_MODE` is unset.

## Known Limitations

- LM Studio's `json_schema` strict mode support may vary by model and runtime. The adapter uses `strict: false` to avoid rejection.
- The model runs with 8192-token context. Large prompts may exceed this and fail validation — the adapter does not silently truncate.
- Story Draft generation on a 4B local model can take several minutes. The 900-second timeout accommodates this.
- LM Studio must be running and the model must be loaded before starting the application in exclusive mode.
- The health check queries `/v1/models` — if LM Studio's API changes, the health check may need updating.

## Observed Performance

(To be filled in during progressive testing — Test A through Test F.)