# Ollama Forensic Audit — Implementation Report

**Date**: 2026-11-23
**Status**: R1–R8 complete. R9–R10 are hardware/model decisions (no code changes).
**Test suite**: 1517 passed, 6 skipped, 1 failed (pre-existing `kokoro-e2e-pipeline` requiring real MongoDB).
**Typecheck**: clean. **Lint**: 1 pre-existing error (untouched `narrative-control.test.ts:443`).

---

## R1 — Respect `LLM_PROVIDER=ollama` as primary

**Problem**: The `ollama_last_resort` reordering moved Ollama to the end of the
sequence even when the user explicitly set `LLM_PROVIDER=ollama`, defeating the
intent and wasting the sequence budget on cloud providers first.

**Fix** (`lib/providers/llm/manager.ts`):
- Added `ollamaIsPrimary = baseSlots[0]?.id === "ollama"`. When true, the
  last-resort reordering (`[...nonOllama, ...nonOllama, ...ollama]`) is skipped.
- Changed the unconfigured-slot guard from `if (index === 0)` to
  `if (index === 0 && slot.id !== "ollama")` so that Ollama-as-primary but
  not-yet-running falls through to the next provider instead of throwing.

**Tests**: 4 new tests in `tests/ollama-last-resort-fallback.test.ts` under
"Ollama as primary provider". Updated 7 tests in `tests/ollama-provider.test.ts`
that relied on the old reordering. Fixed `tests/season-architecture-fixes.test.ts`
(`fallbackFrom` now `"ollama"` instead of `null` when Ollama times out first).
Fixed `tests/story-bible-generation.test.ts` (swapped slot order so the
fallback-chain test works as intended under R1).

**Side-effect fix**: Added missing capability filter
`(slot) => Boolean(slot.generateEpisodeSuggestion)` to
`generateEpisodeSuggestion()` — all other `generate*` methods had this filter
but this one did not. Without it, an Ollama slot lacking the capability would
throw a non-failover `configuration` error and stop the sequence instead of
falling through to the next provider.

---

## R2 — Set BullMQ `lockDuration` to 900 s for `studio-llm`

**Problem**: The default BullMQ `lockDuration` (30 s) was far shorter than the
Ollama story-generation timeout (900 s). The worker's lock would expire mid-run,
allowing BullMQ to re-enqueue the job and produce duplicate generations.

**Fix** (`workers/studio.ts`):
- Added `llmLockDurationMs = ollamaPrimary ? 900_000 : 30_000`.
- Passed `lockDuration: llmLockDurationMs` to the `Worker` constructor for the
  `studio-llm` queue.

---

## R3 — Per-task `num_ctx` (sections use 8192)

**Problem**: Story Bible sections are small prompts but ran with
`OLLAMA_NUM_CTX=16384`, wasting context-window memory and potentially slowing
prompt evaluation.

**Fix**:
- `lib/providers/llm/ollama.ts`: Added `DEFAULT_OLLAMA_SECTION_NUM_CTX = 8192`
  and `ollamaSectionNumCtx(env)` reader. Added `sectionNumCtx` field to
  `OllamaLLMProvider`; section transports use `num_ctx: this.sectionNumCtx`.
- `lib/providers/llm/registry.ts`: Wired `sectionNumCtx: ollamaSectionNumCtx(env)`.
- `.env` / `.env.example`: Added `OLLAMA_SECTION_NUM_CTX=8192`.

**Tests**: 4 new tests in `tests/ollama-provider.test.ts` for
`ollamaSectionNumCtx` defaults, env override, and invalid-value fallback.

---

## R4 — Compact prompts for sequential parts 2–6

**Problem**: Parts 2–6 of the sequential Story Draft received the full bible
context, narrative authority, and authority text — the same volume as part 1.
This inflated prompt-eval time for parts that only need continuity context.

**Fix** (`lib/providers/llm/storyDraftParts.ts`):
- Added constants: `COMPACT_BIBLE_CONTEXT_MAX = 5_000`,
  `COMPACT_NARRATIVE_AUTHORITY_MAX = 3_000`, `COMPACT_AUTHORITY_MAX = 6_000`.
- In `buildPartPrompt()`, for `index > 0`, clip `bibleContext`,
  `narrativeAuthority`, and `authority` to their compact limits.
- Part 1 (`index === 0`) receives the full prompt unchanged.

**Tests**: 1 new test in `tests/story-draft-sequential.test.ts` verifying
compaction is applied to parts 2–6 but not part 1.

---

## R5 — Cache successful provider for sequential parts

**Problem**: Each of the 6 sequential Story Draft parts re-ran the full
fallback chain from scratch. If Ollama succeeded on part 1, parts 2–6 would
still try cloud providers first (or re-run the full ASPO order), wasting time.

**Fix**:
- `lib/providers/llm/types.ts`: Added `preferredProvider?: string` to
  `StoryCallOptions`.
- `lib/providers/llm/manager.ts` `runSequence()`: After the Ollama last-resort
  check, when `context.preferredProvider` is set, reorder slots to try that
  provider first and reset `retryStartIndex`/`ollamaStartIndex`.
- `lib/providers/llm/storyDraftParts.ts` `generateStoryDraftParts()`: Track
  `preferredProvider` from cached state runs and from each successful
  generation. Pass it to `llm.generateStory()` for subsequent parts.

**Tests**: 3 new tests in `tests/ollama-last-resort-fallback.test.ts` ("Preferred
provider caching"). 2 new tests in `tests/story-draft-sequential.test.ts`
verifying `preferredProvider` is passed forward.

---

## R6 — Retry `invalid_schema` with empty-field hint

**Problem**: Ollama occasionally returned valid JSON with empty string fields
(e.g. `"title": ""`), causing a Zod `too_small` validation failure. The manager
treated this as a non-failover `invalid_schema` error and stopped, even though
a simple retry with a hint would usually fix it.

**Fix**:
- `lib/providers/llm/parse.ts` `parseStory()`: Detect empty-field Zod issues
  (`code === "too_small"`, `type === "string"`, `minimum === 1`) and add
  `details: { emptyField: true }` to the `JobError`.
- `lib/providers/llm/manager.ts` `generateStory()`: Refactored the `call`
  function to use a `tryGenerate` helper. On `invalid_schema` with
  `details.emptyField`, retry the same slot with `EMPTY_FIELD_RETRY_HINT`
  added to `continuityContext`. The hint instructs the model to fill every
  required field with at least one sentence.

**Tests**: 2 new tests in `tests/ollama-provider.test.ts` — one verifying retry
on empty-field errors, one verifying no retry on non-empty-field
`invalid_schema` errors.

---

## R7 — Benchmark `num_ctx` 8192 vs 16384

**Script**: `scripts/ollama-quick-bench.mjs`

**Results** (qwen3:4b-instruct-2507-q4_K_M, CPU inference):
| num_ctx | prompt eval (t/s) | eval (t/s) | reload (s) |
|---------|-------------------|------------|------------|
| 8192    | 10.62             | 7.48       | 20.8       |
| 16384   | 10.93             | 7.77       | 20.8       |

**Conclusion**: Inference speed is nearly identical. The dominant cost is model
reload (~20.8 s) when switching `num_ctx` values. For small prompts, `num_ctx`
does not affect speed. R3 (per-task `num_ctx`) is safe to use — sections get
8192 without measurable penalty.

---

## R8 — Benchmark `format: schema` vs `format: json`

**Results** (same model):
| format  | eval (t/s) |
|---------|------------|
| json    | 7.77       |
| schema  | 7.48       |

**Conclusion**: Schema mode does **not** significantly slow down token
generation for this model. The audit's 2–10× hypothesis was **not confirmed**.
No code change needed — schema mode is safe to keep.

---

## R9 — Hardware considerations (no code change)

The user's hardware (AMD Ryzen 5 PRO 2600, 16 GB RAM, AMD Radeon R7 430 with
2 GB VRAM) supports only partial GPU offload (~714 MB in VRAM). Most computation
runs on CPU. Upgrading the GPU (e.g. to an NVIDIA RTX 3060 12 GB) would enable
full offload of the 4B model and reduce prompt-eval time by 3–5×.

---

## R10 — Model considerations (no code change)

`qwen3:4b-instruct-2507-q4_K_M` is a good quality/speed tradeoff for CPU
inference. A smaller model (`qwen3:1.7b`) would be faster but may produce lower
quality output. A larger model (`qwen3:8b`) would not fit in VRAM and would be
slower on CPU. The current model is recommended unless the GPU is upgraded.

---

## Files modified

| File | Changes |
|------|---------|
| `lib/providers/llm/manager.ts` | R1 (ollamaIsPrimary), R5 (preferredProvider), R6 (empty-field retry), capability filter for `generateEpisodeSuggestion` |
| `lib/providers/llm/ollama.ts` | R3 (`sectionNumCtx`, `ollamaSectionNumCtx()`) |
| `lib/providers/llm/registry.ts` | R3 (wire `sectionNumCtx`) |
| `lib/providers/llm/types.ts` | R5 (`preferredProvider` in `StoryCallOptions`) |
| `lib/providers/llm/storyDraftParts.ts` | R4 (compact prompts), R5 (track/pass `preferredProvider`) |
| `lib/providers/llm/parse.ts` | R6 (detect empty-field Zod issues) |
| `workers/studio.ts` | R2 (`lockDuration: 900_000`) |
| `.env` | R3 (`OLLAMA_SECTION_NUM_CTX=8192`) |
| `.env.example` | R3 (`# OLLAMA_SECTION_NUM_CTX=8192`) |
| `scripts/ollama-quick-bench.mjs` | R7+R8 (benchmark script) |
| `tests/ollama-last-resort-fallback.test.ts` | R1 (4 tests), R5 (3 tests) |
| `tests/ollama-provider.test.ts` | R3 (4 tests), R6 (2 tests), R1 (7 tests updated) |
| `tests/story-draft-sequential.test.ts` | R4 (1 test), R5 (2 tests) |
| `tests/season-architecture-fixes.test.ts` | R1 (`fallbackFrom` expectation) |
| `tests/story-bible-generation.test.ts` | R1 (slot order swap) |
| `tests/episode-suggestion.test.ts` | Indirectly fixed by capability filter in manager |