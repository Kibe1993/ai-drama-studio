import "server-only";

const PERMANENT_CODES = new Set([
  "invalid_media",
  "invalid_video",
  "content_rejected",
  "cost_limit_exceeded",
  "ownership",
  "no_provider_available",
  "unknown_model",
  "safety_rejection",
  "media_signature_mismatch",
  "media_type_mismatch",
  "media_file_too_large",
  "empty_media_file",
  "gates_not_met",
  "voice_profile_required",
  "unlicensed_music",
]);

const TRANSIENT_CODES = new Set([
  "provider_transient",
  "timeout",
  "render_timeout",
  "storage_transient",
  "ffprobe_failed",
  "ffmpeg_nonzero_exit",
]);

export type FailureClassification = "transient" | "permanent" | null;

export function classifyFailure(code: string | undefined | null): FailureClassification {
  if (!code) return null;
  if (PERMANENT_CODES.has(code)) return "permanent";
  if (TRANSIENT_CODES.has(code)) return "transient";
  return "transient";
}

export function isRetryable(classification: FailureClassification): boolean {
  return classification === "transient";
}