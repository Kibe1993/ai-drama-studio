import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { productionSceneService } from "@/lib/services/productionSceneService";
import { sceneEditSchema } from "@/lib/validation/scene";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    return jsonData(await productionSceneService.list(actor, projectId));
  });
}

export function PATCH(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId } = await context.params;
    const sceneNumber = Number(new URL(request.url).searchParams.get("sceneNumber"));
    const parsed = sceneEditSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the scene plan");
    const scene = await productionSceneService.update(actor, projectId, sceneNumber, parsed.data);
    return jsonData({ scene });
  });
}
