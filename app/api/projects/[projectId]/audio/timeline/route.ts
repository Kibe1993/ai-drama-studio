import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData, errorResponse } from "@/lib/http/errors";
import { audioSegmentRepository } from "@/lib/repositories/audioSegmentRepository";
import { buildAudioTimeline } from "@/lib/services/audioTimelineService";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    await context.params;
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");
    if (!runId || !objectId.safeParse(runId).success) {
      return errorResponse(400, "invalid_input", "runId query parameter is required");
    }

    const segments = await audioSegmentRepository.listByRun(actor.userId, runId);
    const timeline = buildAudioTimeline(segments);

    return jsonData({ timeline });
  });
}