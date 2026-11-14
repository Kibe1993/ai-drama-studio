import "server-only";
import type { ProviderCapability } from "@/lib/providers/media/capability";
import type { VideoProvider, VideoGenerationRequest, VideoOperationHandle, VideoPollResult } from "@/lib/providers/media/video/types";

const MOCK_CAPABILITIES: ProviderCapability = {
  supportsImageToImage: false,
  supportsImageToVideo: true,
  supportsReferenceGuidedVideo: true,
  maxClipDurationSeconds: 8,
  maxImageDimension: 1024,
  isMock: true,
  isPaid: false,
  supportedModels: ["mock-video"],
};

const MINIMAL_MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
  0x6d, 0x70, 0x34, 0x31, 0x6d, 0x70, 0x34, 0x32,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74,
]);

export class MockVideoProvider implements VideoProvider {
  readonly id = "mock-video";
  readonly capabilities = MOCK_CAPABILITIES;
  private readonly pollCounts = new Map<string, number>();

  async submit(request: VideoGenerationRequest): Promise<VideoOperationHandle> {
    const operationId = `mock-op-${request.idempotencyKey}`;
    this.pollCounts.set(operationId, 0);
    return { operationId, status: "submitted" };
  }

  async poll(handle: VideoOperationHandle): Promise<VideoPollResult> {
    const count = (this.pollCounts.get(handle.operationId) ?? 0) + 1;
    this.pollCounts.set(handle.operationId, count);
    if (count < 2) return { status: "processing" };
    return {
      status: "completed",
      bytes: MINIMAL_MP4.slice(),
      mimeType: "video/mp4",
      mock: true,
    };
  }

  async cancel(handle: VideoOperationHandle): Promise<void> {
    this.pollCounts.delete(handle.operationId);
  }
}