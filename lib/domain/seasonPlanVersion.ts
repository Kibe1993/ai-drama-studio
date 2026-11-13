import { createHash } from "node:crypto";

/**
 * Stable fingerprint of the approved Story Bible a Season Plan was developed
 * from. It complements the version number: a version identifies the snapshot,
 * the fingerprint proves the content the plan saw has not changed.
 */
export function bibleFingerprint(version: number, content: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ version, content }))
    .digest("hex")
    .slice(0, 20);
}
