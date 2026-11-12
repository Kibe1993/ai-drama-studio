import IORedis from "ioredis";
import { log } from "@/lib/log";

export function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const connection = new IORedis(url, { maxRetriesPerRequest: null, connectTimeout: 15_000 });
  connection.on("error", (error: Error) => {
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    log.error("redis", "connection", { code, detail: error.message });
  });
  return connection;
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
