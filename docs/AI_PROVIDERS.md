# AI providers

Status: Phase 3. `@google/genai` and `openai` are installed. Groq, OpenRouter, and Mistral use the OpenAI-compatible chat client. The worker calls one free-tier language provider at a time for story generation. Image, video, speech, and storage adapters are still design. Licensing notes were checked against publisher documentation on 31 October 2026. Re-read the license before enabling a model. This is not legal advice.

## Rule

Engines depend on interfaces. Adapters depend on vendors. A new adapter registers by name. Pipeline methods do not change.

Configuration selects the default provider and model per category. A job stores the provider and model that actually ran.

Unconfigured providers are registered as disabled. Calls return `provider_unavailable`. Tests use an in-memory fake that implements the same interface. Routine tests do not call paid APIs.

## Interfaces

Some image APIs return a file in the same call. Video APIs and self-hosted GPU jobs are asynchronous. Wan 2.2's official repository is a local Python script, not a public REST API. The interfaces below match that split. A synchronous vendor implements `submit` by doing the work and returning `completed`. The media engine always polls, so both shapes share one job lifecycle.

```ts
type ProviderJobState = "queued" | "processing" | "completed" | "failed" | "cancelled";

type ProviderPoll = {
  state: ProviderJobState;
  progressMessage?: string;
  errorCode?: string;
  retryable?: boolean;
};

type LLMProvider = {
  readonly id: string;
  generateStructured(input: {
    task: "story" | "story_revise" | "characters" | "scenes" | "prompts";
    system: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
  }): Promise<{
    json: unknown;
    model: string;
    usage?: { inputTokens: number; outputTokens: number };
  }>;
};

type ImageProvider = {
  readonly id: string;
  readonly acceptsReferenceImage: boolean;
  submit(input: ImageRequest): Promise<{ providerJobId: string; state: ProviderJobState }>;
  getStatus(providerJobId: string): Promise<ProviderPoll>;
  getResult(providerJobId: string): Promise<{ bytes?: Buffer; remoteUrl?: string; mimeType: string }>;
};

type VideoProvider = {
  readonly id: string;
  readonly acceptsReferenceImage: boolean;
  submit(input: VideoRequest): Promise<{ providerJobId: string; state: ProviderJobState }>;
  getStatus(providerJobId: string): Promise<ProviderPoll>;
  getResult(providerJobId: string): Promise<{
    remoteUrl?: string;
    bytes?: Buffer;
    mimeType: string;
    durationSeconds?: number;
  }>;
  cancel(providerJobId: string): Promise<void>;
};

type AudioProvider = {
  readonly id: string;
  readonly capabilities: Array<"speech" | "music" | "sfx">;
  submit(input: SpeechRequest): Promise<{ providerJobId: string; state: ProviderJobState }>;
  getStatus(providerJobId: string): Promise<ProviderPoll>;
  getResult(providerJobId: string): Promise<{ bytes?: Buffer; remoteUrl?: string; mimeType: string }>;
};
```

`getResult` returns bytes or a URL on an allowlisted host. The storage adapter copies the file into our bucket. The worker does not persist an arbitrary URL as the asset location.

Webhooks are optional later. The first integrations poll. A webhook handler must verify a signature before it treats the body as a job update. Unsigned callbacks are ignored.

## Language

Implemented in `lib/providers/llm`. The pipeline calls `LLMProvider.generateStory`. It does not import a vendor SDK for local models. `createStoryProvider()` in `lib/pipeline/live.ts` builds the sequence from `LLM_PROVIDER` and `LLM_FALLBACK_PROVIDERS`.

The default provider priority is:
1. **Ollama** (`gemma3:4b` locally via Ollama HTTP API)
2. **Groq** (`openai/gpt-oss-20b`)
3. **OpenRouter** (`baidu/ernie-5.5-flash-preview:free`)
4. **Mistral** (`mistral-small-latest`)

Free-only mode is the default. `LLM_FREE_ONLY=false` is required before OpenAI, Anthropic, or DeepSeek can run. While it is on, the allowed story models are local Ollama `gemma3:4b` (free open-weights), Gemini `gemini-3.8-flash` and `gemini-3.6-flash` (both listed as free of charge on the Gemini pricing page), Groq `openai/gpt-oss-20b` on the $0 Free plan, any OpenRouter id ending in `:free` (the verified default is `baidu/ernie-5.5-flash-preview:free`), and Mistral `mistral-small-latest` in Free mode. A model outside that list is not called. Quota, rate-limit, timeout, HTTP 400, malformed JSON, and Zod failures try the next allowed provider. Invalid output is not saved.

- **Ollama**: Connects to the local Ollama HTTP API at `http://127.0.0.1:11434/api/chat`. No API key is required. Uses `gemma3:4b` by default. Configurable via `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, `OLLAMA_SECTION_TIMEOUT_MS`, `OLLAMA_TEMPERATURE`, `OLLAMA_NUM_CTX`, `OLLAMA_TOP_P`, `OLLAMA_REPEAT_PENALTY`, and `OLLAMA_FORMAT`. Output is validated with the project's Zod schemas. If Ollama is offline, times out, returns an empty or invalid response, or does not have the model installed, the same fallback loop continues to the next configured provider. Story Bible section requests use the larger of `OLLAMA_TIMEOUT_MS` and `OLLAMA_SECTION_TIMEOUT_MS` (default 300 seconds) because a section can still take a while on a 4B model, and always request schema-constrained output so a small model cannot rename required fields.
- **Groq**: `openai/gpt-oss-20b` at `https://api.groq.com/openai/v1`.
- **OpenRouter**: `baidu/ernie-5.5-flash-preview:free` at `https://openrouter.ai/api/v1`. Any specific free model must end in `:free`. The request does not include a paid model fallback list. `OPENROUTER_TIMEOUT_MS` caps one OpenRouter attempt (default 150 seconds); section requests are much smaller than a whole bible.
- **Mistral**: `mistral-small-latest` at `https://api.mistral.ai/v1`.
- **Gemini**: `gemini-3.8-flash`. `gemini-3.6-flash` is also allowed.

`LLM_MODEL` is ignored while free-only mode is on. `LLM_SEQUENCE_TIMEOUT_MS` bounds one provider-sequence attempt for normal stages. Story Bible section requests use a dedicated 900,000 ms sequence budget per section, so the chain still has time for a cloud attempt and a slow last-resort local section. BullMQ can still retry a retryable failure up to the job's `maxAttempts` of 3.

The Story Bible is the largest structured stage, so it is generated in six sequential section requests rather than one large request: `identity`, `world`, `characters`, `narrative`, `guidelines`, and `canon`. Each response contains one section, is validated against that section's Zod schema, and is merged in memory. The complete content is validated again, and the draft is saved only after all six sections pass.

- Every section uses the normal provider chain (`LLM_PROVIDER`, then `LLM_FALLBACK_PROVIDERS`), in the configured order, until one provider returns a valid section. Each section falls through independently; sections that already succeeded are not regenerated. With the cloud-first example configuration, Groq, OpenRouter, and Mistral are tried first and Ollama is the last resort. With the code default, Ollama is tried first.
- The job records the provider and model for each section. A job that used more than one provider reports `mixed`, and the per-section runs are stored in the job output.
- Each request receives a compact projection of only the relevant earlier sections (identity for world, identity and world for characters, and so on), not the full document. A single-section revision receives compact sibling sections so it can avoid contradictions. This keeps a local prompt inside the 8k context window.
- Completion budgets are per section: Ollama uses 1,500-2,500 `num_predict` tokens and the OpenAI-compatible providers use 4,000-8,000 completion tokens. A section does not reserve a whole-bible budget. The provider-facing JSON schema also caps array sizes and text lengths so a small model cannot fill the generous validation maxima.
- Ollama section requests use schema-constrained output and a low-entropy sampling profile: temperature at most 0.2, `top_p` at most 0.8, `repeat_penalty` at least 1.3, and a 128-token repeat window. They stream, so if Ollama's token-repeat guard stops a run, the partial text still goes through strict Zod validation instead of surfacing as a hard HTTP 500.
- Completed sections are stored under `job.output.storyBibleSections` with a request fingerprint. A retry with the same request resumes at the failed section. If the idea, direction, title, project settings, or draft revision changed, the cached sections are discarded and generation starts over.
- If a section fails on every provider, the job reports which section failed, preserves the completed sections, and does not save a partial draft. A retryable failure remains eligible for BullMQ retry; a non-retryable failure marks generation as failed while leaving the current draft and approved snapshot untouched.

### Story Bible output contract

The Story Bible response schema mirrors the Zod constraints that decide acceptance: required sections and fields, non-empty text, minimum list items, and the required `protagonist`/`antagonist`/`supporting`/`recurring` role values. The prompt includes the section guidance and explicit field-length limits; a full-bible request still includes a complete JSON skeleton.

Small models are still uneven, but a single section is much easier for Gemma 3 4B than the whole document. If a section is structurally invalid, only that section moves to the next provider; successful sections stay cached. Groq `openai/gpt-oss-20b` is fast but can omit fields or use objects where the contract requires strings, so it still uses `json_object` mode plus the prompt contract. Section prompts spell out the exact key shape and nesting, because a `json_object` provider does not receive the JSON schema and otherwise substitutes its own key names (for example `locations` instead of `geographyAndLocations`) or drops fields. OpenRouter's pinned free model uses `json_schema` with a 32,000-token completion budget for whole-bible calls, and smaller per-section budgets when generating sections. Zod decides whether any response can be saved.

### Operating the local Ollama provider

Install Ollama for Windows, then run `ollama pull gemma3:4b`. The desktop app starts the daemon; `ollama serve` starts it manually. Verify with `ollama list`, `curl http://127.0.0.1:11434/api/tags`, or `npm run test:ollama`, which checks the daemon, the model, plain completion, and schema-validated character extraction against the live instance.

To test sectioned Story Bible generation locally:

1. Start Ollama (`ollama serve` if the desktop app is not running), Redis, `npm run dev`, and `npm run worker` in separate terminals.
2. Open a project, open its Story Bible, and start generation. No cloud key is required while Ollama is reachable.
3. Watch the job progress: it reports `Developing Story Bible: <section> (n/6)` and then `Story Bible: n of 6 sections ready`.
4. If a section falls through, the job output records the provider and model per section; the job may report `mixed`. If all providers fail one section, the message names that section and the completed sections remain cached for the retry.
5. Run `npm test -- story-bible-generation` for the mocked section/fallback/resume suite; it does not need Ollama, Redis, or cloud keys.

The order is `LLM_PROVIDER` followed by `LLM_FALLBACK_PROVIDERS`. The code default is `ollama`, then `groq,openrouter,mistral`; `.env.example` uses the cloud-first `groq`, then `openrouter,mistral,ollama` so free cloud tiers are used first and the local model is the backstop. To change priority, edit those two values, then restart the dev server and worker. A last-slot Ollama can use up to 15 minutes per section when earlier cloud attempts fail, so quota exhaustion does not block a run.

Ollama failures are classified before the next provider is tried: connection refused (`provider_unavailable`, daemon not running), HTTP 404 (`invalid_model`, model not pulled), timeout (`timeout`, including cold model loading), empty content (`empty_response`), and malformed or schema-mismatched output (`invalid_json` / `invalid_schema`). A validation failure is never saved as a successful stage result; it moves to the next provider, and if every provider fails the job reports the failure instead of returning invented output.

Each provider needs its own API key. Keys are created in [Google AI Studio](https://aistudio.google.com/), the [Groq console](https://console.groq.com/), [OpenRouter](https://openrouter.ai/), and [Mistral Studio](https://console.mistral.ai/). The worker logs the provider name, whether a key is present, and the model. It does not log key values or make a live call at startup.

- Gemini stays on `generateContent` with a JSON schema. SDK retries are set to one attempt so they do not multiply the sequence or BullMQ.
- Groq and Mistral use Chat Completions with the same JSON schema Gemini uses. Groq asks for that schema without strict server-side rejection, sets `reasoning_effort` to `low`, and repairs empty strings, string scene numbers, and missing list fields from text the model already wrote. If Groq still returns HTTP 400, the rejected generation is repaired the same way. Groq's Story Bible request uses `json_object` mode because the full schema is rejected by its grammar-constrained path; the prompt lists every required key and Zod still decides whether the result can be saved. OpenRouter uses `json_object` for the screenplay and stage calls, and `json_schema` for the Story Bible with a pinned free model that supports structured output. A response wrapped in a code fence is still parsed. A story with no real scene text is not saved.
- OpenAI (`gpt-6-luna`), Anthropic (`claude-haiku-5-5`), and DeepSeek (`deepseek-flash`) stay in the registry. They run only when `LLM_FREE_ONLY=false`.
- Token counts are stored only when the response includes them. Prices are not invented.
- The story service parses the JSON with Zod. A schema mismatch tries the next allowed provider. A story is saved only after Zod accepts it.
- Free tiers are limited. Gemini free-tier content may be used to improve Google's products. Groq's published numeric limits are the Developer plan, which bills per token. Mistral Free mode has included monthly usage, and extra usage is pay-as-you-go, which this mode does not request. A quota or billing error tries the next free provider.

The story service asks for title, synopsis, theme, setting, characters, beginning, conflict, rising action, climax, resolution, and a screenplay whose estimated seconds fit `targetDurationSeconds`. A one-minute project rejects a screenplay whose estimated duration is far outside that target.

## Image

| Model | Weights | Commercial use in this product | How it would run |
| --- | --- | --- | --- |
| FLUX.2 [klein] 4B | Apache 2.0, per Black Forest Labs | Allowed. BFL also states that images from their API include commercial rights in the per-image price ([commercial API use](https://help.bfl.ai/articles/4375863104-can-i-use-the-api-for-a-commercial-application)) | First image adapter. Hosted API, paid per image. Weights can also be self-hosted; GPU time is still a cost |
| FLUX.1 [schnell] | Apache 2.0 ([model card](https://github.com/black-forest-labs/flux/blob/main/model_cards/FLUX.1-schnell.md)) | Allowed, including commercial use | Alternative self-host or hosted API. Not required for the first adapter |
| FLUX.1 [dev], FLUX.2 [dev], FLUX.2 [klein] 9B | FLUX Non-Commercial License | Not allowed here without a separate commercial license from BFL | Do not wire as a default |
| Stable Diffusion 3.5 | Stability Community License | Not the first adapter. Re-read that license, including any revenue threshold and registration, before any integration | Not the first adapter |

Default image plan: a Black Forest Labs API adapter behind `ImageProvider`, model FLUX.2 [klein] 4B, for character references and scene stills. Their image API is asynchronous: the create call returns a `polling_url`, and the result sample is a signed URL. BFL documents that those delivery URLs are short-lived (10 minutes in the image guide) and should be downloaded and served from our own storage. Phase 4 will re-read [the image guide](https://docs.bfl.ml/quick_start/generating_images) before coding the request. No client is written in this phase. If the API key is absent, the adapter stays disabled and character profiles can still be edited.

Character references are generated before scene video. Regeneration adds an asset. It does not replace the selected image until the user selects it.

## Video

| Model | License, from the publisher | Inference | First integration |
| --- | --- | --- | --- |
| LTX | Hosted API is billed per second of output ([pricing](https://docs.ltx.io/pricing)). Open weights: Lightricks states that companies under $10M annual revenue may use the model commercially under the community license, and that companies at or above that revenue need a paid license when the model is part of a revenue-driving product ([license page](https://ltx.io/model/license)) | Hosted HTTP API. Documented image-to-video is `POST https://api.ltx.io/v2/image-to-video`, then poll, then download `result.video_url` ([image-to-video](https://docs.ltx.io/api-documentation/api-reference/async-video-generation/submit-image-to-video)). Models listed there include `ltx-2-3-fast`, `ltx-2-3-pro`, `ltx-2-5-fast`, and `ltx-2-5-pro` | First video adapter, because a documented HTTP API exists and no GPU is required to build the pipeline. Initial model target is `ltx-2-3-fast` at 720p, which their pricing page lists at $0.03 per output second. Confirm the price at implementation time |
| Wan 2.2 | Apache 2.0 ([LICENSE](https://github.com/Wan-Video/Wan2.2/blob/main/LICENSE.txt)). The README also requires lawful use | Official path is local `python generate.py`. TI2V-5B does text-to-video and image-to-video. The single-GPU command with offload is documented at 24 GB VRAM (RTX 4090 class). T2V-A14B single-GPU is documented at 80 GB VRAM | Self-hosted adapter second. Checkpoint target is TI2V-5B, not A14B. The adapter talks to an inference service this project owns. It does not pretend `generate.py` is a REST API |
| HunyuanVideo | Tencent Hunyuan Community License ([LICENSE](https://github.com/Tencent/HunyuanVideo/blob/main/LICENSE.txt)). Territory excludes the European Union, the United Kingdom, and South Korea | Self-hosted, large GPU | Not in the first integration. Re-read the full grant, including any user-count clause, before any later adapter |

Lip sync is a later speech-to-video path (Wan S2V is a separate 14B checkpoint). The first release mixes dialogue as its own audio track.

## Audio

| Engine | License | Fit |
| --- | --- | --- |
| Kokoro-82M | Apache 2.0 ([model card](https://huggingface.co/hexgrad/Kokoro-82M)). The card welcomes commercial deployment. Weights are free to obtain. Running them still uses CPU, or a paid hosted TTS API | Default speech adapter. Runs in the worker. Speech only. It does not generate music or sound effects |
| Piper (`OHF-Voice/piper1-gpl`) | GPL-3.0-or-later. Voice files have their own terms | Poor fit for linking into this proprietary application. Not the default |

Music and sound effects need a different provider, chosen when one is actually integrated. Until then those asset types are uploads, and render proceeds without them.

## What "free" means

Open weights under Apache 2.0 (Wan 2.2, FLUX.1 schnell, FLUX.2 klein 4B, Kokoro) permit commercial use of the weights. They are not free to operate. GPU time, storage, and bandwidth cost money. Hosted APIs (Gemini paid tier, BFL, LTX) charge for requests. A community license with a revenue cap (LTX open weights) is not an unconditional commercial license.

Failed jobs are not marked billable.
