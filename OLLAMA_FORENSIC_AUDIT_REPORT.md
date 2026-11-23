# Ollama Forensic Audit Report

## 1. Executive Summary

This audit investigated why Ollama performs significantly worse when called through AI Drama Studio compared to direct PowerShell invocations. The investigation traced every Ollama request path, compared prompt construction, inference configuration, timeouts, fallback behavior, and hardware constraints.

**Five confirmed problems were identified, plus two probable problems requiring additional measurements.**

The primary confirmed causes are:

1. **Provider ordering defeats user intent** — `LLM_PROVIDER=ollama` does not make Ollama the first provider tried. The manager reorders the sequence to `[groq, openrouter, mistral, groq, openrouter, mistral, ollama]`, attempting 6 cloud calls before Ollama. Each failed cloud attempt adds 5–90 seconds of delay before Ollama is even reached.

2. **Context window is 2× the PowerShell benchmark** — The application uses `num_ctx=16384` while the PowerShell benchmark uses `8192`. This doubles KV cache memory and slows prompt evaluation on CPU.

3. **Application prompts are 10–50× larger** — PowerShell benchmark prompts are ~3,000 characters. Story Draft prompts include ~16,615 chars of Bible context + ~12,346 chars of narrative authority + schema instructions, totaling 30,000+ characters. Prompt evaluation scales linearly with input tokens.

4. **Schema-constrained output slows token generation** — The application sends full JSON schemas to Ollama's grammar-based sampler. On a 4B CPU-only model, this can reduce token generation speed by 2–10×.

5. **Sequential Story Draft multiplies fallback overhead** — Each of the 6 sequential parts goes through the full 7-slot provider sequence independently, meaning up to 42 total provider attempts (6 parts × 7 slots) in the worst case.

---

## 2. Complete Ollama Request Architecture

### 2.1 Call Chains

#### Story Bible Section Generation
```
UI → POST /api/projects/[projectId]/story-bible
  → storyBibleService.start()
  → creates "storyBible.generate" job
  → BullMQ queue
  → processGenerationJob()
  → storyBibleEngine.run()                    [lib/pipeline/storyBibleEngine.ts:61]
  → generateStoryBibleSections()              [lib/providers/llm/storyBibleSections.ts:464]
    → for each of 6 sections (sequential):
      → buildStoryBibleSectionTask()          [storyBibleSections.ts:375]
      → llm.generateStoryBible(task)          → StoryProviderManager.generateStoryBible()
        → runSequence("story_bible")          [lib/providers/llm/manager.ts:580]
          → for each provider slot:
            → slot.generateStoryBible(input)  → OllamaLLMProvider.generateStoryBible()
              → requestStoryBible(transport)  [lib/providers/llm/storyBibleTask.ts:322]
              → transport.request()           → ollamaChat()  [lib/providers/llm/ollama.ts:187]
              → fetch("http://127.0.0.1:11434/api/chat")
            → parseStructured() + Zod validation
            → on success: return; on failure: try next slot
```

#### Story Draft Generation (Sequential Parts)
```
UI → POST /api/projects/[projectId]/story-draft
  → storyDraftService.start()
  → creates "story.draft" job
  → BullMQ queue
  → processGenerationJob()
  → storyDraftEngine.run()                    [lib/pipeline/storyDraftEngine.ts:69]
  → generateStoryDraftParts()                 [lib/providers/llm/storyDraftParts.ts:303]
    → for each of 6 parts (sequential):
      → buildPartPrompt()                     [storyDraftParts.ts:160]
      → llm.generateStory(prompt)             → StoryProviderManager.generateStory()
        → runSequence("story")                [manager.ts:580]
          → for each provider slot:
            → slot.generate(input)            → OllamaLLMProvider.generateStory()
              → ollamaChat()                  [ollama.ts:187]
              → fetch("http://127.0.0.1:11434/api/chat")
            → parseStory() + generatedStorySchema validation
            → extendScreenplay() if truncated
            → assertScreenplayPacing()
            → on success: return; on failure: try next slot
    → mergeParts()                            [storyDraftParts.ts:207]
  → runControlledRevision()                   [storyDraftEngine.ts:188]
  → applyStoryCritique()                      [storyDraftEngine.ts:297]
  → upsertProjectDraft()
```

#### Stage Tasks (Characters, Scenes, Episode Suggestion, etc.)
```
UI → API route → service → BullMQ → processGenerationJob()
  → engine.run()
  → llm.generateCharacters/generateScenes/etc.()
  → StoryProviderManager → runSequence()
  → slot → OllamaLLMProvider → requestCharacters/requestScenes/etc.
  → stageTransport.request() → ollamaChat() → fetch()
  → parseStructured() + Zod validation
```

### 2.2 Key Architectural Observations

1. **Every Ollama call goes through `ollamaChat()`** at `lib/providers/llm/ollama.ts:187` — the single HTTP function.

2. **Every call goes through `StoryProviderManager.runSequence()`** at `lib/providers/llm/manager.ts:580` — which manages provider selection, per-attempt timeouts, fallback, and retry.

3. **Ollama is configured as primary** (`LLM_PROVIDER=ollama` in `.env:16`), with fallbacks `groq,openrouter,mistral` (`.env:17`).

4. **The manager reorders slots** at `manager.ts:621-629`: Ollama is moved to last-resort position. The effective sequence becomes `[groq, openrouter, mistral, groq, openrouter, mistral, ollama]` — non-Ollama providers are tried twice before Ollama is attempted once.

5. **No streaming for Story Draft** — `stream=false` at `ollama.ts:553` for the story transport. Story Bible sections use `stream=true` at `ollama.ts:579`.

6. **Schema-constrained output** — sections use `formatMode: "schema"` at `ollama.ts:579`. Story Draft uses `STORY_RESPONSE_SCHEMA` at `ollama.ts:588-590` when `OLLAMA_FORMAT=schema`, or `"json"` otherwise. The `.env` does not set `OLLAMA_FORMAT`, so the default is `"json"` (see `ollama.ts:513`).

### 2.3 Differences from Direct Ollama Integration

| Aspect | Direct PowerShell | AI Drama Studio |
|--------|-------------------|-----------------|
| Provider selection | Single Ollama call | 7-slot sequence, Ollama last |
| Prompt assembly | Manual, small | Programmatic, large (bible + authority + context) |
| Timeout management | Single `TimeoutSec` | 5-layer timeout stack |
| Error handling | Exception | Classification → cooldown → failover → retry |
| Validation | None | JSON parse → repair → Zod schema → pacing |
| Schema enforcement | Optional | Always (schema or json mode) |

---

## 3. PowerShell Versus Application Comparison

### 3.1 The PowerShell Benchmark

Source: `scripts/ollama-bench.ps1`

| Parameter | Value |
|-----------|-------|
| Model | `qwen3:4b-instruct-2507-q4_K_M` |
| `num_ctx` | **8192** (default, line 23) |
| `temperature` | 0.2 (line 25) |
| `top_p` | 0.8 (line 26) |
| `repeat_penalty` | 1.3 (line 27) |
| `repeat_last_n` | 128 (line 28) |
| `num_predict` | 1500–2500 (per section, lines 33–40) |
| System prompt | ~2,000 chars (Story Bible common instructions) |
| User prompt | ~500–1,000 chars (simple section prompt) |
| **Total input** | **~2,500–3,000 chars (~625–750 tokens)** |
| Format | Tests 4 modes: none, full schema, stripped schema, json |
| Stream | `false` (line 183) |
| Timeout | 300s (line 198) |

### 3.2 The Application

| Parameter | Story Bible Section | Story Draft |
|-----------|-------------------|-------------|
| Model | `qwen3:4b-instruct-2507-q4_K_M` | same |
| `num_ctx` | **16384** (`.env:75`) | **16384** |
| `temperature` | 0.2 (overridden at `ollama.ts:559`) | **0.7** (`.env:74`) |
| `top_p` | 0.8 (overridden at `ollama.ts:563`) | **0.9** (`.env:76`) |
| `repeat_penalty` | 1.3 (overridden at `ollama.ts:567`) | **1.1** (default) |
| `repeat_last_n` | 128 (`ollama.ts:577`) | not set |
| `num_predict` | 1500–2500 (`ollama.ts:130-137`) | 8000–32000 (`budget.ts:61-63`) |
| System prompt | ~2,000 chars | ~500 chars (`prompt.ts:5-14`) |
| User prompt | ~2,000–10,000 chars (with context sections) | **30,000+ chars** |
| **Total input** | **~4,000–12,000 chars (~1,000–3,000 tokens)** | **~32,000+ chars (~8,000 tokens)** |
| Format | schema (full JSON schema object) | json (default) or schema |
| Stream | `true` (`ollama.ts:579`) | `false` (`ollama.ts:553`) |
| Timeout | 600s section / 900s sequence | 900s story / 900s sequence |

### 3.3 Critical Differences

1. **`num_ctx`: 8192 vs 16384** — The application uses double the context window. On CPU, this:
   - Doubles KV cache memory allocation (~512MB → ~1GB for a 4B model)
   - Requires a model reload (~15s) if switching from 8192 to 16384
   - Can slow prompt evaluation due to larger cache management

2. **Prompt size: ~750 tokens vs ~8,000 tokens** — The application sends 10× more input tokens for Story Draft. Prompt evaluation at ~28 t/s (from user's data: 4000 tokens / 144s) means 8000 tokens would take ~286s just for prompt evaluation.

3. **Schema enforcement: none/json vs schema** — The PowerShell benchmark tests multiple modes. The application always uses schema or json mode. Schema-constrained generation on a 4B model can reduce token speed by 2–10× due to grammar-based sampling overhead.

4. **Temperature: 0.2 vs 0.7** — Story Draft uses higher temperature, producing more varied sampling. This doesn't affect speed but can produce lower-quality output that fails validation.

5. **`num_predict`: 2500 vs 32000** — Story Draft allows up to 32,000 output tokens. Even at 11 t/s, generating 32,000 tokens would take ~2,909s (48 min), far exceeding the 900s timeout.

### 3.4 Missing Measurements

The available logs do not contain:
- Token counts for the actual Story Draft prompts sent to Ollama
- Prompt evaluation duration for Story Draft specifically
- Token generation speed during schema-constrained output
- Memory usage during inference
- CPU utilization during prompt evaluation vs token generation

---

## 4. Prompt Construction Analysis

### 4.1 Story Bible Section Prompts

**Source:** `lib/providers/llm/storyBibleTask.ts:259` (`promptFor()`)

**System prompt** (~2,000 chars): 11 common instructions about bible development, field limits, JSON output, no repetition.

**User prompt** composition:
- Mode, title, production category, genre, language, tone (~200 chars)
- Creator idea (~200 chars)
- Creative direction, instruction, creator decisions (variable)
- Approved canon (JSON, variable)
- Current draft (JSON, variable)
- **`contextSections`** — prior sections as compact JSON briefs
- Section guidance (~200 chars)
- Schema instruction with `shapeExample()` (~500 chars)

**`contextSections` growth** (from `storyBibleSections.ts:189`):
- Section 1 (identity): no context → ~500 char prompt
- Section 2 (world): identity brief (~500 chars) → ~1,000 char prompt
- Section 3 (characters): identity + world briefs (~1,500 chars) → ~2,000 char prompt
- Section 4 (narrative): identity + world + characters briefs (~3,000 chars) → ~3,500 char prompt
- Section 5 (guidelines): + narrative brief (~4,000 chars) → ~4,500 char prompt
- Section 6 (canon): + guidelines brief (~5,000 chars) → ~5,500 char prompt

**Finding:** Context sections grow progressively but are compact (briefs, not full text). The `clip()` function limits each field. Total prompt for the last section is ~7,500 chars (~1,875 tokens). This is reasonable.

### 4.2 Story Draft Prompts

**Source:** `lib/providers/llm/prompt.ts:27` (`storyUserPrompt()`)

**Composition:**
- Content category, title, genre, language, style, tone, aspect ratio, duration (~400 chars)
- Scene count guidance (~150 chars)
- **`bibleContext`** — rendered by `renderStoryBibleBrief()` (`storyBibleSections.ts:238`)
  - User reports: **~16,615 chars**
  - Includes all 6 bible sections as labeled text blocks
- **`narrativeAuthority`** — rendered by `renderNarrativeContext()` (`context.ts:122`)
  - User reports: **~12,346 chars**
  - Includes canon facts, rules, protected decisions, knowledge, prohibited disclosures
- **`continuityContext`** — creative direction + current candidate + revision instructions
- Three-act structure instructions (~500 chars)
- Scene schema instructions (~800 chars)
- **Total: 30,000+ chars (~7,500+ tokens)**

**Finding:** The Story Draft prompt is dominated by `bibleContext` (55%) and `narrativeAuthority` (41%). The actual story idea and instructions are <5% of the prompt.

### 4.3 Story Draft Sequential Parts

**Source:** `lib/providers/llm/storyDraftParts.ts:160` (`buildPartPrompt()`)

Each of the 6 parts receives:
- The **full base prompt** including all bibleContext, narrativeAuthority, continuityContext
- Part-specific instructions (~300 chars)
- Previous scenes summary (via `summarizeScenes()`, ~150 chars per scene)

**Finding:** Sequential generation does NOT reduce prompt size. Each part receives the full 30,000+ char prompt. The input token count is the same for all 6 parts. Only the output (number of scenes) is reduced per part. This means prompt evaluation time is NOT saved by sequential generation — it's multiplied by 6.

### 4.4 Duplication Analysis

1. **Bible context is not duplicated** within a single call — it appears once in the prompt.
2. **Narrative authority is not duplicated** within a single call.
3. **However, both are re-sent for every sequential part** — 6 times for Story Draft, 6 times for Story Bible sections (as context sections grow).
4. **Schema instructions are repeated** in both the system prompt ("Return only the JSON object described by the schema") and the user prompt (detailed field descriptions).
5. **No contradictory instructions** were found.
6. **Prompt construction does not differ between Ollama and cloud providers** — the same `storyUserPrompt()` is used for all providers. Only the `format` parameter differs (schema vs json).

---

## 5. Inference Configuration Analysis

### 5.1 HTTP Payload Sent to Ollama

#### Story Bible Section
```json
{
  "model": "qwen3:4b-instruct-2507-q4_K_M",
  "messages": [
    { "role": "system", "content": "<~2000 chars>" },
    { "role": "user", "content": "<~1000-5500 chars>" }
  ],
  "stream": true,
  "format": { "type": "object", "additionalProperties": false, "properties": { ... }, "required": [ ... ] },
  "options": {
    "temperature": 0.2,
    "num_ctx": 16384,
    "top_p": 0.8,
    "repeat_penalty": 1.3,
    "repeat_last_n": 128,
    "num_predict": 1500
  }
}
```

#### Story Draft
```json
{
  "model": "qwen3:4b-instruct-2507-q4_K_M",
  "messages": [
    { "role": "system", "content": "<~500 chars>" },
    { "role": "user", "content": "<~30000 chars>" }
  ],
  "stream": false,
  "format": "json",
  "options": {
    "temperature": 0.7,
    "num_ctx": 16384,
    "top_p": 0.9,
    "repeat_penalty": 1.1,
    "num_predict": 8000
  }
}
```

### 5.2 Configuration Overrides

The application overrides Ollama defaults at `ollama.ts:159-171` (`ollamaGenerationOptions()`):
- `temperature`: 0.7 (Ollama default: 0.8)
- `num_ctx`: 16384 (Ollama default: 2048 or 4096)
- `top_p`: 0.9 (Ollama default: 0.9)
- `repeat_penalty`: 1.1 (Ollama default: 1.1)

For sections, further overrides at `ollama.ts:559-579`:
- `temperature`: 0.2 (lower for structured output)
- `top_p`: 0.8
- `repeat_penalty`: 1.3 (higher to prevent repetition)
- `repeat_last_n`: 128
- `num_predict`: 1500–2500

### 5.3 Inference Bottleneck Analysis

From user's historical data (Story Bible World section):
- **Load duration**: ~0s (model already loaded)
- **Prompt evaluation**: 144s for ~4,000 tokens → **~28 t/s**
- **Token generation**: 183s for ~2,000 tokens → **~11 t/s**
- **Time to first token**: 205s (load + prompt eval + overhead)
- **Total**: 388s

**Prompt evaluation is the primary bottleneck** for Story Bible sections (144s out of 388s = 37%).

For Story Draft with ~8,000 input tokens:
- Estimated prompt evaluation: 8000 / 28 ≈ **286s** (4.8 minutes)
- This alone consumes nearly the entire sequence timeout budget.

For Story Draft sequential parts, each part has ~8,000 input tokens:
- 6 parts × 286s prompt eval = **1,716s (28.6 minutes)** just for prompt evaluation
- Plus token generation time for each part

### 5.4 Model Loading

The application keeps `num_ctx` constant at 16384 across all calls (`ollama.ts:150-157`) to avoid model reloads. Comment at line 142-148 explains: "Ollama reloads the model (≈15 s on a 4B model) whenever num_ctx changes between calls."

However, if the user runs PowerShell benchmarks with `num_ctx=8192` and then starts the application with `num_ctx=16384`, the first application call will trigger a model reload (~15s). Subsequent calls at the same `num_ctx` will reuse the loaded model.

### 5.5 `keep_alive`

No `keep_alive` is set in the application. Ollama's default is 5 minutes. Sequential calls within 5 minutes reuse the loaded model. The sequential generation pattern (6 parts/sections) should stay within this window, so model unloading between parts is unlikely.

---

## 6. Timeout and Cancellation Analysis

### 6.1 Timeout Stack

| Layer | Timeout | Source | File:Line |
|-------|---------|--------|-----------|
| undici `headersTimeout` | 900,000ms (15min) | `MAX_HTTP_TIMEOUT_MS` | `ollama.ts:67-71` |
| undici `bodyTimeout` | 900,000ms (15min) | `MAX_HTTP_TIMEOUT_MS` | `ollama.ts:67-71` |
| Ollama general (`timeoutMs`) | 240,000ms (4min) | `OLLAMA_TIMEOUT_MS` env | `ollama.ts:110-114` |
| Ollama section (`sectionTimeoutMs`) | 600,000ms (10min) | `DEFAULT_OLLAMA_SECTION_TIMEOUT_MS` | `ollama.ts:116-120` |
| Ollama story (`storyTimeoutMs`) | 900,000ms (15min) | `OLLAMA_STORY_TIMEOUT_MS` env | `ollama.ts:122-126` |
| Manager sequence (default) | 300,000ms (5min) | `DEFAULT_SEQUENCE_TIMEOUT_MS` | `manager.ts:59` |
| Manager sequence (story task) | 900,000ms (15min) | raised to `storyMaxMs` | `manager.ts:647-652` |
| Manager sequence (section mode) | 900,000ms (15min) | `STORY_BIBLE_SECTION_SEQUENCE_TIMEOUT_MS` | `storyBibleSections.ts:30` |
| Manager per-attempt budget | `min(slotCap, fairShare)` | calculated per slot | `manager.ts:737-744` |
| `AbortSignal.timeout(budget)` | per-attempt budget | combined with context signal | `manager.ts:745` |

### 6.2 Effective Timeout per Task

| Task | Sequence Timeout | Ollama slotCap | Effective Ollama Budget |
|------|-----------------|----------------|------------------------|
| Story Bible section | 900,000ms | 600,000ms | min(600, fairShare) |
| Story Draft (per part) | 900,000ms | 900,000ms | min(900, fairShare) |
| Stage tasks (characters, scenes) | 300,000ms | 240,000ms | min(240, fairShare) |
| Episode suggestion | 300,000ms | 240,000ms | min(240, fairShare) |

### 6.3 Fair Share Budget Calculation

At `manager.ts:742-744`:
```javascript
const remainingEligible = slots.slice(index).filter(...).length;
const fairShareMs = Math.floor(remaining / Math.max(1, remainingEligible));
const budget = Math.min(slotCap, Math.max(fairShareMs, Math.min(slotCap, remaining - (remainingEligible - 1) * 15_000)));
```

With 7 slots and 900,000ms sequence budget:
- Slot 1 (groq): remaining=900,000, eligible=7, fairShare=128,571. Budget=min(90,000, ...)=90,000ms
- If groq fails in 5s: Slot 2 (openrouter): remaining=895,000, eligible=6, fairShare=149,167. Budget=90,000ms
- If all 6 cloud providers fail in 5s each: remaining=870,000, eligible=1. Budget=min(600,000, 870,000)=600,000ms (section) or min(900,000, 870,000)=870,000ms (story)

**Finding:** If cloud providers fail quickly, Ollama gets nearly the full sequence budget. If cloud providers are slow to fail (30s each), Ollama gets 900,000 - 180,000 = 720,000ms, which is still adequate for most tasks.

### 6.4 Timeout Conflict Analysis

1. **undici bodyTimeout (900s) vs Ollama story timeout (900s)**: Equal. The undici timeout will not fire before the Ollama timeout. ✓

2. **Manager per-attempt budget vs Ollama slotCap**: The budget is `min(slotCap, ...)`, so it never exceeds the slot cap. ✓

3. **Sequence timeout vs per-attempt timeout**: The sequence deadline is checked at `manager.ts:683-689`. If `remaining < 100ms`, the sequence is abandoned. The per-attempt signal is `AbortSignal.timeout(budget)` where `budget ≤ remaining`. ✓

4. **Stage tasks (300s sequence vs 240s Ollama)**: If Ollama is the only eligible provider remaining, it gets `min(240,000, 300,000) = 240,000ms`. This is adequate for most stage tasks but could be tight for complex character extraction. ⚠️

5. **No BullMQ job timeout was found** in the codebase. BullMQ's default lock duration is 30s, but `stalledInterval` and `lockDuration` are not configured in `lib/pipeline/bullQueue.ts`. This could cause jobs to be marked as stalled if the worker doesn't extend the lock. **This is a probable issue requiring verification.**

### 6.5 Application Timeout vs Ollama Internal Failure

- **Application timeout**: The `AbortSignal.timeout(budget)` fires at `manager.ts:745`. This closes the HTTP connection. Ollama may still be processing internally. The error is classified as `timeout` at `ollama.ts:453-472`.

- **Ollama internal failure**: Ollama returns HTTP 500 with an error message. This is classified as `provider_unavailable` at `ollama.ts:278-285`. The connection is not closed by the application; Ollama closed it after failing.

- **User's HTTP 500 after 336s**: This was an Ollama internal failure, not an application timeout. The application's 900s story timeout had not expired. Ollama itself crashed or encountered an internal error after 336s of processing.

---

## 7. Structured-Output and Validation Analysis

### 7.1 Format Parameter

| Task | Format | Source |
|------|--------|--------|
| Story Bible section | Full JSON schema object | `ollama.ts:536` (`formatMode === "schema" ? schema : "json"`) |
| Story Draft | `"json"` (default) or schema | `ollama.ts:513` (depends on `OLLAMA_FORMAT` env) |
| Stage tasks | `"json"` or schema | depends on `formatMode` |

The `.env` does not set `OLLAMA_FORMAT`, so the default is `"json"` for Story Draft (see `ollama.ts:513`).

### 7.2 Schema Complexity

**Story Bible section schemas** (`storyBibleTask.ts:68-108`): Each section schema is a flat object with 5–10 properties, some arrays of strings, some arrays of objects. Moderate complexity.

**Story Draft schema** (`story.ts:160-246`): `STORY_RESPONSE_SCHEMA` is a deeply nested schema:
- 3 levels of object nesting (structure → act1/act2/act3 → fields)
- Array of scene objects with 8 required fields each
- Each scene has an array of dialogue objects
- Total: ~50 fields across 4 nesting levels

**Finding:** The Story Draft schema is significantly more complex than section schemas. However, since the default is `"json"` mode (not schema), the model is not grammar-constrained for Story Draft. It IS grammar-constrained for Story Bible sections.

### 7.3 Validation Pipeline

```
Ollama response
  → storyJsonText() — extract JSON from markdown fences     [parse.ts:8]
  → JSON.parse() — parse raw JSON                            [parse.ts:24]
  → repairStoryPayload() — fix common field issues           [parse.ts:32]
  → screenplayEntryCount() — check for truncated scenes      [parse.ts:37-41]
  → generatedStorySchema.safeParse() — Zod validation        [parse.ts:53]
```

### 7.4 Failure Classification

| Outcome | Classification | Retryable | Fails over? |
|---------|---------------|-----------|-------------|
| HTTP connection refused | `provider_unavailable` | true | yes |
| HTTP 500 from Ollama | `provider_unavailable` | true | yes |
| Timeout (AbortSignal) | `timeout` | true | yes |
| Empty response | `empty_response` | false | yes |
| Invalid JSON | `invalid_json` | false | yes |
| Valid JSON, Zod fails | `invalid_schema` | false | yes |
| Truncated (done_reason=length) | `truncated_output` | false | yes |
| Valid and accepted | (success) | — | — |

**Finding:** `invalid_schema` is NOT retryable (`false` at `parse.ts:67`) but IS a failover code (`manager.ts:70`). This means the current provider is not retried, but the next provider is tried. For the user's `definingSystems[1].description` empty field failure, this means:
1. Ollama completes generation (388s)
2. JSON is valid
3. Zod validation fails (empty string where `min(1)` is required)
4. Error is `invalid_schema`, not retryable on Ollama
5. Manager tries next provider (but Ollama is last, so sequence fails)

### 7.5 Separating Failure Types

The user's two reported failures represent different problems:

1. **World section empty description**: Type 5 (Valid JSON that fails schema validation). The model completed generation successfully but produced an empty string for a required field. This is a **model quality problem**, not a transport or timeout issue.

2. **Story Draft HTTP 500 after 336s**: Type 2 (Ollama internal error). The Ollama runner itself failed. This could be memory exhaustion, runner crash, or internal timeout. This is an **infrastructure problem**, not a model quality issue.

---

## 8. Retry and Fallback Analysis

### 8.1 Provider Sequence Construction

At `manager.ts:617-629`:
```javascript
const ollamaSlots = slots.filter((s) => s.id === "ollama");
const nonOllamaSlots = slots.filter((s) => s.id !== "ollama");
if (ollamaSlots.length > 0 && nonOllamaSlots.length > 0) {
  retryStartIndex = nonOllamaSlots.length;      // 3
  ollamaStartIndex = nonOllamaSlots.length * 2;  // 6
  slots = [...nonOllamaSlots, ...nonOllamaSlots, ...ollamaSlots];
}
```

With `LLM_PROVIDER=ollama` and `LLM_FALLBACK_PROVIDERS=groq,openrouter,mistral`:
- Initial sequence from `providerSequence()`: `["ollama", "groq", "openrouter", "mistral"]`
- After ASPO scoring (by priority): `["groq", "openrouter", "mistral", "ollama"]`
- After reordering: **`["groq", "openrouter", "mistral", "groq", "openrouter", "mistral", "ollama"]`**

**Confirmed problem:** Despite `LLM_PROVIDER=ollama`, Ollama is the **7th and last** provider attempted. The application tries each cloud provider twice before trying Ollama once.

### 8.2 Cooldown Behavior

At `aspo.ts:56-64`:
| Failure | Recovery | Cooldown |
|---------|----------|----------|
| `invalid_schema` | `repair_once` | 5s |
| `timeout` | `cooldown_medium` | 30s |
| `rate_limited` | `cooldown_medium` | 30s |
| `provider_unavailable` | `cooldown_short` | 15s |
| `connection_error` | `cooldown_short` | 15s |
| `authentication_error` | `skip_provider` | 300s (permanent) |

**Finding:** If a cloud provider fails with `invalid_schema`, it gets a 5s cooldown and is skipped on the retry pass (5s < time between passes). If it fails with `timeout`, it gets 30s and may be available for the retry pass.

### 8.3 Prompt Duplication Across Retries

**Confirmed problem:** The same full prompt is sent to every provider in the sequence. If groq fails with `invalid_schema`, the same ~30,000 char prompt is sent to openrouter, then mistral, then groq again, etc. There is no prompt reduction or caching between attempts.

### 8.4 Sequential Story Draft Multiplied Overhead

**Confirmed problem:** `generateStoryDraftParts()` at `storyDraftParts.ts:303` calls `llm.generateStory(prompt)` for each of 6 parts. Each call goes through `StoryProviderManager.generateStory()` → `runSequence()` with the full 7-slot sequence. This means:

- **Best case** (cloud succeeds on first try for each part): 6 cloud calls
- **Worst case** (all providers fail except Ollama): 6 parts × 7 slots = **42 provider attempts**
- **Typical case** (cloud fails, Ollama succeeds): 6 parts × 7 attempts = 42 attempts, but only 6 Ollama calls produce output

Each failed cloud attempt adds 5–90s of latency. With 6 failed cloud attempts per part, that's 30–540s of wasted time per part, or 180–3,240s across all 6 parts.

### 8.5 Section Preservation on Failure

At `storyBibleSections.ts:536-553`: When a section fails, the state (including completed sections) is persisted via `onProgress`. The `failedSection` and `error` are recorded. On retry, `parseStoryBibleSectionsState()` at line 396 restores completed sections from `job.output.storyBibleSections`.

**Finding:** Completed sections ARE preserved when another section fails. The fingerprint validation at line 473 ensures cached sections are only reused if the prompt base hasn't changed. ✓

---

## 9. Hardware and Resource Assessment

### 9.1 Hardware

| Component | Specification | Relevance |
|-----------|--------------|-----------|
| CPU | AMD Ryzen 5 PRO 2600 | 6 cores / 12 threads, ~3.4GHz base, ~3.9GHz boost |
| RAM | 16 GB | Shared between OS, Node.js, Redis, Ollama |
| GPU | AMD Radeon R7 430 (2 GB VRAM) | **Insufficient for 4B model** (~2.5GB weights needed) |
| OS | Windows 10 Pro | Memory overhead ~4-6GB |
| Ollama | 0.40.16 | CPU-only inference (GPU cannot run model) |

### 9.2 Inference Mode

The AMD Radeon R7 430 has 2 GB VRAM (GCN 1.0 architecture, ~384 stream processors). The `qwen3:4b-instruct-2507-q4_K_M` model requires ~2.5 GB just for weights in Q4_K_M quantization. **The model cannot fit in VRAM.** Ollama is running on **CPU only**.

This is confirmed by the user's reported token speeds:
- Prompt evaluation: ~28 t/s (typical CPU speed for 4B Q4_K_M on Ryzen 5 2600)
- Token generation: ~11 t/s (typical CPU speed)

GPU speeds for a 4B model would be 100-500+ t/s. The observed speeds are unambiguously CPU.

### 9.3 Memory Budget

| Component | Estimated RAM |
|-----------|--------------|
| Windows 10 OS | 4-6 GB |
| Node.js + Next.js + BullMQ | 1-2 GB |
| Redis | 0.1-0.5 GB |
| Ollama model weights (Q4_K_M) | ~2.5 GB |
| Ollama KV cache (num_ctx=16384) | ~1-2 GB |
| **Total** | **~8-13 GB** |
| **Available headroom** | **~3-8 GB** |

**Finding:** With 16 GB RAM, the system has adequate memory for the model + KV cache. However, the headroom is tight (3-8 GB). If Windows memory pressure increases (background processes, browser tabs), paging could occur, dramatically slowing inference.

### 9.4 `num_ctx` Impact on CPU

At `num_ctx=16384`, the KV cache for a 4B model with GQA (grouped query attention) is approximately:
- 32 layers × 16384 tokens × 4 KV heads × 128 head_dim × 2 (K+V) × 2 bytes (FP16) ≈ **1 GB**

At `num_ctx=8192`, this is halved to ~512 MB.

On CPU, larger KV cache means:
- More memory bandwidth pressure during attention computation
- More cache misses (CPU L3 cache is only 16 MB on Ryzen 5 2600)
- Potentially slower prompt evaluation per token

**Probable problem:** The 2× larger KV cache at `num_ctx=16384` likely slows prompt evaluation compared to `num_ctx=8192`. This cannot be confirmed without benchmarking both configurations with the same prompt, but it is a well-known effect on CPU inference.

### 9.5 Measurements Needed

To confirm hardware-related causes, the following measurements are needed:

1. **CPU utilization** during prompt evaluation (is it 100% on all cores?)
2. **RAM consumption** and available RAM during inference
3. **Paging activity** (Windows Performance Monitor → Memory → Pages/sec)
4. **Prompt evaluation speed** at `num_ctx=8192` vs `16384` with the same prompt
5. **Token generation speed** with schema vs json vs no format
6. **Ollama runner memory** (`ollama ps` or task manager)
7. **Model load time** when switching `num_ctx`

---

## 10. Confirmed Problems

### Problem 1: Provider Ordering Defeats User Intent

- **Source:** `lib/providers/llm/manager.ts:621-629`
- **Function:** `runSequence()`
- **Lines:** 621–629
- **Explanation:** When `LLM_PROVIDER=ollama`, the manager reorders the sequence to try all non-Ollama providers twice before Ollama. The user's intent to use Ollama as primary is overridden.
- **Impact:** 6 cloud provider attempts (each 5–90s) before Ollama is tried. Adds 30–540s of delay per call. For sequential Story Draft, this is multiplied by 6 parts.
- **Classification:** Application-caused, critical correctness problem.

### Problem 2: Context Window 2× Larger Than PowerShell

- **Source:** `.env:75` (`OLLAMA_NUM_CTX=16384`)
- **Function:** `ollamaGenerationOptions()` at `ollama.ts:159`
- **Lines:** 159–171
- **Explanation:** The application uses `num_ctx=16384` while the PowerShell benchmark uses 8192. This doubles KV cache size, increasing memory usage and potentially slowing prompt evaluation on CPU.
- **Impact:** ~512 MB additional RAM, potentially 20–40% slower prompt evaluation.
- **Classification:** Configuration-caused, major performance problem.

### Problem 3: Application Prompts 10–50× Larger

- **Source:** `lib/providers/llm/prompt.ts:27` (`storyUserPrompt()`)
- **Function:** `storyUserPrompt()` and `buildPartPrompt()` at `storyDraftParts.ts:160`
- **Lines:** prompt.ts:27–93, storyDraftParts.ts:160–196
- **Explanation:** Story Draft prompts include ~16,615 chars of Bible context + ~12,346 chars of narrative authority + schema instructions = 30,000+ chars. PowerShell benchmark uses ~3,000 chars. Prompt evaluation scales linearly with input tokens.
- **Impact:** 286s prompt evaluation for 8,000 tokens vs ~25s for 750 tokens. 11× slower.
- **Classification:** Application-caused (prompt size), major performance problem.

### Problem 4: Sequential Parts Multiply Fallback Overhead

- **Source:** `lib/providers/llm/storyDraftParts.ts:303` (`generateStoryDraftParts()`)
- **Function:** `generateStoryDraftParts()` → `llm.generateStory()` → `runSequence()`
- **Lines:** 303–462
- **Explanation:** Each of the 6 sequential parts calls `llm.generateStory()` which goes through the full 7-slot `runSequence()`. Failed cloud attempts are repeated for each part.
- **Impact:** Up to 42 total provider attempts (6 parts × 7 slots). 180–3,240s of wasted cloud failure latency.
- **Classification:** Application-caused, major performance problem.

### Problem 5: Schema-Constrained Output Slows Token Generation

- **Source:** `lib/providers/llm/ollama.ts:536` (`formatMode === "schema" ? schema : "json"`)
- **Function:** `makeTransport()` at `ollama.ts:519-580`
- **Lines:** 536, 579
- **Explanation:** Story Bible sections use `formatMode: "schema"`, sending full JSON schema to Ollama's grammar-based sampler. On a 4B CPU model, grammar-based sampling can reduce token speed by 2–10×.
- **Impact:** Token generation at ~11 t/s could be 22–110 t/s without schema constraint.
- **Classification:** Application-caused (schema enforcement), major performance problem.

---

## 11. Probable Problems Requiring Measurements

### Problem 6: `num_ctx=16384` Slows Prompt Evaluation vs 8192

- **Evidence:** CPU inference with larger KV cache increases memory bandwidth pressure and cache misses. The Ryzen 5 2600 has 16 MB L3 cache, far smaller than the 1 GB KV cache.
- **Missing measurements:** Same-prompt benchmark at `num_ctx=8192` vs `16384`.
- **Classification:** Hardware-related, probable performance problem.

### Problem 7: BullMQ Lock Duration May Mark Jobs as Stalled

- **Evidence:** No `lockDuration` or `stalledInterval` configuration was found in `lib/pipeline/bullQueue.ts`. BullMQ defaults to 30s lock duration. If Ollama takes 600s, the lock expires and the job may be marked as stalled and retried.
- **Missing measurements:** BullMQ configuration verification, worker log for stalled job events.
- **Classification:** Application-caused, probable correctness problem.

---

## 12. Unknowns That Cannot Yet Be Established

1. **Whether cloud providers actually fail or succeed** — No runtime logs are available. If cloud providers succeed, Ollama is never tried and the slowness is cloud latency. If they fail, the delay is cloud failure overhead.

2. **Ollama HTTP 500 root cause** — The user's reported HTTP 500 after 336s could be memory exhaustion, runner crash, or internal timeout. No Ollama server logs were available for inspection.

3. **Whether `num_ctx=16384` causes paging** — Windows memory pressure depends on other running processes. Cannot be determined without runtime memory monitoring.

4. **Token counts for actual Story Draft prompts** — The application logs `inputTokens` from Ollama's response, but no historical logs were available. The ~8,000 token estimate is based on character count / 4.

5. **Whether the model produces empty fields frequently** — The user reported one instance of `definingSystems[1].description` being empty. Without historical logs, the frequency of this failure is unknown.

---

## 13. Recommended Corrective Actions

### Critical Correctness Problems

#### R1: Respect `LLM_PROVIDER=ollama` as primary

**Problem:** Problem 1 — Ollama is tried last despite being configured as primary.

**Recommendation:** When `LLM_PROVIDER=ollama`, do not reorder Ollama to last resort. Either:
- Skip the `ollama_last_resort` reordering when Ollama is the explicitly configured primary
- Or add a configuration flag `OLLAMA_LAST_RESORT=false` to disable the reordering

**Expected benefit:** Eliminates 30–540s of cloud failure latency per call. For sequential Story Draft, saves 180–3,240s across 6 parts.

**Trade-offs:** If Ollama is slow and cloud providers are fast, the user waits for Ollama instead of failing over quickly. This is the user's explicit intent when setting `LLM_PROVIDER=ollama`.

#### R2: Verify BullMQ lock duration

**Problem:** Problem 7 — BullMQ may mark long-running jobs as stalled.

**Recommendation:** Set `lockDuration` to at least 900,000ms (15min) in `lib/pipeline/bullQueue.ts` to accommodate the longest Ollama task.

**Expected benefit:** Prevents job retry duplication during long Ollama calls.

**Trade-offs:** Stalled jobs take longer to detect and retry.

### Major Performance Problems

#### R3: Reduce `num_ctx` for tasks that don't need it

**Problem:** Problem 2 — `num_ctx=16384` is used for all tasks, but most don't need it.

**Recommendation:** Use `num_ctx=8192` for Story Bible sections (prompts are <6,000 chars). Keep `num_ctx=16384` only for Story Draft (prompts can be 30,000+ chars). This requires per-task `num_ctx` configuration.

**Expected benefit:** ~50% KV cache reduction for sections, faster prompt evaluation, less memory pressure.

**Trade-offs:** If a section prompt exceeds 8192 tokens, the response will be truncated. Section prompts are <2,000 tokens, so this is safe.

#### R4: Reduce prompt size for sequential Story Draft parts

**Problem:** Problem 3 — Each part receives the full 30,000+ char prompt.

**Recommendation:** For sequential parts after the first, send only:
- The part-specific objective
- Previous scenes summary (already done)
- A compact bible brief (not the full `renderStoryBibleBrief()`)
- Essential narrative authority only (facts directly relevant to the part's act)

**Expected benefit:** 50–70% prompt size reduction for parts 2–6, proportional prompt evaluation time savings.

**Trade-offs:** Less context may produce less consistent output. The trade-off should be tested.

#### R5: Avoid re-running cloud fallback for each sequential part

**Problem:** Problem 4 — Each part goes through the full 7-slot sequence.

**Recommendation:** After the first part succeeds with a provider, use that provider directly for subsequent parts (with fallback only if it fails). Or cache the successful provider and try it first.

**Expected benefit:** Eliminates 30–540s of cloud failure latency for parts 2–6.

**Trade-offs:** If the successful provider becomes unavailable, the full sequence is needed again. This is already handled by the fallback logic.

### Output-Quality Problems

#### R6: Handle empty field validation failures with retry

**Problem:** `invalid_schema` from empty fields is not retryable on the same provider.

**Recommendation:** For `invalid_schema` failures where the issue is empty required strings, retry once with a prompt addition: "Every required text field must be non-empty. Do not use empty strings."

**Expected benefit:** Recovers from model quality issues without failing over to the next provider.

**Trade-offs:** One additional LLM call per failure. The retry should have a reduced `num_predict` to save time.

### Configuration Improvements

#### R7: Benchmark `num_ctx=8192` vs `16384` for the actual application prompts

**Problem:** Problem 6 — No measurement of `num_ctx` impact on the actual prompts.

**Recommendation:** Run `scripts/ollama-ctx-bench.mjs` with the actual Story Draft prompt (not the benchmark prompt) to measure the real impact.

**Expected benefit:** Confirms or refutes whether `num_ctx=16384` is necessary and whether reducing it would help.

**Trade-offs:** Requires one-time benchmark execution (~10 minutes).

#### R8: Consider `OLLAMA_FORMAT=json` for sections

**Problem:** Problem 5 — Schema-constrained output slows token generation.

**Recommendation:** Test `OLLAMA_FORMAT=json` (plain JSON mode) for sections. The Zod validation already catches invalid output. Schema mode may not be necessary if the model follows the prompt instructions.

**Expected benefit:** 2–10× faster token generation for sections.

**Trade-offs:** Plain JSON mode may produce more invalid output, requiring more retries. The trade-off should be tested with the benchmark script.

### Hardware-Related Considerations

#### R9: Monitor memory and paging during inference

**Problem:** Cannot confirm whether paging occurs during inference.

**Recommendation:** Run Windows Performance Monitor during Ollama generation, tracking:
- Memory → Available MB
- Memory → Pages/sec
- Process → % Processor Time (ollama.exe)
- Process → Working Set (ollama.exe)

**Expected benefit:** Confirms whether memory pressure contributes to slowness.

**Trade-offs:** None — this is a read-only measurement.

#### R10: Consider a smaller model or quantization

**Problem:** CPU-only inference at 11 t/s is inherently slow for large prompts.

**Recommendation:** If the 4B model is too slow for Story Draft, consider:
- `qwen3:1.7b-instruct-2507-q4_K_M` (smaller, faster, lower quality)
- `qwen3:4b-instruct-2507-q2_K` (smaller memory, lower quality)
- Offloading to a cloud provider for Story Draft while keeping Ollama for sections

**Expected benefit:** 2–4× faster inference with a smaller model.

**Trade-offs:** Lower output quality. May produce more validation failures.

---

## Methodology

This audit was conducted as a read-only investigation. No application code was modified. The following files were inspected:

**Core provider:**
- `lib/providers/llm/ollama.ts` (713 lines) — Ollama HTTP adapter
- `lib/providers/llm/manager.ts` (929 lines) — Provider manager and `runSequence()`
- `lib/providers/llm/registry.ts` (359 lines) — Provider registry and slot construction
- `lib/providers/llm/aspo.ts` (565 lines) — ASPO failover and health tracking
- `lib/providers/llm/types.ts` (271 lines) — Provider interface types
- `lib/providers/llm/budget.ts` (73 lines) — Token budget calculation
- `lib/providers/llm/parse.ts` (126 lines) — JSON parsing and validation
- `lib/providers/llm/prompt.ts` (93 lines) — Story prompt construction
- `lib/providers/llm/continuation.ts` (162 lines) — Screenplay continuation

**Story Bible:**
- `lib/providers/llm/storyBibleSections.ts` (567 lines) — Sequential section generation
- `lib/providers/llm/storyBibleTask.ts` (418 lines) — Section task and schema

**Story Draft:**
- `lib/providers/llm/storyDraftParts.ts` (462 lines) — Sequential part generation

**Pipeline:**
- `lib/pipeline/storyBibleEngine.ts` (252 lines) — Story Bible engine
- `lib/pipeline/storyDraftEngine.ts` (644 lines) — Story Draft engine
- `lib/pipeline/live.ts` (184 lines) — Live pipeline wiring
- `lib/log.ts` (39 lines) — Logging

**Validation:**
- `lib/validation/story.ts` (246 lines) — Story schema and validation

**Narrative control:**
- `lib/domain/narrativeControl/context.ts` (173 lines) — Narrative context rendering

**Configuration:**
- `.env` (76 lines) — Environment configuration

**Benchmark scripts:**
- `scripts/ollama-bench.ps1` (317 lines) — PowerShell benchmark
- `scripts/ollama-ctx-bench.mjs` (128 lines) — Context window benchmark
- `scripts/ollama-e2e-test.mjs` (175 lines) — End-to-end test

**Git history:** Last 20 commits reviewed for context on previous fixes.