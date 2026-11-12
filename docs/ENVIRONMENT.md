# Environment

Status: The app reads `MONGODB_URI`, the Clerk keys, `ADMIN_USER_IDS` when it is set, `REDIS_URL`, and the language-provider variables below. Image, video, speech, and storage variables are still not read. Do not commit values. Story generation is free-only unless `LLM_FREE_ONLY=false`. A free tier still has rate limits and a quota.

Copy `.env.example` to `.env.local`. The worker and the Next.js server read these names. Values stay on the server. They are not printed in logs or shown in the UI.

The local `.env` still lists the older paid fallback names until you edit it. Free-only mode is the default (`LLM_FREE_ONLY` unset or `true`), so OpenAI, Anthropic, and DeepSeek are not called. The free sequence is Gemini `gemini-3.8-flash`, then Groq `openai/gpt-oss-20b`, OpenRouter `openrouter/free`, and Mistral `mistral-small-latest`. Restart the dev server and the worker after changing `.env`. A 400, quota error, or rate limit from one free provider continues to the next free provider. Rejected credentials stop that provider's sequence entry. If every free provider fails, the job says that no free language provider is currently available.

The app keeps one Redis connection for enqueueing. Connection timeouts are logged and do not surface as unhandled Redis errors. The worker still uses its own connection for BullMQ.

| Name | When it is used | Notes |
| --- | --- | --- |
| `MONGODB_URI` | Phase 1 | This application's database. Server only |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Phase 1 | Publishable |
| `CLERK_SECRET_KEY` | Phase 1 | Server only |
| `ADMIN_USER_IDS` | Phase 1 | Optional comma-separated Clerk ids, in addition to `publicMetadata.role === "admin"` |
| `APP_URL` | Later, for public links | Not read in Phase 1 |
| `LLM_FREE_ONLY` | Story generation | Default on. `false` is required before any paid provider can run |
| `GEMINI_API_KEY` | Story generation | Server and worker only. Create a key in [Google AI Studio](https://aistudio.google.com/). Free tier input and output for `gemini-3.8-flash` and `gemini-3.6-flash` are listed as free of charge. Limits are per project and are not unlimited. Free-tier content may be used to improve Google's products |
| `GEMINI_MODEL` | Story generation | Free-only default `gemini-3.8-flash`. Also allowed: `gemini-3.6-flash` |
| `GROQ_API_KEY` | Story generation | Server and worker only. Create a key in the [Groq console](https://console.groq.com/). The Free plan is $0. The published rate-limit table is the Developer plan, which bills per token |
| `GROQ_MODEL` | Story generation | Free-only default `openai/gpt-oss-20b` |
| `OPENROUTER_API_KEY` | Story generation | Server and worker only. Create a key at [OpenRouter](https://openrouter.ai/). Only `openrouter/free` or a model id ending in `:free` is allowed |
| `OPENROUTER_MODEL` | Story generation | Free-only default `openrouter/free`. That router selects a free model and does not fall back to a paid model |
| `MISTRAL_API_KEY` | Story generation | Server and worker only. Create a key in [Mistral Studio](https://console.mistral.ai/). Free mode includes limited monthly usage and needs no card. Extra usage requires pay-as-you-go, which this mode does not request |
| `MISTRAL_MODEL` | Story generation | Free-only default `mistral-small-latest`, the model in Mistral's free-mode setup example |
| `LLM_PROVIDER` | Story generation | First provider. Free-only default `gemini` |
| `LLM_FALLBACK_PROVIDERS` | Story generation | Free-only example: `groq,openrouter,mistral`. Paid names are skipped while free-only mode is on |
| `LLM_MODEL` | Story generation | Ignored while free-only mode is on |
| `LLM_SEQUENCE_TIMEOUT_MS` | Story generation | Wall clock for one delivery of the whole provider sequence. Default `120000`. Values are clamped between `15000` and `180000`. Each provider still stops at 90 seconds or the time remaining, whichever is smaller |
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
| `REDIS_URL` | Phase 2 worker and enqueue | Required to process jobs outside the tests. Without it, a job is saved and marked waiting for the queue |

`ProviderConfiguration` does not replace these secrets. An empty key disables that provider. The UI shows it as unavailable.
