import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { validateSeasonPlanRich } from "@/lib/domain/planValidation";
import { buildValidationReport } from "@/lib/services/seasonPlanValidationService";
import { runRevalidationLoop } from "@/lib/domain/planValidation/revalidationLoop";
import { createRevisionLLMCallerFromProvider } from "@/lib/domain/planValidation/revisionExecutor";
import { createRevisionHistoryEntry } from "@/lib/domain/planValidation/revisionHistory";
import { createStoryProvider } from "@/lib/providers/llm/registry";
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

    const actionableFindings = result.findings.filter(
      (f) => f.severity === "blocking" || f.severity === "high" || f.severity === "medium",
    );
    if (actionableFindings.length === 0) {
      return jsonData({
        repaired: false,
        message: "No actionable findings (blocking, high, or medium severity) detected.",
        report: buildValidationReport(result),
      });
    }

    const llm = createStoryProvider();
    const revisionCaller = createRevisionLLMCallerFromProvider(llm);

    const loopResult = await runRevalidationLoop({
      initialFindings: actionableFindings,
      plan,
      bible: bibleContent,
      ledger: null,
      seriesTitle: bibleContent?.identity.title ?? "Untitled Series",
      llm: revisionCaller,
    });

    if (loopResult.totalRevisionsApplied === 0) {
      const updatedResult = {
        ...result,
        repairHistory: [...result.repairHistory, {
          attempt: 1,
          findingId: "loop",
          episodeNumber: undefined as unknown as number,
          provider: "revision-engine",
          model: "revalidation-loop",
          status: "skipped" as const,
          message: `Revision loop stopped: ${loopResult.stopReason}. No changes applied.`,
          repairedAt: new Date().toISOString(),
        }],
      };
      await seasonPlanRepository.saveValidationResult(actor.userId, planId, updatedResult);

      return jsonData({
        repaired: false,
        message: `Revision loop completed without applying changes. Stop reason: ${loopResult.stopReason}.`,
        stopReason: loopResult.stopReason,
        totalRounds: loopResult.totalRounds,
        report: buildValidationReport(updatedResult),
      });
    }

    const newPlan = await seasonPlanRepository.insert({
      ...loopResult.finalPlan,
      clerkUserId: actor.userId,
      projectId,
      basedOnBibleVersion: plan.basedOnBibleVersion,
      basedOnBibleFingerprint: plan.basedOnBibleFingerprint,
      provider: "revision-engine",
      model: "revalidation-loop",
    });

    const newValidation = validateSeasonPlanRich(newPlan, bibleContent, {
      bibleVersion: bible?.approvedVersion,
      planVersion: newPlan.version,
    });
    await seasonPlanRepository.saveValidationResult(actor.userId, newPlan.id, newValidation);

    const historyEntry = createRevisionHistoryEntry(
      loopResult,
      "auto_revalidation",
      plan.version,
      newPlan.version,
      `Automatic revision via revalidation loop (${loopResult.stopReason}).`,
      actionableFindings.length,
      plan,
    );
    await seasonPlanRepository.appendRevisionHistoryEntry(actor.userId, newPlan.id, historyEntry);

    log.info("season-plan-repair", "revision loop completed", {
      projectId,
      fromVersion: plan.version,
      toVersion: newPlan.version,
      stopReason: loopResult.stopReason,
      totalRounds: loopResult.totalRounds,
      revisionsApplied: loopResult.totalRevisionsApplied,
      revisionsRejected: loopResult.totalRevisionsRejected,
    });

    return jsonData({
      repaired: true,
      message: `Revision loop applied ${loopResult.totalRevisionsApplied} correction(s) across ${loopResult.totalRounds} round(s).`,
      stopReason: loopResult.stopReason,
      totalRounds: loopResult.totalRounds,
      totalRevisionsApplied: loopResult.totalRevisionsApplied,
      totalRevisionsRejected: loopResult.totalRevisionsRejected,
      newPlanId: newPlan.id,
      newVersion: newPlan.version,
      finalPassed: loopResult.finalPassed,
      reviewStatus: "pending",
      report: buildValidationReport(newValidation),
    });
  });
}