import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData, StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { validateSeasonPlanRich } from "@/lib/domain/planValidation";
import { buildValidationReport } from "@/lib/services/seasonPlanValidationService";

type Context = { params: Promise<{ projectId: string; planId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, planId } = await context.params;
    if (!isObjectId(projectId) || !isObjectId(planId)) {
      throw new StudioError("Invalid id", 400, "invalid_id");
    }
    const plan = await seasonPlanRepository.findLatest(actor.userId, projectId);
    if (!plan || plan.id !== planId) {
      throw new StudioError("Season plan not found", 404, "not_found");
    }
    const bible = await storyBibleRepository.findOwned(actor.userId, projectId);
    const bibleContent = bible?.approvedSnapshot?.content ?? null;

    const result = plan.validationResult
      ? plan.validationResult
      : validateSeasonPlanRich(plan, bibleContent, {
          bibleVersion: bible?.approvedVersion,
          planVersion: plan.version,
        });

    if (!plan.validationResult) {
      await seasonPlanRepository.saveValidationResult(actor.userId, planId, result);
    }

    const report = buildValidationReport(result);
    return jsonData(report);
  });
}