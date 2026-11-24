import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertFfmpegConfigured, assertFfprobeConfigured, getRenderTimeoutMs } from "@/lib/providers/media/ffmpeg/config";
import { buildFFmpegArgs, buildConcatList, type RenderPlan } from "@/lib/providers/media/ffmpeg/commandBuilder";
import { FFprobeMediaInspector, type ProbedMedia } from "@/lib/providers/media/probe";
import type { RenderPreset } from "@/lib/providers/media/ffmpeg/presets";
import type { StorageProvider } from "@/lib/providers/storage/types";

const execFileAsync = promisify(execFile);

export type RenderRequest = {
  preset: RenderPreset;
  videoAssets: { storageKey: string; durationSeconds: number }[];
  audioAssets?: { storageKey: string; volume: number; kind: "dialogue" | "music" | "sfx" | "narration" }[];
  subtitleStorageKey?: string;
};

export type RenderResult = {
  bytes: Uint8Array;
  mimeType: string;
  ffmpegVersion: string;
  renderDurationSeconds: number;
};

export class FFmpegRenderEngine {
  constructor(
    private readonly storage: StorageProvider,
    private readonly ffmpegPath: string | undefined = process.env.FFMPEG_PATH?.trim(),
    private readonly ffprobePath: string | undefined = process.env.FFPROBE_PATH?.trim(),
  ) {}

  async render(request: RenderRequest, signal?: AbortSignal): Promise<RenderResult> {
    const ffmpegBin = this.ffmpegPath ?? assertFfmpegConfigured();
    const ffprobeBin = this.ffprobePath ?? assertFfprobeConfigured();
    const inspector = new FFprobeMediaInspector(ffprobeBin);

    const workDir = await mkdtemp(path.join(tmpdir(), "render-"));
    const startedAt = Date.now();

    try {
      if (signal?.aborted) throw new Error("render_cancelled");

      const videoPaths: { path: string; durationSeconds: number }[] = [];
      for (let i = 0; i < request.videoAssets.length; i++) {
        if (signal?.aborted) throw new Error("render_cancelled");
        const asset = request.videoAssets[i];
        const bytes = await this.storage.get(asset.storageKey);
        const localPath = path.join(workDir, `video_${i}.mp4`);
        await writeFile(localPath, bytes, { flag: "wx" });
        await inspector.inspect(bytes, "video");
        videoPaths.push({ path: localPath, durationSeconds: asset.durationSeconds });
      }

      const audioPaths: { path: string; volume: number; kind: "dialogue" | "music" | "sfx" | "narration" }[] = [];
      const audioAssets = request.audioAssets ?? [];
      for (let i = 0; i < audioAssets.length; i++) {
        if (signal?.aborted) throw new Error("render_cancelled");
        const asset = audioAssets[i];
        const bytes = await this.storage.get(asset.storageKey);
        const localPath = path.join(workDir, `audio_${i}.bin`);
        await writeFile(localPath, bytes, { flag: "wx" });
        await inspector.inspect(bytes, "audio");
        audioPaths.push({ path: localPath, volume: asset.volume, kind: asset.kind });
      }

      let subtitlePath: string | undefined;
      if (request.subtitleStorageKey) {
        if (signal?.aborted) throw new Error("render_cancelled");
        const bytes = await this.storage.get(request.subtitleStorageKey);
        subtitlePath = path.join(workDir, "subtitles.srt");
        await writeFile(subtitlePath, bytes, { flag: "wx" });
      }

      const outputPath = path.join(workDir, "output.mp4");
      const concatListPath = path.join(workDir, "concat.txt");

      if (videoPaths.length > 1) {
        const concatContent = buildConcatList(videoPaths);
        await writeFile(concatListPath, concatContent, { flag: "wx" });
      }

      const plan: RenderPlan = {
        preset: request.preset,
        videoInputs: videoPaths,
        audioInputs: audioPaths.length > 0 ? audioPaths : undefined,
        subtitlePath,
        outputPath,
        concatListPath,
      };

      const args = buildFFmpegArgs(plan);
      const timeout = getRenderTimeoutMs();

      try {
        await execFileAsync(ffmpegBin, args, {
          timeout,
          maxBuffer: 4 * 1024,
          windowsHide: true,
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw new Error("render_cancelled");
        const stderr = error instanceof Error ? error.message : String(error);
        if (stderr.includes("timed out") || stderr.includes("ETIMEDOUT")) {
          throw new Error("render_timeout");
        }
        const truncated = stderr.slice(0, 4096);
        throw new Error(`render_failed:${truncated}`);
      }

      if (signal?.aborted) throw new Error("render_cancelled");

      const outputBytes = await readFile(outputPath);
      if (outputBytes.byteLength === 0) throw new Error("render_output_empty");

      let probeResult: ProbedMedia;
      try {
        probeResult = await inspector.inspect(outputBytes, "video");
      } catch {
        throw new Error("render_output_invalid");
      }

      if (!probeResult.durationSeconds || probeResult.durationSeconds <= 0) {
        throw new Error("render_output_invalid");
      }

      let ffmpegVersion: string;
      try {
        const { stdout } = await execFileAsync(ffmpegBin, ["-version"], { timeout: 5_000, windowsHide: true });
        ffmpegVersion = stdout.split("\n")[0]?.trim().slice(0, 40) ?? "unknown";
      } catch {
        ffmpegVersion = "unknown";
      }

      const renderDurationSeconds = (Date.now() - startedAt) / 1000;

      return {
        bytes: new Uint8Array(outputBytes),
        mimeType: "video/mp4",
        ffmpegVersion,
        renderDurationSeconds,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}