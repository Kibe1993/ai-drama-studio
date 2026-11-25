import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { comfyUIService } from "@/lib/services/comfyUIService";
import { z } from "zod";

const workflowSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  category: z.enum(["character_reference", "scene_image", "environment_reference", "object_reference", "shot_image"]),
  graph: z.record(z.unknown()),
  inputs: z.record(z.object({ type: z.string(), required: z.boolean(), default: z.unknown().optional() })).optional(),
});

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = workflowSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    return jsonData(await comfyUIService.saveWorkflow(actor.userId, parsed.data), 201);
  });
}

export function DELETE(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId");
    if (!workflowId) return errorResponse(400, "missing_param", "workflowId is required");
    return jsonData(await comfyUIService.removeWorkflow(actor.userId, workflowId));
  });
}