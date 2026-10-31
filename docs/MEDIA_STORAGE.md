# Media storage

Status: Phase 0 design. No storage adapter is implemented.

## Provider

`StorageProvider`:

- `put({ key, body, contentType })`
- `getSignedReadUrl(key, ttl)`
- `delete(key)`
- `head(key)`

Implementations: `cloudinary` and `s3`. The registry chooses by asset type.

| Asset | Store | Reason |
| --- | --- | --- |
| Character stills, scene stills, thumbnails | Cloudinary, or S3 if Cloudinary is unset | Image delivery. Studio uploads have their own size policy |
| Scene video, audio, subtitles, masters | S3-compatible bucket | Object size and stable keys |

MongoDB stores `storageProvider` and `storageKey`. The browser receives a short-lived signed URL created after an ownership check. The signed URL is not the source of truth.

Provider result URLs are copied into our bucket before the job is marked completed. Black Forest Labs documents that image sample URLs expire quickly. LTX result URLs are downloaded the same way. A user-supplied URL is never fetched by the server.

## Keys

`studio/{clerkUserId}/{projectId}/{assetId}/{filename}`

The filename is generated. An original upload name is stored as metadata after path characters are stripped.

## Uploads

User uploads (a replacement reference image, optional music) are checked for size, an extension allowlist, and magic bytes. Video uploads have a larger cap than images. The two caps are separate constants.

## SSRF

Workers fetch bytes by storage key, or from a provider result URL whose origin is on that provider's allowlist and whose scheme is HTTPS. Redirects to other hosts are rejected. The renderer does not accept a URL from the client.

## Deletion

Deleting a project deletes asset rows and enqueues storage deletes for those keys.
