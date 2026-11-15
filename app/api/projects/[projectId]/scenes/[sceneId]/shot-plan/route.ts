import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { createShotProductionService } from "@/lib/services/shotProductionService";
import { z } from "zod";
import { shotPlanSchema } from "@/lib/validation/scene";

const setShotPlanBodySchema = z.object({
  shotPlan: z.array(shotPlanSchema).min(1).max(20),
});

type Context = { params: Promise<{ projectId: string; sceneId: string }> };

export function PUT(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { sceneId } = await context.params;
    const parsed = setShotPlanBodySchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the shot plan");
    const service = createShotProductionService();
    const result = await service.setShotPlan(actor, sceneId, parsed.data.shotPlan);
    return jsonData(result);
  });
}