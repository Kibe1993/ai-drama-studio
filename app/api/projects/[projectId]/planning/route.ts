import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { planningDocumentSchema } from "@/lib/validation/planning";
import { planningService } from "@/lib/services/planningService";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const planning = await planningService.get(actor, projectId);
    return jsonData({ planning });
  });
}

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = planningDocumentSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the planning details");
    const { projectId } = await context.params;
    return jsonData({ planning: await planningService.createOrUpdate(actor, projectId, parsed.data) }, 201);
  });
}