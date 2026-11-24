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
  "generation",
  "production",
  "maintenance",
] as const;

export function queueNameFor(jobType: string): (typeof QUEUE_NAMES)[number] {
  if (jobType === "render.final" || jobType.startsWith("audio.")) return "production";
  if (jobType.startsWith("image.") || jobType.startsWith("video.") || jobType === "media.validate") return "maintenance";
  return "generation";
}
