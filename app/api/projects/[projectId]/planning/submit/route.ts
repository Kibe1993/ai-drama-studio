import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData } from "@/lib/http/errors";
import { planningService } from "@/lib/services/planningService";

type Context = { params: Promise<{ projectId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId } = await context.params;
    return jsonData({ planning: await planningService.submit(actor, projectId) });
  });
}