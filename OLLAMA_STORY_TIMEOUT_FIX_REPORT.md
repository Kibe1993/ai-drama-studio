# Ollama Story Draft Timeout Fix Report

## 1. Root Cause

Story Draft generation via Ollama was cancelled at ~240 seconds with `partialChars=0` because two application-imposed caps chained to produce a 240-second effective budget:

1. **`ollamaTimeoutMs()`** (`ollama.ts:105-108`) read `OLLAMA_TIMEOUT_MS=240000` from `.env` and capped it at `Math.min(300_000, Math.max(10_000, parsed))` = 240,000 ms. This was stored as `slot.timeoutMs` in the registry.

2. **`sequenceTimeoutMs()`** (`manager.ts:228-233`) returned `DEFAULT_SEQUENCE_TIMEOUT_MS = 300_000` (capped at `Math.min(300_000, ...)`). This became the sequence deadline.

3. In `runSequence` (`manager.ts:722-728`), the per-attempt budget was `Math.min(slotCap, remaining)` = `Math.min(240_000, ~290_000)` = **240,000 ms**. The signal `AbortSignal.timeout(240_000)` at `manager.ts:740` was the timeout owner.

4. The signal propagated through the registry slot wrapper → `OllamaLLMProvider.generateStory` → `ollamaChat` → `fetch({ signal })`. At 240 seconds, the fetch aborted.

5. Because Story Draft is **non-streaming** (`stream: false`), Ollama sent nothing back during prompt_eval. When the signal fired, `partialChars=0` — the model was still processing the input prompt.

6. The undici global dispatcher's `bodyTimeout` was previously raised to 600 s, but the 240 s signal fired first, so it was not the bottleneck.

**This was entirely an application-imposed timeout, not an Ollama crash.**

## 2. Files Modified

| File | Change |
|------|--------|
| `lib/providers/llm/ollama.ts` | Added `DEFAULT_OLLAMA_STORY_TIMEOUT_MS = 900_000`, `ollamaStoryTimeoutMs()` function, `storyTimeoutMs` field on `OllamaLLMProvider`, `storyTimeoutMs` in `OllamaOptions`. Updated `generateStory()` to use `this.storyTimeoutMs` for the fallback signal and `ollamaChat` timeout. Raised undici dispatcher `bodyTimeout`/`headersTimeout` to `max(section, story)` = 900 s. Enhanced timeout log with `configuredTimeoutMs`, `signalSource`, `abortedBy`. |
| `lib/providers/llm/manager.ts` | Added `storyTimeoutMs?: number` to `ProviderSlot`. In `runSequence`: when `task === "story"`, uses `slot.storyTimeoutMs` as `slotCap`; raises `sequenceMs` to `max(baseSequenceMs, maxStoryTimeoutMs)` so the sequence deadline accommodates the story budget. Added `task` and `slotCap` to "provider attempt" log. |
| `lib/providers/llm/registry.ts` | Imported `ollamaStoryTimeoutMs`. Added `storyTimeoutMs: ollamaStoryTimeoutMs(env)` to the Ollama slot and `OllamaLLMProvider` constructor. |
| `.env` | Added `OLLAMA_STORY_TIMEOUT_MS=900000`. |
| `.env.example` | Added documented `# OLLAMA_STORY_TIMEOUT_MS=900000` with explanation. |
| `tests/ollama-story-timeout.test.ts` | **New file** — 18 tests covering: `ollamaStoryTimeoutMs` config, registry slot wiring, manager budget allocation (900 s default, custom values, 700 s success, >900 s timeout, no 240/300 s clamp), ordinary tasks retain 240 s, cloud providers unchanged, parent cancellation, ASPO failover retryability. |
| `tests/ollama-instrumentation.test.ts` | Updated timeout log assertion: `timeoutMs` → `configuredTimeoutMs`, added `signalSource` and `abortedBy` checks. |

## 3. Old and New Timeout Behavior

### Old Behavior

| Task | Per-attempt cap | Sequence cap | Effective budget |
|------|----------------|--------------|------------------|
| Story Draft (Ollama) | 240 s (`ollamaTimeoutMs`) | 300 s (`sequenceTimeoutMs`) | **240 s** |
| Story Bible section (Ollama) | 600 s (`ollamaSectionTimeoutMs`) | 300 s (`sequenceTimeoutMs`) | **~300 s** (bounded by sequence) |
| Characters/Scenes (Ollama) | 240 s (`ollamaTimeoutMs`) | 300 s (`sequenceTimeoutMs`) | **240 s** |
| Any cloud provider | 90 s (`DEFAULT_PROVIDER_TIMEOUT_MS`) | 300 s (`sequenceTimeoutMs`) | **90 s** |

### New Behavior

| Task | Per-attempt cap | Sequence cap | Effective budget |
|------|----------------|--------------|------------------|
| Story Draft (Ollama) | **900 s** (`ollamaStoryTimeoutMs`) | **900 s** (raised to `max(300s, 900s)`) | **900 s** |
| Story Bible section (Ollama) | 600 s (`ollamaSectionTimeoutMs`) | 300 s (`sequenceTimeoutMs`) | ~300 s (unchanged) |
| Characters/Scenes (Ollama) | 240 s (`ollamaTimeoutMs`) | 300 s (`sequenceTimeoutMs`) | 240 s (unchanged) |
| Any cloud provider | 90 s (`DEFAULT_PROVIDER_TIMEOUT_MS`) | 300 s (`sequenceTimeoutMs`) | 90 s (unchanged) |

### Configuration

| Env var | Default | Range | Scope |
|---------|---------|-------|-------|
| `OLLAMA_TIMEOUT_MS` | 240,000 | 10,000–300,000 | Ordinary Ollama tasks (characters, scenes, etc.) |
| `OLLAMA_SECTION_TIMEOUT_MS` | 600,000 | 10,000–600,000 | Story Bible section attempts |
| `OLLAMA_STORY_TIMEOUT_MS` | **900,000** | 10,000–3,600,000 | **Story Draft only** (new) |
| `LLM_SEQUENCE_TIMEOUT_MS` | 300,000 | 15,000–300,000 | Base sequence budget (raised automatically for story tasks) |

## 4. Confirmation: Manager Respects the 900-Second Budget

The manager now uses a two-level mechanism for Story Draft:

1. **Per-attempt cap** (`manager.ts:734-739`): When `task === "story"` and `slot.storyTimeoutMs` is set, `slotCap = slot.storyTimeoutMs` (900,000 ms for Ollama). This replaces the old `slot.timeoutMs` (240,000 ms) for the story task only.

2. **Sequence deadline** (`manager.ts:640-653`): When `task === "story"`, `sequenceMs = Math.max(baseSequenceMs, storyMaxMs)` where `storyMaxMs` is the largest `storyTimeoutMs` across eligible slots. This ensures the sequence deadline (previously capped at 300 s) is raised to at least 900 s for Story Draft, so the per-attempt signal is the sole authority for cancellation.

3. **Effective budget** (`manager.ts:742`): `budget = Math.min(slotCap, ...)` = `Math.min(900_000, ~900_000)` = **900,000 ms**.

4. **Signal** (`manager.ts:744`): `AbortSignal.timeout(900_000)` — fires at 900 seconds.

5. **HTTP layer**: The undici global dispatcher's `bodyTimeout` and `headersTimeout` are raised to `max(600_000, 900_000)` = 900,000 ms, so undici does not abort before the signal.

**No hidden 240-second or 300-second cap remains in the path for Story Draft.** The 240 s cap (`ollamaTimeoutMs`) still applies to ordinary tasks (characters, scenes). The 300 s cap (`sequenceTimeoutMs`) still applies as the base sequence budget for non-story tasks.

## 5. Test Results

### New tests (`tests/ollama-story-timeout.test.ts` — 18 tests, all pass)

| Category | Tests |
|----------|-------|
| `ollamaStoryTimeoutMs` configuration | 5 (default, custom, min clamp, max clamp, blank) |
| Registry slot wiring | 3 (Ollama slot, custom env, cloud slots undefined) |
| Manager budget allocation | 5 (900 s logged, 700 s succeeds, >900 s fails, no 240/300 clamp, custom value) |
| Ordinary tasks retain 240 s | 1 (character extraction) |
| Cloud providers unchanged | 1 (groq uses 90 s) |
| Parent cancellation | 1 (parent signal aborts before 900 s) |
| ASPO failover | 2 (retryable timeout, failover to cloud) |

### Updated tests (`tests/ollama-instrumentation.test.ts` — 13 tests, all pass)

- Timeout log assertion updated: `timeoutMs` → `configuredTimeoutMs`, added `signalSource` and `abortedBy` field checks.

### Full suite

```
Test Files:  85 passed | 1 failed (pre-existing8 | 86 total
Tests:       1473 passed | 6 skipped | 0 failed (from my changes)
```

- **Pre-existing failure**: `tests/kokoro-e2e-pipeline.test.ts` — requires `MONGODB_URI`, unrelated to this change.
- **Pre-existing lint error**: `tests/narrative-control.test.ts:443` — `no-non-null-asserted-optional-chain`, unrelated to this change.

### Typecheck and lint

- `npm run typecheck`: **pass** (0 errors)
- `npm run lint`: 1 pre-existing error (`tests/narrative-control.test.ts:443`), 24 pre-existing warnings. No new errors or warnings from this change.

## 6. Remaining Parent Timeout Limitations

| Source | Value | Risk | Status |
|--------|-------|------|--------|
| `AbortSignal.timeout(budget)` at `manager.ts:744` | 900,000 ms | None — this is the intended owner | **Fixed** |
| undici `bodyTimeout` (global dispatcher) | 900,000 ms | None — raised to match story budget | **Fixed** |
| `sequenceTimeoutMs()` base cap | 300,000 ms | None — `runSequence` raises `sequenceMs` to `max(300s, 900s)` for story | **Fixed** |
| `ollamaTimeoutMs()` cap | 240,000 ms | None — not used for story task; `storyTimeoutMs` is used instead | **Fixed** |
| BullMQ worker timeout | none set | None — worker does not set a timeout | OK (unchanged) |
| Parent `context.signal` from `storyDraftEngine.ts` | none passed | None — story draft engine passes no parent signal | OK (unchanged) |
| `LLM_SEQUENCE_TIMEOUT_MS` env cap | 300,000 ms | If user sets `LLM_SEQUENCE_TIMEOUT_MS=300000`, `run8nSequence` still raises `sequenceMs` to 900 s for story via `Math.max(baseSequenceMs, storyMaxMs)` | **Fixed** |

**No parent timeout can terminate the Story Draft request before the 900-second budget.** The only way to abort earlier is to pass an explicit `AbortSignal` via `StoryCallOptions.signal`, which is composable with the manager's timeout signal via `AbortSignal.any`.

## 7. Recommended Manual Ollama Test

Run a real Story Draft generation with Ollama to verify the 900-second budget is respected!:

```bash
# 1. Ensure Ollama is running with the configured model
ollama list  # should show qwen3:4b-instruct-2507-q4_K_M

# 2. Set the environment
# .env should have:
#   LLM_PROVIDER=ollama
#   OLLAMA_TIMEOUT_MS=240000
#   OLLAMA_STORY_TIMEOUT_MS=900000
#   OLLAMA_NUM_CTX=16384

# 3. Start the worker
npm run worker

# 4. Trigger a Story Draft generation via the app or API
#    Use a prompt that produces a long prompt_eval (e.g., 5+ minute episode)

# 5. Watch the logs for:
#    [studio] llm provider attempt task=story provider=ollama timeoutMs=900000 slotCap=900000
#    [studio] ollama request stage=story signalSource=external configuredTimeoutMs=900000
#    [studio] ollama story response ms=<actual elapsed>
#
#    The request should NOT be cancelled at 240s or 300s.
#    If the model takes >900s, the timeout log should show:
#    [studio] ollama timeout stage=story configuredTimeoutMs=900000 elapsedMs=~900000 signalSource=external abortedBy=own_timeout
```

Alternatively, use the existing end-to-end test script:

```bash
node scripts/ollama-e2e-test.mjs
```

This sends a realistic Story Bible section request. For a full Story Draft test, trigger generation through the app's API with `LLM_PROVIDER=ollama`.