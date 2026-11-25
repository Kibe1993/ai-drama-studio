import { z } from "zod";

export const TOOL_TYPES = [
  "comfyui",
  "blender",
  "synfig",
  "opentoonz",
  "pencil2d",
  "makehuman",
  "mixamo",
  "wav2lip",
  "sadtalker",
  "audacity",
  "remotion",
  "lottie",
  "veo",
  "ffmpeg",
  "kokoro",
] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const TOOL_STATUSES = [
  "not_installed",
  "installed",
  "configured",
  "connected",
  "available",
  "processing",
  "failed",
  "unavailable",
] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const TOOL_CATEGORIES = [
  "image_generation",
  "video_generation",
  "animation_2d",
  "animation_3d",
  "character_creation",
  "audio_tts",
  "audio_editing",
  "lip_sync",
  "rendering",
  "animation_codec",
  "cloud_generation",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const HEALTH_CHECK_STATUSES = ["healthy", "degraded", "unhealthy", "unknown"] as const;
export type HealthCheckStatus = (typeof HEALTH_CHECK_STATUSES)[number];

export type HealthCheckResult = {
  status: HealthCheckStatus;
  message: string;
  details?: Record<string, unknown>;
  checkedAt: string;
  responseTimeMs?: number;
};

export const toolConfigSchema = z.object({
  toolType: z.enum(TOOL_TYPES),
  displayName: z.string().trim().min(1).max(80),
  category: z.enum(TOOL_CATEGORIES),
  enabled: z.boolean().default(false),
  endpoint: z.string().trim().url().optional().or(z.literal("").transform(() => undefined)),
  executablePath: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  workingDirectory: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  apiKey: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  config: z.record(z.unknown()).default({}),
});

export const toolConfigUpdateSchema = toolConfigSchema.partial().omit({ toolType: true });

export type ToolConfigRecord = {
  id: string;
  clerkUserId: string;
  toolType: ToolType;
  displayName: string;
  category: ToolCategory;
  enabled: boolean;
  endpoint?: string;
  executablePath?: string;
  workingDirectory?: string;
  apiKey?: string;
  config: Record<string, unknown>;
  status: ToolStatus;
  lastHealthCheck?: string;
  lastHealthCheckResult?: HealthCheckResult;
  createdAt: string;
  updatedAt: string;
};

export type ToolConfigInput = z.infer<typeof toolConfigSchema>;
export type ToolConfigUpdate = z.infer<typeof toolConfigUpdateSchema>;

export const TOOL_CATEGORY_MAP: Record<ToolType, ToolCategory> = {
  comfyui: "image_generation",
  blender: "animation_3d",
  synfig: "animation_2d",
  opentoonz: "animation_2d",
  pencil2d: "animation_2d",
  makehuman: "character_creation",
  mixamo: "character_creation",
  wav2lip: "lip_sync",
  sadtalker: "lip_sync",
  audacity: "audio_editing",
  remotion: "rendering",
  lottie: "animation_codec",
  veo: "cloud_generation",
  ffmpeg: "rendering",
  kokoro: "audio_tts",
};

export const TOOL_DISPLAY_NAMES: Record<ToolType, string> = {
  comfyui: "ComfyUI",
  blender: "Blender",
  synfig: "Synfig Studio",
  opentoonz: "OpenToonz",
  pencil2d: "Pencil2D",
  makehuman: "MakeHuman",
  mixamo: "Mixamo",
  wav2lip: "Wav2Lip",
  sadtalker: "SadTalker",
  audacity: "Audacity",
  remotion: "Remotion",
  lottie: "Lottie/SVG",
  veo: "Google Veo",
  ffmpeg: "FFmpeg",
  kokoro: "Kokoro TTS",
};

export function canTransitionTo(from: ToolStatus, to: ToolStatus): boolean {
  const transitions: Record<ToolStatus, ToolStatus[]> = {
    not_installed: ["installed", "unavailable"],
    installed: ["configured", "not_installed", "unavailable"],
    configured: ["connected", "installed", "unavailable"],
    connected: ["available", "configured", "unavailable"],
    available: ["processing", "connected", "unavailable"],
    processing: ["available", "failed", "unavailable"],
    failed: ["unavailable", "available", "processing"],
    unavailable: ["not_installed", "configured", "connected"],
  };
  return transitions[from]?.includes(to) ?? false;
}