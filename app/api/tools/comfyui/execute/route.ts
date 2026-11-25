import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { comfyUIService } from "@/lib/services/comfyUIService";
import { z } from "zod";

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = z.object({
      workflowId: z.string().min(1),
      inputs: z.record(z.unknown()).default({}),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    return jsonData(await comfyUIService.execute(actor.userId, parsed.data.workflowId, parsed.data.inputs), 202);
  });
}