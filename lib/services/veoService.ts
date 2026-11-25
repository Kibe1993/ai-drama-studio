import "server-only";
import { StudioError } from "@/lib/http/errors";
import { VeoVideoProvider } from "@/lib/providers/media/video/veo";
import type { VideoGenerationRequest, VideoOperationHandle, VideoPollResult } from "@/lib/providers/media/video/types";

const provider = new VeoVideoProvider();

export type VeoGenerateParams = {
  prompt: {
    subject: string;
    environment: string;
    style: string;
    lighting: string;
    camera: string;
    composition: string;
    continuityNotes: string;
    motion: string;
    cameraMovement: string;
    durationSeconds: number;
    segmentNote: string;
  };
  aspectRatio: string;
  durationSeconds: number;
  model?: string;
};

export const veoService = {
  async generate(userId: string, params: VeoGenerateParams): Promise<{ operationId: string; status: string }> {
    if (!process.env.VEO_API_KEY?.trim()) {
      throw new StudioError("VEO_API_KEY not configured", 503, "veo_not_configured");
    }
    const request: VideoGenerationRequest = {
      prompt: {
        staticScene: {
          subject: params.prompt.subject,
          environment: params.prompt.environment,
          style: params.prompt.style,
          lighting: params.prompt.lighting,
          camera: params.prompt.camera,
          composition: params.prompt.composition,
          continuityNotes: params.prompt.continuityNotes,
        },
        motion: params.prompt.motion,
        cameraMovement: params.prompt.cameraMovement,
        durationSeconds: params.prompt.durationSeconds,
        segmentNote: params.prompt.segmentNote,
      },
      model: params.model ?? "veo-3.0-generate-preview",
      settings: {
        aspectRatio: params.aspectRatio,
        durationSeconds: params.durationSeconds,
      },
      idempotencyKey: `veo_${userId}_${Date.now()}`,
    };
    try {
      const handle = await provider.submit(request);
      return { operationId: handle.operationId, status: handle.status };
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Veo generation failed",
        500,
        "veo_generation_failed",
      );
    }
  },

  async poll(userId: string, operationId: string): Promise<VideoPollResult & { estimatedCostCents?: number }> {
    if (!process.env.VEO_API_KEY?.trim()) {
      throw new StudioError("VEO_API_KEY not configured", 503, "veo_not_configured");
    }
    const handle: VideoOperationHandle = { operationId, status: "submitted" };
    try {
      const result = await provider.poll(handle);
      if (result.status === "completed") {
        return {
          ...result,
          estimatedCostCents: result.usage?.estimatedCostCents,
        };
      }
      return result;
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Veo poll failed",
        500,
        "veo_poll_failed",
      );
    }
  },

  async cancel(userId: string, operationId: string): Promise<{ cancelled: boolean }> {
    if (!process.env.VEO_API_KEY?.trim()) {
      throw new StudioError("VEO_API_KEY not configured", 503, "veo_not_configured");
    }
    const handle: VideoOperationHandle = { operationId, status: "submitted" };
    try {
      await provider.cancel?.(handle);
      return { cancelled: true };
    } catch {
      return { cancelled: false };
    }
  },
};