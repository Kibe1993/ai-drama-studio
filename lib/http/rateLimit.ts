import "server-only";
import { StudioError } from "@/lib/http/errors";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Process-local limit for write routes. It resets when the server restarts. */
export function assertRateLimit(key: string, limit = 40, windowMs = 60_000): void {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) {
    throw new StudioError("Too many requests. Wait a moment and try again.", 429, "rate_limited");
  }
  current.count += 1;
}
