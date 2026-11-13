import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData } from "@/lib/http/errors";
import { seasonPlanService } from "@/lib/services/seasonPlanService";

type Context = { params: Promise<{ projectId: string; planId: string }> };

/** Save a creator's manual edit of the plan as a new version (CASNA Stage D). */
export function PATCH(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId, planId } = await context.params;
    return jsonData(await seasonPlanService.update(actor, projectId, planId, await readJson(request)));
  });
}
