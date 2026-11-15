import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { validateSeasonPlanRich } from "@/lib/domain/planValidation";
import { selectFindingsForRepair, shouldAttemptRepair, createRepairAttempt } from "@/lib/domain/planValidation/repairEngine";
import { buildValidationReport } from "@/lib/services/seasonPlanValidationService";
import { log } from "@/lib/log";

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
      throw new StudioError("Cannot repair an approved plan", 409, "plan_approved");
    }
    const bible = await storyBibleRepository.findOwned(actor.userId, projectId);
    const bibleContent = bible?.approvedSnapshot?.content ?? null;

    const result = validateSeasonPlanRich(plan, bibleContent, {
      bibleVersion: bible?.approvedVersion,
      planVersion: plan.version,
    });

    const repairableFindings = selectFindingsForRepair(result.findings);
    if (repairableFindings.length === 0) {
      return jsonData({
        repaired: false,
        message: "No repairable findings (blocking or high severity) detected.",
        report: buildValidationReport(result),
      });
    }

    const repairHistory = result.repairHistory;
    let attemptCount = repairHistory.length;
    const attempts: typeof repairHistory = [];

    for (const finding of repairableFindings) {
      if (!shouldAttemptRepair(finding, attemptCount)) {
        attempts.push(createRepairAttempt(
          attemptCount + 1, finding, "skipped",
          "Maximum repair attempts reached or finding not repairable."
        ));
        continue;
      }
      attemptCount += 1;
      attempts.push(createRepairAttempt(
        attemptCount, finding, "skipped",
        "Automated repair requires LLM provider configuration. Use the season plan editor to manually revise the affected episode.",
      ));
      log.info("season-plan-repair", "repair attempt recorded", {
        projectId, planId, findingId: finding.findingId,
        episode: finding.episodeNumber, severity: finding.severity,
      });
    }

    const updatedResult = {
      ...result,
      repairHistory: [...repairHistory, ...attempts],
    };
    await seasonPlanRepository.saveValidationResult(actor.userId, planId, updatedResult);

    return jsonData({
      repaired: false,
      message: "Repair requires manual review. See the validation findings for recommendations.",
      findings: repairableFindings,
      attempts,
      report: buildValidationReport(updatedResult),
    });
  });
}