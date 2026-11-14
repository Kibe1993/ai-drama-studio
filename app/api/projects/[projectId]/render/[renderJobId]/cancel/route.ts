import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createRenderService } from "@/lib/services/renderService";

type Context = { params: Promise<{ projectId: string; renderJobId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { renderJobId } = await context.params;
    const service = createRenderService();
    const cancelled = await service.cancel(actor, renderJobId);
    return jsonData({
      renderJob: cancelled ? {
        id: cancelled.id,
        status: cancelled.status,
      } : null,
    });
  });
}