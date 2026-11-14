import "server-only";
import { buildImagePrompt, type ImagePromptBuilderInput } from "@/lib/providers/media/prompt/image";
import type { VideoPrompt } from "@/lib/providers/media/video/types";

export type VideoPromptBuilderInput = ImagePromptBuilderInput & {
  motion?: string;
  cameraMovement?: string;
  durationSeconds: number;
  segmentNote?: string;
};

export function buildVideoPrompt(input: VideoPromptBuilderInput): VideoPrompt {
  const staticScene = buildImagePrompt(input);

  const motionParts: string[] = [];
  if (input.motion) motionParts.push(input.motion.trim());
  if (input.shot.action) motionParts.push(input.shot.action.trim());
  if (input.environment?.weather) motionParts.push(`${input.environment.weather} conditions`);
  if (input.environment?.atmosphere) motionParts.push(input.environment.atmosphere.trim());
  const motion = motionParts.filter(Boolean).join(", ").slice(0, 500);

  const cameraMovement = (input.cameraMovement ?? input.shot.cameraDirection ?? "").trim().slice(0, 300);

  const segmentNote = (input.segmentNote ?? "").trim().slice(0, 300);

  return {
    staticScene,
    motion,
    cameraMovement,
    durationSeconds: input.durationSeconds,
    segmentNote,
  };
}