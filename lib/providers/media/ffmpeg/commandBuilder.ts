import "server-only";
import type { RenderPreset } from "@/lib/providers/media/ffmpeg/presets";

export type RenderPlan = {
  preset: RenderPreset;
  videoInputs: { path: string; durationSeconds: number; transition?: string }[];
  audioInputs?: { path: string; volume: number; kind: "dialogue" | "music" | "sfx" | "narration" }[];
  subtitlePath?: string;
  outputPath: string;
  concatListPath: string;
};

const TRANSITION_DURATION = 0.5;
const SUPPORTED_TRANSITIONS = new Set(["fade", "wipeleft", "wiperight", "slideup", "slidedown"]);

function sanitizePath(path: string): string {
  if (path.includes("\0")) throw new Error("Invalid path: null byte detected");
  if (/[;|&$`<>]/.test(path)) throw new Error("Invalid path: forbidden characters");
  return path;
}

function hasTransitions(videos: { transition?: string }[]): boolean {
  return videos.some((v, i) => i > 0 && v.transition && SUPPORTED_TRANSITIONS.has(v.transition));
}

export function buildFFmpegArgs(plan: RenderPlan): string[] {
  for (const v of plan.videoInputs) sanitizePath(v.path);
  if (plan.audioInputs) for (const a of plan.audioInputs) sanitizePath(a.path);
  if (plan.subtitlePath) sanitizePath(plan.subtitlePath);
  sanitizePath(plan.outputPath);
  sanitizePath(plan.concatListPath);

  const { preset } = plan;
  const args: string[] = ["-y", "-hide_banner"];

  const useTransitions = hasTransitions(plan.videoInputs);
  const videos = plan.videoInputs;

  if (!useTransitions && videos.length > 1) {
    args.push("-f", "concat", "-safe", "0", "-i", plan.concatListPath);
  } else {
    for (const v of videos) {
      args.push("-i", v.path);
    }
  }

  const audioInputs = plan.audioInputs ?? [];
  for (const audio of audioInputs) {
    args.push("-i", audio.path);
  }

  const filterParts: string[] = [];
  const scaleFilter = `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const fpsFilter = `fps=${preset.frameRate}`;

  let videoLabel: string;

  if (useTransitions && videos.length > 1) {
    const scaledLabels: string[] = [];
    videos.forEach((v, i) => {
      const label = `v${i}`;
      filterParts.push(`[${i}:v]${scaleFilter},${fpsFilter}[${label}]`);
      scaledLabels.push(label);
    });

    let accumulatedDuration = videos[0].durationSeconds;
    let currentLabel = scaledLabels[0];

    for (let i = 1; i < videos.length; i++) {
      const transition = videos[i].transition ?? "fade";
      const offset = Math.max(0, accumulatedDuration - TRANSITION_DURATION);
      const outLabel = i === videos.length - 1 ? "v_out" : `vx${i}`;
      filterParts.push(
        `[${currentLabel}][${scaledLabels[i]}]xfade=transition=${transition}:duration=${TRANSITION_DURATION}:offset=${offset.toFixed(2)}[${outLabel}]`
      );
      currentLabel = outLabel;
      accumulatedDuration = offset + videos[i].durationSeconds;
    }
    videoLabel = currentLabel;
  } else {
    const videoIndex = 0;
    filterParts.push(`[${videoIndex}:v]${scaleFilter},${fpsFilter}[v_base]`);
    videoLabel = "v_base";
  }

  if (plan.subtitlePath && videos.length === 1) {
    filterParts.push(`[${videoLabel}]subtitles='${plan.subtitlePath}'[v_sub]`);
    videoLabel = "v_sub";
  }

  const audioLabels: string[] = [];
  if (audioInputs.length > 0) {
    audioInputs.forEach((audio, i) => {
      const actualIndex = (!useTransitions && videos.length > 1 ? 1 : videos.length) + i;
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