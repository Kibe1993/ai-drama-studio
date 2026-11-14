import "server-only";

export type ProviderCapability = {
  supportsImageToImage: boolean;
  supportsImageToVideo: boolean;
  supportsReferenceGuidedVideo: boolean;
  maxClipDurationSeconds: number;
  maxImageDimension: number;
  isMock: boolean;
  isPaid: boolean;
  supportedModels: readonly string[];
};

export type ProviderKind = "image" | "video" | "audio";

export type CapabilityRequirement = {
  requiresImageToImage?: boolean;
  requiresImageToVideo?: boolean;
  requiresReferenceGuidedVideo?: boolean;
  minClipDurationSeconds?: number;
  minImageDimension?: number;
};

export function capabilitySatisfies(cap: ProviderCapability, req: CapabilityRequirement): boolean {
  if (req.requiresImageToImage && !cap.supportsImageToImage) return false;
  if (req.requiresImageToVideo && !cap.supportsImageToVideo) return false;
  if (req.requiresReferenceGuidedVideo && !cap.supportsReferenceGuidedVideo) return false;
  if (req.minClipDurationSeconds !== undefined && cap.maxClipDurationSeconds < req.minClipDurationSeconds) return false;
  if (req.minImageDimension !== undefined && cap.maxImageDimension < req.minImageDimension) return false;
  return true;
}