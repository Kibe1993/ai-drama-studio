# Technical risks

Status: Phase 0. These are design risks, not results from a running system.

## Inference is not the web app

Wan 2.2 and FFmpeg cannot run inside a short Next.js request. If deployment is only the web app, video generation and final render will not work. Phase 2 must prove the queue with mocks before any model is connected. Phase 6 must not start by downloading Wan weights onto a laptop and calling that production.

## Character consistency is partial

Passing a reference image into image-to-video is the mechanism we control. Models do not guarantee the same face in every clip. The product copy and the job record must say when a clip was text-only.

## Cost can spike per scene

A 1–3 minute drama is many clips, stills, and speech lines. LTX bills per output second. BFL bills per image. Gemini bills per token on the paid tier. A user action that regenerates one scene must not regenerate the others. Limits are checked before enqueue, but the limit system itself is Phase 9. Until then, live provider calls stay opt-in and keyed.

## Open weights are not free to run

Apache 2.0 permits commercial use of Wan 2.2, FLUX.2 klein 4B, and Kokoro. GPU, CPU, storage, and bandwidth still cost money. FLUX dev checkpoints and Piper's GPL engine are the wrong defaults for this product. HunyuanVideo's license excludes the EU, the UK, and South Korea, so it is not a fallback.

## Provider APIs change

LTX already documents both 2.3 and 2.5 model ids. BFL's endpoint list and prices change. Phase 4 and Phase 6 must re-read the official docs before writing the HTTP client. This design names the intended first models. It does not ship a client.

## Jobs must survive a restart

Pipeline state lives in MongoDB. Redis is transport. An in-memory job map would lose work when the process restarts. Idempotency keys stop a double-click from creating two paid generations.

## Signed provider URLs expire

BFL documents a 10-minute image sample URL. The worker must copy bytes into our bucket before marking the job complete. Storing the provider URL as the asset would break playback.

## SSRF

The worker must not fetch a URL supplied by the user or an unchecked redirect. Allowlist the provider host, require HTTPS, and reject a change of host.

## Licensing is not a one-time note

The notes in `docs/AI_PROVIDERS.md` were read on 31 October 2026. They are not a legal opinion. A model is not enabled in production until its license is read again.
