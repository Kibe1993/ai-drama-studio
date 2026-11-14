import "server-only";
import type { ProviderCapability } from "@/lib/providers/media/capability";
import type { AudioProvider, AudioGenerationRequest, AudioGenerationResult } from "@/lib/providers/media/audio/types";

const MOCK_CAPABILITIES: ProviderCapability = {
  supportsImageToImage: false,
  supportsImageToVideo: false,
  supportsReferenceGuidedVideo: false,
  maxClipDurationSeconds: 0,
  maxImageDimension: 0,
  isMock: true,
  isPaid: false,
  supportedModels: ["mock-audio"],
};

const MINIMAL_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x44, 0xac, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00,
  0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61,
  0x00, 0x00, 0x00, 0x00,
]);

export class MockAudioProvider implements AudioProvider {
  readonly id = "mock-audio";
  readonly capabilities = MOCK_CAPABILITIES;

  async generate(request: AudioGenerationRequest): Promise<AudioGenerationResult> {
    if (request.kind === "dialogue" && !request.voiceProfile) {
      throw new Error("voice_profile_required");
    }
    return {
      bytes: MINIMAL_WAV.slice(),
      mimeType: "audio/wav",
      mock: true,
    };
  }
}