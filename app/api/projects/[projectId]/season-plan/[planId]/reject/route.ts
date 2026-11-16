import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";

type Context = { params: Promise<{ projectId: string; planId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId, planId } = await context.params;
    if (!isObjectId(projectId) || !isObjectId(planId)) {
      throw new StudioError("Invalid id", 400, "invalid_id");
    }
    const plan = await seasonPlanRepository.findLatest(actor.userId, projectId);
    if (!plan || plan.id !== planId) {
      throw new StudioError("Season plan not found", 404, "not_found");
    }
    if (plan.status === "approved") {
      throw new StudioError("Cannot reject an approved plan", 409, "plan_approved");
    }
    if (plan.status === "rejected") {
      return jsonData({ planId, status: "rejected", message: "Plan is already rejected." });
    }
    const updated = await seasonPlanRepository.markRejected(actor.userId, planId);
    if (!updated) {
      throw new StudioError("Plan could not be rejected", 409, "plan_reject_failed");
    }
    return jsonData({
      planId: updated.id,
      status: updated.status,
      message: "Plan rejected. The previous version remains available for use.",
    });
  });
}