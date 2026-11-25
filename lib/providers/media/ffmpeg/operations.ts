import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertFfmpegConfigured, getRenderTimeoutMs } from "@/lib/providers/media/ffmpeg/config";

const execFileAsync = promisify(execFile);

export type TranscodeParams = {
  inputPath: string;
  outputPath: string;
  videoCodec?: string;
  audioCodec?: string;
  crf?: number;
  preset?: string;
  resolution?: string;
  frameRate?: number;
};

export type TrimParams = {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  durationSeconds: number;
};

export type ExtractFramesParams = {
  inputPath: string;
  outputDir: string;
  startSeconds?: number;
  durationSeconds?: number;
  frameRate?: number;
  format?: "png" | "jpg";
  scale?: string;
};

export type ExtractAudioParams = {
  inputPath: string;
  outputPath: string;
  format?: "wav" | "mp3" | "aac" | "flac";
  audioCodec?: string;
  bitrate?: string;
};

export type ReplaceAudioParams = {
  videoPath: string;
  audioPath: string;
  outputPath: string;
};

export type OverlayParams = {
  baseVideoPath: string;
  overlayPath: string;
  outputPath: string;
  position: { x: number; y: number };
  scale?: string;
  opacity?: number;
};

export type FFmpegOperationResult = {
  outputPaths: string[];
  durationSeconds: number;
};

function sanitizePath(p: string): string {
  if (!p || p.includes("\0")) throw new Error("invalid_path");
  return p;
}

async function runFFmpeg(args: string[], timeoutMs?: number): Promise<void> {
  const ffmpegBin = assertFfmpegConfigured();
  await execFileAsync(ffmpegBin, args, {
    timeout: timeoutMs ?? getRenderTimeoutMs(),
    maxBuffer: 4096,
    windowsHide: true,
  });
}

export const ffmpegOperations = {
  async transcode(params: TranscodeParams): Promise<FFmpegOperationResult> {
    const startedAt = Date.now();
    const args = ["-i", sanitizePath(params.inputPath)];
    if (params.videoCodec) args.push("-c:v", params.videoCodec);
    else args.push("-c:v", "libx264");
    if (params.audioCodec) args.push("-c:a", params.audioCodec);
    else args.push("-c:a", "aac");
    if (params.crf !== undefined) args.push("-crf", String(params.crf));
    else args.push("-crf", "23");
    if (params.preset) args.push("-preset", params.preset);
    else args.push("-preset", "fast");
    if (params.resolution) args.push("-vf", `scale=${params.resolution}`);
    if (params.frameRate) args.push("-r", String(params.frameRate));
    args.push("-movflags", "+faststart", "-y", sanitizePath(params.outputPath));
    await runFFmpeg(args);
    return { outputPaths: [params.outputPath], durationSeconds: (Date.now() - startedAt) / 1000 };
  },

  async trim(params: TrimParams): Promise<FFmpegOperationResult> {
    const startedAt = Date.now();
    const args = [
      "-ss", String(params.startSeconds),
      "-i", sanitizePath(params.inputPath),
      "-t", String(params.durationSeconds),
      "-c", "copy",
      "-y", sanitizePath(params.outputPath),
    ];
    await runFFmpeg(args);
    return { outputPaths: [params.outputPath], durationSeconds: (Date.now() - startedAt) / 1000 };
  },

  async extractFrames(params: ExtractFramesParams): Promise<FFmpegOperationResult> {
    const startedAt = Date.now();
    const format = params.format ?? "png";
    const workDir = await mkdtemp(path.join(tmpdir(), "frames-"));
    try {
      const args: string[] = ["-i", sanitizePath(params.inputPath)];
      if (params.startSeconds !== undefined) args.unshift("-ss", String(params.startSeconds));
      if (params.durationSeconds !== undefined) {
        const idx = args.indexOf("-i");
        args.splice(idx + 2, 0, "-t", String(params.durationSeconds));
      }
      const vfParts: string[] = [];
      if (params.frameRate) vfParts.push(`fps=${params.frameRate}`);
      if (params.scale) vfParts.push(`scale=${params.scale}`);
      if (vfParts.length > 0) args.push("-vf", vfParts.join(","));
      const pattern = path.join(workDir, `frame_%06d.${format}`);
      args.push("-y", pattern);
      await runFFmpeg(args);

      const outputDir = sanitizePath(params.outputDir);
      const { readdir, rename } = await import("node:fs/promises");
      const files = await readdir(workDir);
      const outputPaths: string[] = [];
      for (const file of files) {
        const src = path.join(workDir, file);
        const dst = path.join(outputDir, file);
        await rename(src, dst);
        outputPaths.push(dst);
      }
      return { outputPaths, durationSeconds: (Date.now() - startedAt) / 1000 };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  },

  async extractAudio(params: ExtractAudioParams): Promise<FFmpegOperationResult> {
    const startedAt = Date.now();
    const format = params.format ?? "wav";
    const codec = params.audioCodec ?? (format === "wav" ? "pcm_s16le" : format === "mp3" ? "libmp3lame" : format === "flac" ? "flac" : "aac");
    const args = [
      "-i", sanitizePath(params.inputPath),
      "-vn",
      "-c:a", codec,
    ];
    if (params.bitrate) args.push("-b:a", params.bitrate);
    args.push("-y", sanitizePath(params.outputPath));
    await runFFmpeg(args);
    return { outputPaths: [params.outputPath], durationSeconds: (Date.now() - startedAt) / 1000 };
  },

  async replaceAudio(params: ReplaceAudioParams): Promise<FFmpegOperationResult> {
    const startedAt = Date.now();
    const args = [
      "-i", sanitizePath(params.videoPath),
      "-i", sanitizePath(params.audioPath),
      "-c:v", "copy",
      "-c:a", "aac",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-movflags", "+faststart",
      "-y", sanitizePath(params.outputPath),
    ];
    await runFFmpeg(args);
    return { outputPaths: [params.outputPath], durationSeconds: (Date.now() - startedAt) / 1000 };
  },

  async overlay(params: OverlayParams): Promise<FFmpegOperationResult> {
    const startedAt = Date.now();
    const workDir = await mkdtemp(path.join(tmpdir(), "overlay-"));
    try {
      const filterParts: string[] = [];
      if (params.scale) filterParts.push(`scale=${params.scale}`);
      const overlayFilter = params.opacity !== undefined && params.opacity < 1
        ? `format=rgba,colorchannelmixer=aa=${params.opacity}`
        : "";
      const fullFilter = [
        "[1:v]" + (filterParts.length > 0 ? filterParts.join(",") : "") + (overlayFilter ? "," + overlayFilter : "") + "[ovr]",
        "[0:v][ovr]overlay=" + params.position.x + ":" + params.position.y,
      ].join(";");
      const args = [
        "-i", sanitizePath(params.baseVideoPath),
        "-i", sanitizePath(params.overlayPath),
        "-filter_complex", fullFilter,
        "-c:a", "copy",
        "-movflags", "+faststart",
        "-y", sanitizePath(params.outputPath),
      ];
      await runFFmpeg(args);
      return { outputPaths: [params.outputPath], durationSeconds: (Date.now() - startedAt) / 1000 };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  },

  async getMediaInfo(inputPath: string): Promise<{ durationSeconds: number; width: number; height: number; hasAudio: boolean; codec: string }> {
    const ffprobeBin = process.env.FFPROBE_PATH?.trim();
    if (!ffprobeBin) throw new Error("ffprobe_not_configured");
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      sanitizePath(inputPath),
    ];
    const { stdout } = await execFileAsync(ffprobeBin, args, { maxBuffer: 1024 * 1024, windowsHide: true });
    const info = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: string | number }>;
    };
    const videoStream = info.streams?.find((s) => s.codec_type === "video");
    const audioStream = info.streams?.find((s) => s.codec_type === "audio");
    return {
      durationSeconds: info.format?.duration ? Number(info.format.duration) : 0,
      width: videoStream?.width ?? 0,
      height: Number(videoStream?.height ?? 0),
      hasAudio: !!audioStream,
      codec: videoStream?.codec_name ?? "unknown",
    };
  },
};