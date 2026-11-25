import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { ffmpegOperationsService } from "@/lib/services/ffmpegOperationsService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const url = new URL(request.url);
    const inputPath = url.searchParams.get("path");
    if (!inputPath) return errorResponse(400, "invalid_input", "Missing 'path' query parameter");
    return jsonData(await ffmpegOperationsService.getMediaInfo(actor.userId, inputPath));
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = z.object({
      operation: z.enum(["transcode", "trim", "extract_frames", "extract_audio", "replace_audio", "overlay"]),
      params: z.record(z.unknown()),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const { operation, params } = parsed.data;
    switch (operation) {
      case "transcode":
        return jsonData(await ffmpegOperationsService.transcode(actor.userId, params as { inputPath: string; outputPath: string; videoCodec?: string; audioCodec?: string; crf?: number; preset?: string; resolution?: string; frameRate?: number }));
      case "trim":
        return jsonData(await ffmpegOperationsService.trim(actor.userId, params as { inputPath: string; outputPath: string; startSeconds: number; durationSeconds: number }));
      case "extract_frames":
        return jsonData(await ffmpegOperationsService.extractFrames(actor.userId, params as { inputPath: string; outputDir: string; startSeconds?: number; durationSeconds?: number; frameRate?: number; format?: "png" | "jpg"; scale?: string }));
      case "extract_audio":
        return jsonData(await ffmpegOperationsService.extractAudio(actor.userId, params as { inputPath: string; outputPath: string; format?: "wav" | "mp3" | "aac" | "flac"; audioCodec?: string; bitrate?: string }));
      case "replace_audio":
        return jsonData(await ffmpegOperationsService.replaceAudio(actor.userId, params as { videoPath: string; audioPath: string; outputPath: string }));
      case "overlay":
        return jsonData(await ffmpegOperationsService.overlay(actor.userId, params as { baseVideoPath: string; overlayPath: string; outputPath: string; position: { x: number; y: number }; scale?: string; opacity?: number }));
      default:
        return errorResponse(400, "invalid_operation", "Unknown operation");
    }
  });
}