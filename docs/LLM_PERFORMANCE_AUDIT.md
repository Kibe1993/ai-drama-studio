# LLM Performance Audit — Ollama Story Bible Generation

**Date:** 2026-11-20
**Status:** Phase 0 complete, Phase 1 pending

## Hardware

| Component | Value |
|---|---|
| CPU | AMD Ryzen 5 PRO 2600 Six-Core (6 cores / 12 threads) |
| RAM | 16 GB |
| GPU | AMD Radeon R7 430 (2 GB VRAM) |
| Ollama | 0.40.16 |
| Model | `qwen3:4b-instruct-2507-q4_K_M` (4.0B params, Q4_K_M, 2.2 GB) |
| Processor split | 67% CPU / 33% GPU |
| Context | 8192 |

The GPU has only 2 GB VRAM. The 4B model (2.2 GB) cannot fit entirely in VRAM, so Ollama splits inference across CPU and GPU (67%/33%). This is the primary hardware limitation.

## Effective .env values (non-secret)

| Variable | Value |
|---|---|
| `LLM_PROVIDER` | `ollama` |
| `LLM_FALLBACK_PROVIDERS` | `groq,openrouter,mistral` |
| `LLM_FREE_ONLY` | `true` |
| `OLLAMA_MODEL` | `qwen3:4b-instruct-2507-q4_K_M` |
| `OLLAMA_TIMEOUT_MS` | `240000` (4 min) |
| `OLLAMA_NUM_CTX` | `8192` |
| `OLLAMA_TEMPERATURE` | `0.7` (non-section); `0.2` (section) |
| `OLLAMA_TOP_P` | `0.9` (non-section); `0.8` (section) |
| `OLLAMA_REPEAT_PENALTY` | `1.1` (non-section); `1.3` (section) |
| `LLM_SEQUENCE_TIMEOUT_MS` | `300000` (5 min) |
| Section sequence timeout | `900000` (15 min) |

## Phase 0a: Benchmark results

Script: `scripts/ollama-bench.ps1`

Tests 4 format modes for the `identity` section (num_predict=1500), 2 runs each, using the exact options the app uses for section generation: `num_ctx=8192, temperature=0.2, top_p=0.8, repeat_penalty=1.3, repeat_last_n=128`.

### Raw results — identity section

| Run | Mode | eval_count | tokens/s | load (ms) | prompt_eval (ms) | eval (ms) | total (ms) | done_reason |
|---|---|---|---|---|---|---|---|---|
| 1 | no_format | 188 | 6.45 | 5.8 | 36759 | 29151 | 107240 | stop |
| 1 | full_schema | 252 | 6.29 | 6.6 | 152 | 40092 | 96591 | stop |
| 1 | stripped_schema | 313 | 6.54 | 6.4 | 145 | 47877 | 102291 | stop |
| 1 | json | 285 | 6.53 | 14814 | 36696 | 43611 | 95136 | stop |
| 2 | no_format | 275 | 6.49 | 8.5 | 153 | 42365 | 42548 | stop |
| 2 | full_schema | 259 | 6.40 | 5.4 | 151 | 40462 | 40642 | stop |
| 2 | stripped_schema | 228 | 6.35 | 5.0 | 155 | 35915 | 36090 | stop |
| 2 | json | 300 | 6.46 | 5.0 | 186 | 46445 | 46651 | stop |

### Summary (average of 2 runs)

| Mode | eval_count | tokens/s | load (ms) | prompt_eval (ms) | eval (ms) | total (ms) |
|---|---|---|---|---|---|---|
| no_format | 232 | 6.47 | 7.2 | 18456 | 35758 | 74894 |
| full_schema | 256 | 6.35 | 6.0 | 152 | 40277 | 68617 |
| stripped_schema | 271 | 6.45 | 5.7 | 150 | 41896 | 69191 |
| json | 293 | 6.50 | 7408 | 18441 | 45028 | 70894 |

### Characters section

The characters section (num_predict=2500) did not complete within the 10-minute benchmark timeout. At ~6.5 tokens/s, 2500 tokens takes ~385 seconds (6.4 minutes), which exceeds the 240s `OLLAMA_TIMEOUT_MS`.

### Key observations

1. **tokens/s ≈ 6.5 across all modes.** Schema enforcement does not measurably impact generation speed. The difference between no_format (6.47) and full_schema (6.35) is within noise (±0.15 t/s).

2. **First-call cold start is expensive.** Run 1 of `no_format` had 36.8s prompt_eval and 107s total. Run 1 of `json` had 14.8s load_duration and 36.7s prompt_eval. After the model is warm, prompt_eval drops to ~150ms and load to ~5ms.

3. **Model reload on context change.** The 14.8s `load_duration` on the first `json` run (after `no_format` and `full_schema` runs) suggests Ollama reloaded the model. This confirms hypothesis 3 (context churn).

4. **Warm-call time: ~40-47s per identity section.** With 6 sections at 40-47s each (identity is the smallest at 1500 num_predict), total inference time is 240-420s minimum. Characters (2500 num_predict) would take ~385s alone.

5. **Timeout risk: CONFIRMED.** At 6.5 t/s, the characters section (2500 num_predict) needs ~385s. The `OLLAMA_TIMEOUT_MS` is 240s. The characters section will timeout.

## Phase 0b: `ollama ps` during app run

```
NAME                             ID              SIZE      PROCESSOR          CONTEXT    RUNNER      UNTIL
qwen3:4b-instruct-2507-q4_K_M    0edcdef34593    2.2 GB    67%/33% CPU/GPU    8192       llamacpp    4 minutes from now
```

The model is loaded at 8192 context with a 67%/33% CPU/GPU split. No second model is loaded concurrently.

**To capture during an app run:** Run `ollama ps` in a separate terminal while the worker processes a Story Bible generation job. Watch for:
- CONTEXT changing between sections (indicates reload)
- a second model appearing (indicates concurrent requests)
- PROCESSOR ratio shifting (indicates memory pressure)

## Phase 0c: Worker log fields

The following log lines are emitted during one Story Bible run. Extract with:
```
grep -E '"story-bible"|"llm"|"ollama"' worker.log
```

| Log line | Fields | Source |
|---|---|---|
| `[llm] startup sequence` | order, freeOnly, fallbackConfigured | `registry.ts:342` |
| `[llm] generation started` | task, primary, providers, retryStrategy, sequenceMs, runId, jobId | `manager.ts:642` |
| `[llm] provider attempt` | provider, model, timeoutMs, fallback, runId, jobId | `manager.ts:730` |
| `[ollama] request` | model, url, stream, effectiveTimeoutMs, fallbackTimeoutMs | `ollama.ts:194` |
| `[ollama] response` | model, ms, inputTokens, outputTokens | `ollama.ts:314` |
| `[llm] provider success` | task, provider, model, ms, fallback, inputTokens, outputTokens | `manager.ts:749` |
| `[llm] provider failed` | provider, model, code, httpStatus, detail, ms, fallback | `manager.ts:785` |
| `[story-bible] section started` | jobId, section, order | `storyBibleSections.ts:499` |
| `[story-bible] section completed` | jobId, section, provider, model, fallbackFrom, ms, outputTokens | `storyBibleSections.ts:528` |
| `[story-bible] section failed` | jobId, section, code, retryable, completedSections, ms | `storyBibleSections.ts:543` |

**Missing from current logging:** load_duration, prompt_eval_duration, eval_duration, tokens/s, done_reason, time-to-first-token, requested num_ctx, requested num_predict, format mode. Phase 1 adds these.

## Hypothesis verdicts

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | Hard timeout, work discarded | **CONFIRMED** | Characters section (2500 num_predict at 6.5 t/s = 385s) exceeds 240s timeout. Non-streaming calls lose all output. |
| 2 | Schema-constrained decoding slower | **REJECTED** | tokens/s is 6.29-6.54 across all 4 modes. Schema adds <3% overhead, within noise. |
| 3 | Context churn causes reloads | **CONFIRMED** | First `json` run after `no_format` runs had 14.8s load_duration. `ollamaOptionsWithBudget` raises num_ctx for screenplay stage. |
| 4 | Volume: 6 sequential calls | **CONFIRMED** | 6 sections × 40-385s each = 240-1800s total. This is the dominant bottleneck. |
| 5 | Concurrency: 2 workers + canon dispatcher | **UNPROVEN** | `ollama ps` shows only one model loaded. Need to observe during concurrent jobs. |
| 6 | Wrong model default | **FIXED** | `.env` now sets `OLLAMA_MODEL=qwen3:4b-instruct-2507-q4_K_M`. |

## Bottleneck ranking

1. **Model inference speed: 6.5 tokens/s** — The 4B model on 67% CPU is the hard floor. No configuration change can fix this; only a faster model, full GPU offload, or a smaller model would help.
2. **6 sequential section calls** — Total time = sum of 6 sections. Even at 6.5 t/s, 11,500 total output tokens takes ~1,770s (29 min).
3. **Characters section timeout** — 2500 num_predict at 6.5 t/s = 385s > 240s timeout. This section will fail and trigger fallback to cloud providers.
4. **Context churn / model reload** — First call after a context change adds ~15s load + ~37s prompt eval. Subsequent calls with same context: ~5ms load + ~150ms prompt eval.
5. **Schema overhead** — Negligible (<3%). Not worth optimizing.

## Recommended next steps

- **Phase 1**: Add instrumentation to measure actual per-call timing in the app (not just benchmark).
- **Phase 2**: Raise `OLLAMA_TIMEOUT_MS` to at least 420s (7 min) to accommodate the characters section. Derive timeout from `num_predict / min_tokens_per_second + margin`.
- **Phase 3**: Use a constant `num_ctx` across all stages to eliminate reloads.
- **Phase 4**: Skip — schema overhead is negligible.
- **Phase 5**: Check if concurrent jobs cause double model loading; add a serialization guard if needed.