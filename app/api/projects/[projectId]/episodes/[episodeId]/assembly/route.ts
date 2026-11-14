import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { z } from "zod";
import { createTimelineAssemblyService } from "@/lib/services/timelineAssemblyService";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const videoClipSchema = z.object({
  assetId: objectId,
  durationSeconds: z.number().positive(),
  sceneNumber: z.number().int().min(1),
  shotNumber: z.number().int().min(1),
});

const audioClipSchema = z.object({
  assetId: objectId,
  durationSeconds: z.number().positive(),
  startSeconds: z.number().min(0),
});

const musicClipSchema = audioClipSchema.extend({
  volume: z.number().min(0).max(2),
  optional: z.boolean().optional(),
});

const assemblyInputSchema = z.object({
  videoClips: z.array(videoClipSchema).min(1),
  dialogueClips: z.array(audioClipSchema).optional(),
  musicClips: z.array(musicClipSchema).optional(),
  sfxClips: z.array(audioClipSchema).optional(),
  subtitleClips: z.array(audioClipSchema).optional(),
  aspectRatio: z.string().max(10).optional(),
  outputResolution: z.string().max(20).optional(),
  frameRate: z.number().min(1).optional(),
  episodeTargetDurationSeconds: z.number().min(0).optional(),
  knownAssetIds: z.array(objectId).optional(),
});

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { episodeId } = await context.params;
    const service = createTimelineAssemblyService();
    const timeline = await service.preview(actor, episodeId);
    return jsonData({ timeline });
  });
}

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, episodeId } = await context.params;
    const parsed = assemblyInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the assembly input");
    const service = createTimelineAssemblyService();
    const timeline = await service.autoGenerate(actor, {
      episodeId,
      projectId,
      videoClips: parsed.data.videoClips,
      dialogueClips: parsed.data.dialogueClips,
      musicClips: parsed.data.musicClips,
      sfxClips: parsed.data.sfxClips,
      subtitleClips: parsed.data.subtitleClips,
      aspectRatio: parsed.data.aspectRatio,
      outputResolution: parsed.data.outputResolution,
      frameRate: parsed.data.frameRate,
      episodeTargetDurationSeconds: parsed.data.episodeTargetDurationSeconds,
      knownAssetIds: parsed.data.knownAssetIds ? new Set(parsed.data.knownAssetIds) : undefined,
    });
    return jsonData({ timeline }, 201);
  });
}