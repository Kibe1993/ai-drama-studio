import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createTimelineAssemblyService } from "@/lib/services/timelineAssemblyService";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { episodeId } = await context.params;
    const service = createTimelineAssemblyService();
    const existing = await service.findByEpisode(actor, episodeId);
    if (!existing) return jsonData({ error: "No timeline found for this episode" }, 404);
    const approved = await service.approve(actor, existing.id);
    return jsonData({ timeline: approved });
  });
}