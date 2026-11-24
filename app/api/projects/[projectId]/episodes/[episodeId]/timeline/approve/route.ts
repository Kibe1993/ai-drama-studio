import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData, errorResponse } from "@/lib/http/errors";
import { createTimelineEditService } from "@/lib/services/timelineEditService";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, episodeId } = await context.params;
    const service = createTimelineEditService();
    const editable = await service.getEditableTimeline(actor, projectId, episodeId);
    if (!editable.timeline) return errorResponse(404, "not_found", "No timeline found for this episode");
    const approved = await service.approve(actor, editable.timeline.id);
    return jsonData({ timeline: approved });
  });
}