import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData, toErrorResponse } from "@/lib/http/errors";
import { projectService } from "@/lib/services/projectService";
import { projectUpdateSchema } from "@/lib/validation/project";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const actor = await readActor();
    const { projectId } = await context.params;
    const project = await projectService.get(actor, projectId);
    return jsonData({ project });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId } = await context.params;
    const parsed = projectUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const project = await projectService.update(actor, projectId, parsed.data);
    return jsonData({ project });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId } = await context.params;
    const result = await projectService.remove(actor, projectId);
    return jsonData(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
