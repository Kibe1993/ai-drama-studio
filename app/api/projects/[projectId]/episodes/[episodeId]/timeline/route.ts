import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { timelineUpdateSchema } from "@/lib/validation/timeline";
import { createTimelineEditService } from "@/lib/services/timelineEditService";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, episodeId } = await context.params;
    const service = createTimelineEditService();
    const editable = await service.getEditableTimeline(actor, projectId, episodeId);
    return jsonData(editable);
  });
}

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, episodeId } = await context.params;
    const service = createTimelineEditService();
    const timeline = await service.createEmpty(actor, projectId, episodeId);
    return jsonData({ timeline }, 201);
  });
}

export function PATCH(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, episodeId } = await context.params;
    const body = await readJson(request);
    const parsed = timelineUpdateSchema.safeParse(body);
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the update payload");

    const service = createTimelineEditService();
    const editable = await service.getEditableTimeline(actor, projectId, episodeId);
    if (!editable.timeline) return errorResponse(404, "not_found", "No timeline found for this episode. Create one first.");

    const assets = await mediaAssetRepository.listProject(actor.userId, projectId);
    const knownAssetIds = new Set<string>(assets?.map((a) => a.id) ?? []);

    const updated = await service.update(actor, editable.timeline.id, parsed.data, knownAssetIds);
    return jsonData({ timeline: updated });
  });
}