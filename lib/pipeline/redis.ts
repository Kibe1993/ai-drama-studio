import IORedis from "ioredis";

export function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return new IORedis(url, { maxRetriesPerRequest: null });
}

export const QUEUE_NAMES = [
  "studio-llm",
  "studio-image",
  "studio-video",
  "studio-audio",
  "studio-render",
] as const;

export function queueNameFor(jobType: string): (typeof QUEUE_NAMES)[number] {
  if (jobType === "render.final") return "studio-render";
  if (jobType === "video.scene") return "studio-video";
  if (jobType.startsWith("audio.")) return "studio-audio";
  if (jobType.startsWith("image.")) return "studio-image";
  return "studio-llm";
}
