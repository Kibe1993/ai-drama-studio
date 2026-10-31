import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, toErrorResponse } from "@/lib/http/errors";
import { projectService } from "@/lib/services/projectService";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId } = await context.params;
    const project = await projectService.restore(actor, projectId);
    return jsonData({ project });
  } catch (error) {
    return toErrorResponse(error);
  }
}
