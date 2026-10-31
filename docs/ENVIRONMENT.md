# Environment

Status: Phase 1 reads `MONGODB_URI`, the Clerk keys, and `ADMIN_USER_IDS` when it is set. `APP_URL`, provider, Redis, and storage variables are not read yet. Do not commit values.

Copy `.env.example` to `.env.local`.

| Name | When it is used | Notes |
| --- | --- | --- |
| `MONGODB_URI` | Phase 1 | This application's database. Server only |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Phase 1 | Publishable |
| `CLERK_SECRET_KEY` | Phase 1 | Server only |
| `ADMIN_USER_IDS` | Phase 1 | Optional comma-separated Clerk ids, in addition to `publicMetadata.role === "admin"` |
| `APP_URL` | Later, for public links | Not read in Phase 1 |
| `GEMINI_API_KEY` | Phase 3 | Server and worker only. Absent key disables the adapter |
| `LLM_PROVIDER` | Phase 3 | Default `gemini` |
| `LLM_MODEL` | Phase 3 | Chosen from Google's current model list when the SDK is wired |
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
| `REDIS_URL` | Phase 2 | The Next.js process that enqueues, and the worker |

`ProviderConfiguration` does not replace these secrets. An empty key disables that provider. The UI shows it as unavailable.
