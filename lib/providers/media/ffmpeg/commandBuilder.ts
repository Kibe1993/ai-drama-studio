import "server-only";
import type { RenderPreset } from "@/lib/providers/media/ffmpeg/presets";

export type RenderPlan = {
  preset: RenderPreset;
  videoInputs: { path: string; durationSeconds: number }[];
  audioInputs?: { path: string; volume: number; kind: "dialogue" | "music" | "sfx" | "narration" }[];
  subtitlePath?: string;
  outputPath: string;
  concatListPath: string;
};

function sanitizePath(path: string): string {
  if (path.includes("\0")) throw new Error("Invalid path: null byte detected");
  if (/[;|&$`<>]/.test(path)) throw new Error("Invalid path: forbidden characters");
  return path;
}

export function buildFFmpegArgs(plan: RenderPlan): string[] {
  for (const v of plan.videoInputs) sanitizePath(v.path);
  if (plan.audioInputs) for (const a of plan.audioInputs) sanitizePath(a.path);
  if (plan.subtitlePath) sanitizePath(plan.subtitlePath);
  sanitizePath(plan.outputPath);
  sanitizePath(plan.concatListPath);

  const { preset } = plan;
  const args: string[] = ["-y", "-hide_banner"];

  if (plan.videoInputs.length === 1) {
    args.push("-i", plan.videoInputs[0].path);
  } else {
    args.push("-f", "concat", "-safe", "0", "-i", plan.concatListPath);
  }

  const audioInputs = plan.audioInputs ?? [];
  for (const audio of audioInputs) {
    args.push("-i", audio.path);
  }

  const videoIndex = 0;
  const filterParts: string[] = [];

  const scaleFilter = `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const fpsFilter = `fps=${preset.frameRate}`;
  filterParts.push(`[${videoIndex}:v]${scaleFilter},${fpsFilter}[v_base]`);

  let videoLabel = "v_base";
  if (plan.subtitlePath && plan.videoInputs.length === 1) {
    filterParts.push(`[v_base]subtitles='${plan.subtitlePath}'[v_sub]`);
    videoLabel = "v_sub";
  }

  const audioLabels: string[] = [];
  if (audioInputs.length > 0) {
    audioInputs.forEach((audio, i) => {

      const actualIndex = (plan.videoInputs.length === 1 ? 1 : 0) + i;
      const label = `a${i}`;
      filterParts.push(`[${actualIndex}:a]volume=${audio.volume}[${label}]`);
      audioLabels.push(`[${label}]`);
    });
    if (audioLabels.length > 1) {
      filterParts.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[a_mix]`);
    } else {
      filterParts.push(`${audioLabels[0]}anull[a_mix]`);
    }
  }

  const filterComplex = filterParts.join(";");
  args.push("-filter_complex", filterComplex);

  args.push("-map", `[${videoLabel}]`);
  if (audioInputs.length > 0) {
    args.push("-map", "[a_mix]");
  }

  args.push(
    "-c:v", preset.videoCodec,
    "-preset", preset.preset,
    "-crf", String(preset.crf),
    "-pix_fmt", preset.pixelFormat,
    "-r", String(preset.frameRate),
  );

  if (audioInputs.length > 0) {
    args.push("-c:a", preset.audioCodec, "-b:a", preset.audioBitrate);
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", plan.outputPath);

  return args;
}

export function buildConcatList(videoInputs: { path: string; durationSeconds: number }[]): string {
  return videoInputs
    .map((v) => `file '${sanitizePath(v.path)}'`)
    .join("\n");
}