import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, toErrorResponse } from "@/lib/http/errors";
import { projectService } from "@/lib/services/projectService";

type Context = { params: Promise<{ projectId: string }> };

async function action(
  context: Context,
  run: (actor: Awaited<ReturnType<typeof readActor>>, id: string) => Promise<unknown>
) {
  try {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId } = await context.params;
    const project = await run(actor, projectId);
    return jsonData({ project });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export function POST(_request: Request, context: Context) {
  return action(context, (actor, id) => projectService.duplicate(actor, id));
}
