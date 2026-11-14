import "server-only";
import type { ProviderCapability } from "@/lib/providers/media/capability";
import type { ImagePrompt } from "@/lib/providers/media/image/types";

export type VideoPrompt = {
  staticScene: ImagePrompt;
  motion: string;
  cameraMovement: string;
  durationSeconds: number;
  segmentNote: string;
};

export type StoredReference = {
  assetId: string;
  storageKey: string;
  mimeType: string;
};

export type VideoGenerationRequest = {
  prompt: VideoPrompt;
  referenceImage?: StoredReference;
  model: string;
  settings: { aspectRatio: string; durationSeconds: number };
  idempotencyKey: string;
};

export type VideoOperationHandle = {
  operationId: string;
  status: "submitted";
};

export type VideoPollResult =
  | { status: "processing" }
  | { status: "completed"; bytes: Uint8Array; mimeType: "video/mp4" | "video/webm"; mock: boolean; usage?: { estimatedCostCents?: number } }
  | { status: "failed"; code: "content_rejected" | "provider_transient" };

export interface VideoProvider {
  readonly id: string;
  readonly capabilities: ProviderCapability;
  submit(request: VideoGenerationRequest): Promise<VideoOperationHandle>;
  poll(handle: VideoOperationHandle): Promise<VideoPollResult>;
  cancel?(handle: VideoOperationHandle): Promise<void>;
}