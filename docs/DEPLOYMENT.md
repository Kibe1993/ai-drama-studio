# Deployment

Status: Phase 0. Nothing in this repository has been deployed.

## Six places

| Place | Runs | Does not run |
| --- | --- | --- |
| Next.js host | UI, route handlers, enqueue | Wan, FFmpeg, long polls that exceed the platform timeout |
| MongoDB | This application's data | Media bytes |
| Redis | BullMQ | The only copy of job status |
| Worker host | Node worker, FFmpeg, Kokoro if self-hosted | The public website |
| Object storage | Images, audio, video | Application secrets in object metadata |
| Inference host | LTX's cloud, or a GPU box for Wan 2.2 TI2V-5B (24 GB VRAM class, per Wan's README) | Assumed to be included in a Next.js function |

A host that only runs Next.js can serve the UI. It does not generate video. Redis, the worker, storage, and inference are separate.

## Wan 2.2, when that adapter is turned on

The official repository runs `python generate.py` locally. The inference host needs the checkpoint, PyTorch, and a GPU. TI2V-5B is the first checkpoint this design allows. The A14B single-GPU command asks for 80 GB VRAM. That host should expose a small HTTP service defined in Phase 6, on a private network, with a shared secret. The Next.js app never loads the weights.

## LTX, the first video path

The worker calls LTX's hosted API with `VIDEO_PROVIDER_API_KEY`. Billing is per second of output. No GPU is required for that adapter. The integration is inactive until Phase 6 and a key exist.

## FFmpeg

Installed on the worker image, not assumed on the Next.js host. Render queue concurrency stays at 1 until a second worker is added on purpose.

## Secrets

Platform environment variables supply keys. They are not written to `ProviderConfiguration` or to client bundles. `NEXT_PUBLIC_` is only for the Clerk publishable key and, if needed, the public origin.
