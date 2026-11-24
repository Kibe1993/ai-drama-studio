import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { productionDesignSchema } from "@/lib/validation/productionDesign";
import { productionDesignService } from "@/lib/services/productionDesignService";

type Context = { params: Promise<{ projectId: string; sceneId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, sceneId } = await context.params;
    return jsonData({ design: await productionDesignService.getByScene(actor, projectId, sceneId) });
  });
}

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = productionDesignSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the production design");
    const { projectId, sceneId } = await context.params;
    return jsonData({ design: await productionDesignService.createOrUpdate(actor, projectId, sceneId, parsed.data) }, 201);
  });
}