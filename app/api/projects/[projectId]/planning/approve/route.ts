import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { planningApprovalSchema } from "@/lib/validation/planning";
import { planningService } from "@/lib/services/planningService";

type Context = { params: Promise<{ projectId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = planningApprovalSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the approval details");
    const { projectId } = await context.params;
    if (parsed.data.rejectionReason) {
      return jsonData({ planning: await planningService.reject(actor, projectId, parsed.data.expectedVersion, parsed.data.rejectionReason) });
    }
    return jsonData({ planning: await planningService.approve(actor, projectId, parsed.data.expectedVersion) });
  });
}