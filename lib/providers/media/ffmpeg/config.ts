import "server-only";

export function getFfmpegPath(): string | undefined {
  return process.env.FFMPEG_PATH?.trim() || undefined;
}

export function getFfprobePath(): string | undefined {
  return process.env.FFPROBE_PATH?.trim() || undefined;
}

export function assertFfmpegConfigured(): string {
  const path = getFfmpegPath();
  if (!path) throw new Error("ffmpeg_not_configured");
  return path;
}

export function assertFfprobeConfigured(): string {
  const path = getFfprobePath();
  if (!path) throw new Error("ffprobe_not_configured");
  return path;
}

export function getRenderTimeoutMs(): number {
  const raw = Number(process.env.RENDER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1_800_000;
}

export function getRenderConcurrency(): number {
  const raw = Number(process.env.RENDER_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
}

export function getVideoPollIntervalMs(): number {
  const raw = Number(process.env.VIDEO_POLL_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 15_000;
  return Math.min(60_000, Math.max(10_000, Math.floor(raw)));
}

export function getVideoOperationTimeoutMs(): number {
  const raw = Number(process.env.VIDEO_OPERATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
}