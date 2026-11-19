import { createHash } from "node:crypto";
import type { CanonFactKind, Evidence } from "@/lib/canon/schema";
import type { ScreenplayScene } from "@/lib/validation/story";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function stableSort(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableSort);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = stableSort((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableSort(value));
}

export function computeSourceHash(screenplay: ScreenplayScene[]): string {
  return sha256Hex(stableStringify(screenplay));
}

export function computePayloadHash(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

export function computeEvidenceHash(evidence: Evidence): string {
  return sha256Hex(evidence.quote);
}

export function computeEntryId(input: {
  episodeNumber: number;
  sceneNumber: number;
  kind: CanonFactKind;
  targetId: string;
  payload: unknown;
  evidence: Evidence;
}): string {
  const payloadHash = computePayloadHash(input.payload);
  const evidenceHash = computeEvidenceHash(input.evidence);
  const raw = [
    String(input.episodeNumber),
    String(input.sceneNumber),
    input.kind,
    input.targetId,
    payloadHash,
    evidenceHash,
  ].join(":");
  return sha256Hex(raw);
}