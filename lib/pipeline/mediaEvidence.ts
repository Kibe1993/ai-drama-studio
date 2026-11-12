import type { SceneItem } from "@/lib/pipeline/types";

export type StoredVideoEvidence = {
  mediaAssetId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  durationSeconds: number;
  width: number;
  height: number;
  validationStatus: "passed";
  storageVerified: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Accept only evidence returned after a real video file was validated and its
 * stored MediaAsset was verified. Mock engine output and legacy readiness
 * booleans do not satisfy this contract.
 */
export function readStoredVideoEvidence(value: unknown): StoredVideoEvidence | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.mediaAssetId !== "string" ||
    !value.mediaAssetId.trim() ||
    typeof value.storageKey !== "string" ||
    !value.storageKey.trim() ||
    typeof value.mimeType !== "string" ||
    !value.mimeType.toLowerCase().startsWith("video/") ||
    !positiveFinite(value.byteSize) ||
    !positiveFinite(value.durationSeconds) ||
    !positiveFinite(value.width) ||
    !positiveFinite(value.height) ||
    value.validationStatus !== "passed" ||
    value.storageVerified !== true
  ) {
    return null;
  }

  return {
    mediaAssetId: value.mediaAssetId,
    storageKey: value.storageKey,
    mimeType: value.mimeType,
    byteSize: value.byteSize,
    durationSeconds: value.durationSeconds,
    width: value.width,
    height: value.height,
    validationStatus: "passed",
    storageVerified: true,
  };
}

export function sceneHasStoredVideo(scene: SceneItem): boolean {
  return (
    scene.videoReady === true &&
    scene.videoStatus === "completed" &&
    typeof scene.videoAssetId === "string" &&
    scene.videoAssetId.trim().length > 0
  );
}
