import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { z } from "zod";
import { createRenderService } from "@/lib/services/renderService";
import { renderJobRepository } from "@/lib/repositories/renderJobRepository";
import { timelineRepository } from "@/lib/repositories/timelineRepository";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const renderInputSchema = z.object({
  timelineId: objectId,
  presetId: z.string().trim().min(1).max(60),
});

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { episodeId } = await context.params;
    const timeline = await timelineRepository.findByEpisode(actor.userId, episodeId);
    if (!timeline) return jsonData({ renderJobs: [] });
    const jobs = await renderJobRepository.findByTimeline(actor.userId, timeline.id);
    return jsonData({
      renderJobs: jobs.map((j) => ({
        id: j.id,
        status: j.status,
        presetId: j.presetId,
        outputAssetId: j.outputAssetId,
        ffmpegVersion: j.ffmpegVersion,
        renderDurationSeconds: j.renderDurationSeconds,
        error: j.error,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
      })),
    });
  });
}

export function POST(request: Request, _context: Context) {
  return logged(request, async () => {
    const actor = await readActor();

    const parsed = renderInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the render input");
    const service = createRenderService();
    const renderJob = await service.triggerRender(actor, parsed.data.timelineId, parsed.data.presetId);
    return jsonData({
      renderJob: {
        id: renderJob.id,
        status: renderJob.status,
        presetId: renderJob.presetId,
        timelineId: renderJob.timelineId,
      },
    }, 201);
  });
}