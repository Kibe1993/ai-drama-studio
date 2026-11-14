import "server-only";

export type RenderPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  frameRate: number;
  videoCodec: string;
  pixelFormat: string;
  preset: string;
  crf: number;
  audioCodec: string;
  audioBitrate: string;
};

export const PRESET_VERTICAL_9_16: RenderPreset = {
  id: "vertical_9_16",
  label: "Vertical 9:16 (1080×1920)",
  width: 1080,
  height: 1920,
  frameRate: 30,
  videoCodec: "libx264",
  pixelFormat: "yuv420p",
  preset: "fast",
  crf: 23,
  audioCodec: "aac",
  audioBitrate: "128k",
};

export const PRESET_LANDSCAPE_16_9: RenderPreset = {
  id: "landscape_16_9",
  label: "Landscape 16:9 (1920×1080)",
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoCodec: "libx264",
  pixelFormat: "yuv420p",
  preset: "fast",
  crf: 23,
  audioCodec: "aac",
  audioBitrate: "128k",
};

export const PRESET_SQUARE_1_1: RenderPreset = {
  id: "square_1_1",
  label: "Square 1:1 (1080×1080)",
  width: 1080,
  height: 1080,
  frameRate: 30,
  videoCodec: "libx264",
  pixelFormat: "yuv420p",
  preset: "fast",
  crf: 23,
  audioCodec: "aac",
  audioBitrate: "128k",
};

export const RENDER_PRESETS: Record<string, RenderPreset> = {
  [PRESET_VERTICAL_9_16.id]: PRESET_VERTICAL_9_16,
  [PRESET_LANDSCAPE_16_9.id]: PRESET_LANDSCAPE_16_9,
  [PRESET_SQUARE_1_1.id]: PRESET_SQUARE_1_1,
};

export function getPreset(id: string): RenderPreset | undefined {
  return RENDER_PRESETS[id];
}