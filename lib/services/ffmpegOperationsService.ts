import "server-only";
import { StudioError } from "@/lib/http/errors";
import { ffmpegOperations } from "@/lib/providers/media/ffmpeg/operations";
import type {
  TranscodeParams,
  TrimParams,
  ExtractFramesParams,
  ExtractAudioParams,
  ReplaceAudioParams,
  OverlayParams,
} from "@/lib/providers/media/ffmpeg/operations";

export const ffmpegOperationsService = {
  async transcode(userId: string, params: TranscodeParams) {
    try {
      return await ffmpegOperations.transcode(params);
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Transcode failed",
        500,
        "ffmpeg_operation_failed",
      );
    }
  },

  async trim(userId: string, params: TrimParams) {
    try {
      return await ffmpegOperations.trim(params);
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Trim failed",
        500,
        "ffmpeg_operation_failed",
      );
    }
  },

  async extractFrames(userId: string, params: ExtractFramesParams) {
    try {
      return await ffmpegOperations.extractFrames(params);
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Frame extraction failed",
        500,
        "ffmpeg_operation_failed",
      );
    }
  },

  async extractAudio(userId: string, params: ExtractAudioParams) {
    try {
      return await ffmpegOperations.extractAudio(params);
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Audio extraction failed",
        500,
        "ffmpeg_operation_failed",
      );
    }
  },

  async replaceAudio(userId: string, params: ReplaceAudioParams) {
    try {
      return await ffmpegOperations.replaceAudio(params);
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Audio replacement failed",
        500,
        "ffmpeg_operation_failed",
      );
    }
  },

  async overlay(userId: string, params: OverlayParams) {
    try {
      return await ffmpegOperations.overlay(params);
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Overlay failed",
        500,
        "ffmpeg_operation_failed",
      );
    }
  },

  async getMediaInfo(userId: string, inputPath: string) {
    try {
      return await ffmpegOperations.getMediaInfo(inputPath);
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Media info failed",
        500,
        "ffmpeg_operation_failed",
      );
    }
  },
};