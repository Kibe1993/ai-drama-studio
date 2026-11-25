import "server-only";
import type { VideoProvider, VideoGenerationRequest, VideoOperationHandle, VideoPollResult } from "@/lib/providers/media/video/types";
import type { ProviderCapability } from "@/lib/providers/media/capability";

const VEO_CAPABILITIES: ProviderCapability = {
  supportsImageToImage: false,
  supportsImageToVideo: true,
  supportsReferenceGuidedVideo: true,
  maxClipDurationSeconds: 8,
  maxImageDimension: 1920,
  isMock: false,
  isPaid: true,
  supportedModels: ["veo-3.0-generate-preview", "veo-2.0-generate-001"] as const,
};

const VEO_PRICING_CENTS_PER_SECOND: Record<string, number> = {
  "veo-3.0-generate-preview": 50,
  "veo-2.0-generate-001": 25,
};

type VeoConfig = {
  apiKey: string;
  endpoint?: string;
};

type VeoOperationResponse = {
  name: string;
  done?: boolean;
  error?: { code: number; message: string };
  response?: {
    generatedSamples?: Array<{
      video?: { uri: string; mimeType?: string };
    }>;
  };
};

function getVeoConfig(): VeoConfig {
  const apiKey = process.env.VEO_API_KEY?.trim();
  if (!apiKey) throw new Error("veo_not_configured: VEO_API_KEY required");
  return {
    apiKey,
    endpoint: process.env.VEO_ENDPOINT?.trim() || "https://generativelanguage.googleapis.com/v1beta",
  };
}

function buildPromptText(request: VideoGenerationRequest): string {
  const parts: string[] = [];
  const p = request.prompt.staticScene;
  if (p.subject) parts.push(p.subject);
  if (p.environment) parts.push(p.environment);
  if (p.style) parts.push(`Style: ${p.style}`);
  if (p.lighting) parts.push(`Lighting: ${p.lighting}`);
  if (p.camera) parts.push(`Camera: ${p.camera}`);
  if (p.composition) parts.push(`Composition: ${p.composition}`);
  if (p.continuityNotes) parts.push(`Continuity: ${p.continuityNotes}`);
  if (request.prompt.motion) parts.push(`Motion: ${request.prompt.motion}`);
  if (request.prompt.cameraMovement) parts.push(`Camera movement: ${request.prompt.cameraMovement}`);
  if (request.prompt.segmentNote) parts.push(`Note: ${request.prompt.segmentNote}`);
  return parts.filter(Boolean).join(". ");
}

export class VeoVideoProvider implements VideoProvider {
  readonly id = "veo";
  readonly capabilities = VEO_CAPABILITIES;

  async submit(request: VideoGenerationRequest): Promise<VideoOperationHandle> {
    const config = getVeoConfig();
    const model = request.model || "veo-3.0-generate-preview";
    const url = `${config.endpoint}/models/${model}:predictLongRunning?key=${config.apiKey}`;

    const body = {
      instances: [
        {
          prompt: buildPromptText(request),
          ...(request.referenceImage ? { image: { bytesBase64Encoded: "" } } : {}),
        },
      ],
      parameters: {
        sampleCount: 1,
        durationSeconds: request.settings.durationSeconds,
        aspectRatio: request.settings.aspectRatio,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      if (response.status === 401 || response.status === 403) {
        throw new Error(`veo_authentication_failed: ${errorText.slice(0, 200)}`);
      }
      if (response.status === 429) {
        throw new Error(`veo_rate_limited: ${errorText.slice(0, 200)}`);
      }
      throw new Error(`veo_submit_failed (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as { name: string };
    return { operationId: data.name, status: "submitted" };
  }

  async poll(handle: VideoOperationHandle): Promise<VideoPollResult> {
    const config = getVeoConfig();
    const url = `${config.endpoint}/${handle.operationId}?key=${config.apiKey}`;

    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      if (response.status === 429) return { status: "processing" };
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`veo_poll_failed (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as VeoOperationResponse;

    if (!data.done) return { status: "processing" };

    if (data.error) {
      if (data.error.code === 3 || data.error.message.toLowerCase().includes("content")) {
        return { status: "failed", code: "content_rejected" };
      }
      return { status: "failed", code: "provider_transient" };
    }

    const sample = data.response?.generatedSamples?.[0];
    const videoUri = sample?.video?.uri;
    if (!videoUri) return { status: "failed", code: "provider_transient" };

    const videoResponse = await fetch(`${videoUri}?key=${config.apiKey}`);
    if (!videoResponse.ok) {
      throw new Error(`veo_download_failed (${videoResponse.status})`);
    }

    const arrayBuffer = await videoResponse.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const model = handle.operationId.includes("veo-3.0") ? "veo-3.0-generate-preview" : "veo-2.0-generate-001";
    const estimatedCostCents = VEO_PRICING_CENTS_PER_SECOND[model] ?? 50;

    return {
      status: "completed",
      bytes,
      mimeType: "video/mp4",
      mock: false,
      usage: { estimatedCostCents },
    };
  }

  async cancel(handle: VideoOperationHandle): Promise<void> {
    const config = getVeoConfig();
    const url = `${config.endpoint}/${handle.operationId}:cancel?key=${config.apiKey}`;
    await fetch(url, { method: "POST" }).catch(() => { });
  }
}