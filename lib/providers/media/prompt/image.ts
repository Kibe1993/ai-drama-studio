import "server-only";
import type { ImagePrompt } from "@/lib/providers/media/image/types";

export type CharacterVisualContext = {
  name: string;
  appearance?: string;
  clothing?: string;
  distinguishingFeatures?: string;
  hair?: string;
  facial?: string;
  bodyType?: string;
  defaultPresentation?: string;
};

export type EnvironmentVisualContext = {
  name: string;
  geography?: string;
  architecture?: string;
  materials?: string;
  colourPalette?: string;
  lighting?: string;
  weather?: string;
  atmosphere?: string;
};

export type ObjectVisualContext = {
  name: string;
  description?: string;
  materials?: string;
  colourPalette?: string;
};

export type ShotVisualContext = {
  purpose?: string;
  framing?: string;
  cameraAngle?: string;
  cameraDirection?: string;
  action?: string;
  environment?: string;
  lighting?: string;
  continuity?: string;
};

export type ImagePromptBuilderInput = {
  shot: ShotVisualContext;
  characters: CharacterVisualContext[];
  environment?: EnvironmentVisualContext;
  objects?: ObjectVisualContext[];
  projectStyle?: string;
  aspectRatio?: string;
};

const MAX_FIELD_LENGTH = 400;
const MAX_TOTAL_LENGTH = 2000;

function clamp(value: string | undefined, max = MAX_FIELD_LENGTH): string {
  if (!value) return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function joinParts(parts: string[]): string {
  return parts.filter(Boolean).join(", ");
}

export function buildImagePrompt(input: ImagePromptBuilderInput): ImagePrompt {
  const { shot, characters, environment, objects, projectStyle } = input;

  const subjectParts: string[] = [];
  for (const char of characters) {
    const parts = [
      char.name,
      clamp(char.appearance),
      clamp(char.hair),
      clamp(char.facial),
      clamp(char.clothing),
      clamp(char.distinguishingFeatures),
      clamp(char.bodyType),
      clamp(char.defaultPresentation),
    ].filter(Boolean);
    if (parts.length > 0) subjectParts.push(parts.join(", "));
  }
  const subject = clamp(joinParts([clamp(shot.purpose), ...subjectParts]), 600);

  const envParts: string[] = [];
  if (environment) {
    envParts.push(
      environment.name,
      clamp(environment.architecture),
      clamp(environment.materials),
      clamp(environment.geography),
      clamp(environment.colourPalette),
      clamp(environment.atmosphere),
    );
  }
  if (objects && objects.length > 0) {
    for (const obj of objects) {
      envParts.push(obj.name, clamp(obj.description), clamp(obj.materials));
    }
  }
  const environmentField = clamp(joinParts([clamp(shot.environment), ...envParts]), 600);

  const style = clamp(projectStyle, 200);
  const lighting = clamp(joinParts([clamp(shot.lighting), environment ? clamp(environment.lighting) : "", environment ? clamp(environment.weather) : ""]), 300);
  const camera = clamp(joinParts([clamp(shot.framing), clamp(shot.cameraAngle)]), 300);
  const composition = clamp(joinParts([input.aspectRatio ? `aspect ${input.aspectRatio}` : "", clamp(shot.framing)]), 200);
  const continuityNotes = clamp(shot.continuity, 300);

  const prompt: ImagePrompt = { subject, environment: environmentField, style, lighting, camera, composition, continuityNotes };

  const totalLength = Object.values(prompt).reduce((sum, val) => sum + val.length, 0);
  if (totalLength > MAX_TOTAL_LENGTH) {
    const ratio = MAX_TOTAL_LENGTH / totalLength;
    for (const key of Object.keys(prompt) as (keyof ImagePrompt)[]) {
      prompt[key] = prompt[key].slice(0, Math.floor(prompt[key].length * ratio));
    }
  }

  return prompt;
}