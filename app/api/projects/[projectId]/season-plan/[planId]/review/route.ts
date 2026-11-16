import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";

type Context = { params: Promise<{ projectId: string; planId: string }> };

type ReviewBody = {
  entryId: string;
  decision: "approve" | "reject";
  notes?: string;
};

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId, planId } = await context.params;
    if (!isObjectId(projectId) || !isObjectId(planId)) {
      throw new StudioError("Invalid id", 400, "invalid_id");
    }
    const rawBody = await readJson(request);
    const body = rawBody as ReviewBody;
    if (!body.entryId || typeof body.entryId !== "string") {
      throw new StudioError("entryId is required", 400, "invalid_body");
    }
    if (body.decision !== "approve" && body.decision !== "reject") {
      throw new StudioError("decision must be 'approve' or 'reject'", 400, "invalid_body");
    }
    const plan = await seasonPlanRepository.findLatest(actor.userId, projectId);
    if (!plan || plan.id !== planId) {
      throw new StudioError("Season plan not found", 404, "not_found");
    }
    const notes = typeof body.notes === "string" ? body.notes : null;
    const reviewStatus = body.decision === "approve" ? "approved" : "rejected";
    const updated = await seasonPlanRepository.updateRevisionReviewStatus(
      actor.userId,
      planId,
      body.entryId,
      reviewStatus,
      actor.userId,
      notes,
    );
    if (!updated) {
      throw new StudioError("Revision history entry not found", 404, "entry_not_found");
    }
    return jsonData({
      planId: updated.id,
      entryId: body.entryId,
      decision: body.decision,
      message: `Revision ${body.entryId} ${body.decision === "approve" ? "approved" : "rejected"}.`,
    });
  });
}