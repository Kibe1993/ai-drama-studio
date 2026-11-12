import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

export type ProbedMedia = {
  validationStatus: "playable";
  durationSeconds: number;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function frameRateOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : null;
}

export function parseProbeOutput(json: string, expected: "audio" | "video"): ProbedMedia {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("invalid_probe_json"); }
  if (!record(value) || !Array.isArray(value.streams)) throw new Error("invalid_probe_result");
  const streams = value.streams.filter(record);
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const format = record(value.format) ? value.format : {};
  const durationSeconds = positive(format.duration);
  if (!durationSeconds) throw new Error("media_duration_unavailable");
  if (expected === "video") {
    const width = positive(video?.width);
    const height = positive(video?.height);
    if (!video || !width || !height || typeof video.codec_name !== "string") {
      throw new Error("video_stream_invalid");
    }
    return {
      validationStatus: "playable",
      durationSeconds,
      width,
      height,
      frameRate: frameRateOf(video.avg_frame_rate) ?? frameRateOf(video.r_frame_rate),
      videoCodec: video.codec_name,
      audioCodec: typeof audio?.codec_name === "string" ? audio.codec_name : null,
    };
  }
  if (!audio || typeof audio.codec_name !== "string") throw new Error("audio_stream_invalid");
  return {
    validationStatus: "playable",
    durationSeconds,
    width: null,
    height: null,
    frameRate: null,
    videoCodec: null,
    audioCodec: audio.codec_name,
  };
}

export class FFprobeMediaInspector {
  constructor(private readonly binary = process.env.FFPROBE_PATH?.trim()) {}

  async inspect(bytes: Uint8Array, expected: "audio" | "video"): Promise<ProbedMedia> {
    if (!this.binary) throw new Error("ffprobe_not_configured");
    if (bytes.byteLength === 0 || bytes.byteLength > 512 * 1024 * 1024) throw new Error("media_size_out_of_range");
    const directory = await mkdtemp(path.join(tmpdir(), "studio-probe-"));
    const filename = path.join(directory, expected === "video" ? "input.mp4" : "input.bin");
    try {
      await writeFile(filename, bytes, { flag: "wx" });
      const { stdout } = await execFileAsync(this.binary, [
        "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate",
        "-protocol_whitelist", "file,pipe", "-of", "json", filename,
      ], { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
      return parseProbeOutput(stdout, expected);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("media_")) throw error;
      if (error instanceof Error && error.message.startsWith("video_")) throw error;
      if (error instanceof Error && error.message.startsWith("audio_")) throw error;
      if (error instanceof Error && error.message.startsWith("invalid_probe")) throw error;
      throw new Error("ffprobe_failed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
