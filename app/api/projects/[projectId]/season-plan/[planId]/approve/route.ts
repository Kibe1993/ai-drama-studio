import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData } from "@/lib/http/errors";
import { seasonPlanService } from "@/lib/services/seasonPlanService";

type Context = { params: Promise<{ projectId: string; planId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId, planId } = await context.params;
    return jsonData(await seasonPlanService.approve(actor, projectId, planId));
  });
}
