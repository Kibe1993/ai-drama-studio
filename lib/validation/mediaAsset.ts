import { createHash } from "node:crypto";
import { z } from "zod";

export const MEDIA_ASSET_TYPES = [
  "character_reference", "scene_image", "scene_video", "dialogue_audio", "narration_audio",
  "music", "sound_effect", "subtitle", "final_render",
] as const;
export const MEDIA_VALIDATION_STATUSES = ["signature_verified", "metadata_verified", "playable"] as const;
export const MEDIA_REVIEW_STATUSES = ["pending", "approved", "rejected", "archived"] as const;

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export const createMediaAssetSchema = z.object({
  projectId: objectId,
  episodeId: objectId.nullable().optional(),
  sceneId: objectId.nullable().optional(),
  shotId: z.string().trim().min(1).max(120).nullable().optional(),
  generationJobId: objectId.nullable().optional(),
  canonicalEntityId: objectId.nullable().optional(),
  type: z.enum(MEDIA_ASSET_TYPES),
  provider: z.string().trim().min(1).max(80),
  model: z.string().trim().max(160).default(""),
  idempotencyKey: z.string().trim().min(8).max(180).regex(/^[A-Za-z0-9._:-]+$/),
  mimeType: z.string().trim().min(3).max(120),
  fileName: z.string().trim().min(1).max(160),
  durationSeconds: z.number().positive().nullable().default(null),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  frameRate: z.number().positive().nullable().default(null),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export type CreateMediaAssetInput = z.infer<typeof createMediaAssetSchema>;
export type MediaAssetRecord = CreateMediaAssetInput & {
  id: string;
  clerkUserId: string;
  storageProvider: "local" | "s3" | "cloudinary";
  storageKey: string;
  byteSize: number;
  sha256: string;
  validationStatus: (typeof MEDIA_VALIDATION_STATUSES)[number];
  storageVerified: boolean;
  reviewStatus: (typeof MEDIA_REVIEW_STATUSES)[number];
  canonicalEntityId?: string | null;
  previousVersionId?: string | null;
  replacedById?: string | null;
  isMock: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ValidatedMediaBytes = {
  mimeType: string;
  byteSize: number;
  sha256: string;
  validationStatus: "signature_verified";
  width: number | null;
  height: number | null;
};

const MAX_BYTES: Record<CreateMediaAssetInput["type"], number> = {
  character_reference: 25 * 1024 * 1024,
  scene_image: 25 * 1024 * 1024,
  scene_video: 512 * 1024 * 1024,
  dialogue_audio: 100 * 1024 * 1024,
  narration_audio: 100 * 1024 * 1024,
  music: 100 * 1024 * 1024,
  sound_effect: 100 * 1024 * 1024,
  subtitle: 1024 * 1024,
  final_render: 1024 * 1024 * 1024,
};

export function validateMediaBytes(bytes: Uint8Array, declaredMimeType: string, type: CreateMediaAssetInput["type"]): ValidatedMediaBytes {
  if (bytes.byteLength === 0) throw new Error("empty_media_file");
  if (bytes.byteLength > MAX_BYTES[type]) throw new Error("media_file_too_large");
  const suppliedMime = declaredMimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const mime = suppliedMime === "image/jpg" ? "image/jpeg" : suppliedMime === "audio/x-wav" ? "audio/wav" : suppliedMime;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let detected = "";
  let width: number | null = null;
  let height: number | null = null;
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);

  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) && bytes.byteLength >= 24 && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") {
    detected = "image/png"; width = view.getUint32(16); height = view.getUint32(20);
  } else if (starts(0xff, 0xd8, 0xff)) {
    detected = "image/jpeg";
  } else if (bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    detected = "image/webp";
  } else if (bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WAVE") {
    detected = "audio/wav";
  } else if (bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    detected = "video/mp4";
  } else if (starts(0x1a, 0x45, 0xdf, 0xa3)) {
    detected = "video/webm";
  } else if (bytes.byteLength >= 3 && String.fromCharCode(...bytes.slice(0, 3)) === "ID3") {
    detected = "audio/mpeg";
  } else if (bytes.byteLength >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === "WEBVTT") {
    detected = "text/vtt";
  } else if (bytes.byteLength >= 8 && /^\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(new TextDecoder().decode(bytes.slice(0, 100)))) {
    detected = "application/x-subrip";
  }

  if (!detected || detected !== mime) throw new Error("media_signature_mismatch");
  const allowed: Record<CreateMediaAssetInput["type"], string[]> = {
    character_reference: ["image/png", "image/jpeg", "image/webp"],
    scene_image: ["image/png", "image/jpeg", "image/webp"],
    scene_video: ["video/mp4", "video/webm"],
    dialogue_audio: ["audio/wav", "audio/mpeg"],
    narration_audio: ["audio/wav", "audio/mpeg"],
    music: ["audio/wav", "audio/mpeg"],
    sound_effect: ["audio/wav", "audio/mpeg"],
    subtitle: ["text/vtt", "application/x-subrip"],
    final_render: ["video/mp4", "video/webm"],
  };
  if (!allowed[type].includes(detected)) throw new Error("media_type_mismatch");
  if (width === 0 || height === 0) throw new Error("invalid_media_dimensions");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { mimeType: detected, byteSize: bytes.byteLength, sha256, validationStatus: "signature_verified", width, height };
}
