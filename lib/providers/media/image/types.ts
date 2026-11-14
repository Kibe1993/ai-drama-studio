import "server-only";
import type { ProviderCapability } from "@/lib/providers/media/capability";

export type ImagePrompt = {
  subject: string;
  environment: string;
  style: string;
  lighting: string;
  camera: string;
  composition: string;
  continuityNotes: string;
};

export type StoredReference = {
  assetId: string;
  storageKey: string;
  mimeType: string;
};

export type ImageGenerationRequest = {
  prompt: ImagePrompt;
  referenceImages: StoredReference[];
  model: string;
  settings: { aspectRatio: string; seed?: number };
  idempotencyKey: string;
};

export type ImageGenerationResult = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  mock: boolean;
  referencesUsed: boolean;
  usage?: { estimatedCostCents?: number };
};

export interface ImageProvider {
  readonly id: string;
  readonly capabilities: ProviderCapability;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}