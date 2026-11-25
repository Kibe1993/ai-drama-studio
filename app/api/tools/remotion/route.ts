import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { remotionService } from "@/lib/services/remotionService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const url = new URL(request.url);
    const entryPoint = url.searchParams.get("entry");
    const status = await remotionService.getStatus(actor.userId);
    if (!entryPoint) return jsonData({ config: status, compositions: [] });
    const compositions = await remotionService.listCompositions(actor.userId, entryPoint);
    return jsonData({ config: status, compositions });
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = z.object({
      action: z.enum(["render", "poll"]),
      params: z.record(z.unknown()).default({}),
      operationId: z.string().optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const { action, params, operationId } = parsed.data;
    switch (action) {
      case "render":
        return jsonData(await remotionService.render(actor.userId, params as { entryPoint: string; compositionId: string; outputPath: string; codec?: "h264" | "h265" | "vp8" | "vp9"; imageFormat?: "jpeg" | "png"; quality?: number; crf?: number; props?: Record<string, unknown> }));
      case "poll":
        return jsonData(await remotionService.pollRender(actor.userId, operationId ?? ""));
      default:
        return errorResponse(400, "invalid_action", "Unknown action");
    }
  });
}