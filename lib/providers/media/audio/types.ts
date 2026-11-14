import "server-only";
import type { ProviderCapability } from "@/lib/providers/media/capability";

export type AudioGenerationRequest = {
  kind: "dialogue" | "narration" | "sfx";
  text: string;
  voiceProfile?: {
    id: string;
    provider: string;
    voiceIdentifier: string;
    language: string;
  };
  settings: { language: string };
  idempotencyKey: string;
};

export type AudioGenerationResult = {
  bytes: Uint8Array;
  mimeType: "audio/wav" | "audio/mpeg";
  mock: boolean;
  usage?: { estimatedCostCents?: number };
};

export interface AudioProvider {
  readonly id: string;
  readonly capabilities: ProviderCapability;
  generate(request: AudioGenerationRequest): Promise<AudioGenerationResult>;
}