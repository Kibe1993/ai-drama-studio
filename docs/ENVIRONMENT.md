# Environment

Status: The app reads `MONGODB_URI`, the Clerk keys, `ADMIN_USER_IDS` when it is set, `REDIS_URL`, language-provider variables, and optional local media settings. Image, video, speech, S3, and Cloudinary adapters are not integrated. Do not commit values. Story generation is free-only unless `LLM_FREE_ONLY=false`. A free tier still has rate limits and a quota.

Copy `.env.example` to `.env.local`. The worker and the Next.js server read these names. Values stay on the server. They are not printed in logs or shown in the UI.

Free-only mode is the default (`LLM_FREE_ONLY` unset or `true`), so OpenAI, Anthropic, and DeepSeek are not called. The configured default provider priority is:
1. **Ollama** (`gemma3:4b` running locally via Ollama HTTP API)
2. **Groq** (`openai/gpt-oss-20b`)
3. **OpenRouter** (`baidu/ernie-5.5-flash-preview:free`)
4. **Mistral** (`mistral-small-latest`)

Restart the dev server and the worker after changing provider settings. If every provider in the sequence fails, the job reports that no language provider is currently available.

## Local Ollama Setup (Gemma 3 4B)

1. **Install Ollama**: Download and run the Windows installer from [ollama.com](https://ollama.com/download).
2. **Pull the model**: Run `ollama pull gemma3:4b` in PowerShell or CMD.
3. **Start and verify Ollama**:
   - The Windows installer starts the daemon automatically. If it is not running, run `ollama serve`.
   - Run `ollama list` to confirm `gemma3:4b` appears.
   - Run `ollama run gemma3:4b "Say ready in one word"` to confirm the model loads and generates.
   - Run `curl http://127.0.0.1:11434/api/tags` to verify the local HTTP daemon responds.
   - Run `npm run test:ollama` to exercise this app's provider against the live daemon.
4. **Troubleshoot connection failures**:
   - If you see `Ollama is not running (connection refused)`: start Ollama from the Windows notification tray or run `ollama serve`.
   - If you see `Ollama model 'gemma3:4b' is not installed`: Run `ollama pull gemma3:4b`.
   - If the first generation times out: loading the model into memory on a cold start takes extra time. Keep `OLLAMA_TIMEOUT_MS=120000` or higher in `.env`, and note that the whole sequence is also bounded by `LLM_SEQUENCE_TIMEOUT_MS`.
   - If a Story Bible section times out: Story Bible generation uses one request per section. `OLLAMA_SECTION_TIMEOUT_MS` (default `300000`, clamped between 10,000 and 300,000) gives a section its own cap. Section requests use a dedicated 15-minute provider-sequence budget (independent of `LLM_SEQUENCE_TIMEOUT_MS`) so a slow last-resort local section still gets time after earlier cloud attempts fail.
   - If responses are truncated or the model runs out of context: raise `OLLAMA_NUM_CTX` (for example to `16384`), within available memory. Section requests receive compact context, so the default `8192` is usually enough.
   - If a stage reports `invalid_json` or `invalid_schema`: Gemma 3 4B did not satisfy that stage's Zod contract. The next provider is tried. Story Bible sections always use schema-constrained output; `OLLAMA_FORMAT=schema` does the same for other stages, and Zod still decides. They also cap sampling at `temperature` 0.2, `top_p` 0.8, and `repeat_penalty` 1.3 with a wider repeat window, because a small model can otherwise loop inside one long JSON string until Ollama aborts with `token repeat limit reached`. If schema mode times out for a section, the next provider is tried.
   - A Story Bible job is the slowest stage, but it is split into six sequential section requests. Progress reports `n of 6 sections ready`; a retry resumes at the failed section instead of repeating completed ones. If every provider fails a section, no partial draft is saved and the current draft and approved snapshot are left untouched.

The app keeps one Redis connection for enqueueing. Connection timeouts are logged and do not surface as unhandled Redis errors. The worker still uses its own connection for BullMQ.

| Name | When it is used | Notes |
| --- | --- | --- |
| `MONGODB_URI` | Phase 1 | This application's database. Server only |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Phase 1 | Publishable |
| `CLERK_SECRET_KEY` | Phase 1 | Server only |
| `ADMIN_USER_IDS` | Phase 1 | Optional comma-separated Clerk ids, in addition to `publicMetadata.role === "admin"` |
| `APP_URL` | Later, for public links | Not read in Phase 1 |
| `LLM_FREE_ONLY` | Story generation | Default on. `false` is required before any paid provider can run |
| `CASNA_SEMANTIC_VALIDATION` | Story generation | Optional. `1`, `true`, or `yes` runs the advisory continuity critic after a screenplay is generated. Its findings are saved as warnings and never block approval |
| `OLLAMA_BASE_URL` | Story generation | Base URL for local Ollama daemon. Default `http://127.0.0.1:11434`. No API key required |
| `OLLAMA_MODEL` | Story generation | Local model tag. Default `gemma3:4b` |
| `OLLAMA_ENDPOINT` | Story generation | Ollama chat endpoint. Default `/api/chat` |
| `OLLAMA_TIMEOUT_MS` | Story generation | Provider attempt timeout in milliseconds. Default `120000` (2 minutes). Clamped between 10,000 and 300,000 |
| `OLLAMA_SECTION_TIMEOUT_MS` | Story generation | Timeout cap for one Story Bible section request. Default `300000` (5 minutes). Clamped between 10,000 and 300,000. The section attempt uses the larger of this and `OLLAMA_TIMEOUT_MS` |
| `OLLAMA_TEMPERATURE` | Story generation | Temperature for Ollama generation. Default `0.7`. Story Bible sections cap it at `0.2` |
| `OLLAMA_NUM_CTX` | Story generation | Context window tokens for Ollama. Default `8192` |
| `OLLAMA_TOP_P` | Story generation | Nucleus sampling cutoff. Default `0.9`. Story Bible sections cap it at `0.8` |
| `OLLAMA_REPEAT_PENALTY` | Story generation | Repetition penalty. Default `1.1`. Values below `1.0` are clamped to `1.0` so normal responses are not cut off. Story Bible sections use at least `1.3` with a 128-token repeat window |
| `OLLAMA_FORMAT` | Story generation | `schema` asks Ollama to constrain structured stages with the stage's JSON schema. Default plain JSON mode for non-section stages; Story Bible sections always use their section schema. Zod validation still decides whether output is accepted |
| `OLLAMA_DISABLED` / `OLLAMA_ENABLED` | Story generation | Set `OLLAMA_DISABLED=true` (or `OLLAMA_ENABLED=false`) to make the local provider ineligible. If Ollama is still `LLM_PROVIDER`, the sequence fails at configuration instead of silently starting elsewhere; set a different primary |
| `GEMINI_API_KEY` | Story generation | Server and worker only. Create a key in [Google AI Studio](https://aistudio.google.com/). Free tier input and output for `gemini-3.8-flash` and `gemini-3.6-flash` are listed as free of charge. Limits are per project and are not unlimited. Free-tier content may be used to improve Google's products |
| `GEMINI_MODEL` | Story generation | Free-only default `gemini-3.8-flash`. Also allowed: `gemini-3.6-flash` |
| `GROQ_API_KEY` | Story generation | Server and worker only. Create a key in the [Groq console](https://console.groq.com/). The Free plan is $0. The published rate-limit table is the Developer plan, which bills per token |
| `GROQ_MODEL` | Story generation | Free-only default `openai/gpt-oss-20b` |
| `OPENROUTER_API_KEY` | Story generation | Server and worker only. Create a key at [OpenRouter](https://openrouter.ai/). Only a model id ending in `:free` is allowed |
| `OPENROUTER_MODEL` | Story generation | Free-only default `baidu/ernie-5.5-flash-preview:free`. This verified free model has a 1M-token context window. `meta-llama/llama-3.3-8b-instruct:free` was removed from OpenRouter (Nov 2026). Any id ending in `:free` is accepted |
| `OPENROUTER_TIMEOUT_MS` | Story generation | One OpenRouter attempt cap. Default `150000` (2.5 minutes), clamped between `15000` and `300000`. Section requests are smaller than a whole bible, but a whole-bible regenerate makes six sequential calls |
| `MISTRAL_API_KEY` | Story generation | Server and worker only. Create a key in [Mistral Studio](https://console.mistral.ai/). Free mode includes limited monthly usage and needs no card. Extra usage requires pay-as-you-go, which this mode does not request |
| `MISTRAL_MODEL` | Story generation | Free-only default `mistral-small-latest`, the model in Mistral's free-mode setup example |
| `LLM_PROVIDER` | Story generation | First provider. Code default `ollama`; `.env.example` uses `groq` so the free cloud tiers run first |
| `LLM_FALLBACK_PROVIDERS` | Story generation | Default fallback list: `groq,openrouter,mistral`. `.env.example` uses `openrouter,mistral,ollama` so the local model is the last resort. To change priority, update this comma-separated list |
| `LLM_MODEL` | Story generation | Ignored while free-only mode is on |
| `LLM_SEQUENCE_TIMEOUT_MS` | Story generation | Wall clock for one provider-sequence attempt. Default `300000` (5 minutes). Values are clamped between `15000` and `300000`. Each provider stops at its configured timeout cap or remaining fair-share allowance. Story Bible section requests use a dedicated 900,000 ms sequence budget per section instead, so earlier cloud attempts cannot starve a slow last-resort local section |
| `IMAGE_PROVIDER` | Phase 4 | Default `bfl` when a key exists, otherwise disabled |
| `IMAGE_PROVIDER_API_KEY` | Phase 4 | Server and worker only |
| `IMAGE_MODEL` | Phase 4 | Default target `flux-2-klein-4b`, confirmed against BFL docs at implementation time. Not a non-commercial FLUX dev model |
| `VIDEO_PROVIDER` | Phase 6 | Default `ltx` for the hosted API |
| `VIDEO_PROVIDER_API_KEY` | Phase 6 | Worker only |
| `VIDEO_MODEL` | Phase 6 | Initial target `ltx-2-3-fast`, confirmed against LTX docs at implementation time |
| `VIDEO_INFERENCE_BASE_URL` | Later Wan worker | Allowlisted origin of the self-hosted inference service. Unused until that adapter exists |
| `AUDIO_PROVIDER` | Phase 6 | Default `kokoro` |
| `AUDIO_PROVIDER_API_KEY` | Only if a hosted TTS adapter is selected | Self-hosted Kokoro may not need a vendor key |
| `CLOUDINARY_CLOUD_NAME` | Phase 4 stills | Optional. Server only |
| `CLOUDINARY_API_KEY` | Phase 4 | Server only |
| `CLOUDINARY_API_SECRET` | Phase 4 | Server only |
| `S3_ENDPOINT` | Phase 6 | S3-compatible endpoint. HTTPS |
| `S3_BUCKET` | Phase 6 | This application's bucket |
| `S3_REGION` | Phase 6 | Required by the AWS SDK even for some compatible stores |
| `S3_ACCESS_KEY_ID` | Phase 6 | Server and worker only |
| `S3_SECRET_ACCESS_KEY` | Phase 6 | Server and worker only |
| `MEDIA_STORAGE_PROVIDER` | Local media foundation | Leave unset until needed. `local` explicitly enables the development filesystem adapter. `s3` and `cloudinary` are not implemented and fail closed |
| `MEDIA_LOCAL_STORAGE_DIR` | Local media foundation | Optional local-only path; defaults to `./storage/media`. Ignored by Git. Not durable production storage |
| `FFPROBE_PATH` | Optional media inspection | Absolute path to an installed FFprobe executable. No FFprobe/FFmpeg executable was found on this machine during the storage phase; leaving this unset disables playable-media inspection |
| `REDIS_URL` | Phase 2 worker and enqueue | Required to process jobs outside the tests. Without it, a job is saved and marked waiting for the queue |

`ProviderConfiguration` does not replace these secrets. An empty key disables that provider. The UI shows it as unavailable.
