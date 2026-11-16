import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { validateSeasonPlanRich } from "@/lib/domain/planValidation";
import { diagnoseFindings, type FindingDiagnosis } from "@/lib/domain/planValidation/findingDiagnoser";
import { planRevisions, shouldStopRevising } from "@/lib/domain/planValidation/revisionPlanner";
import type { RevisionPlan } from "@/lib/validation/revisionPlan";
import {
  executeRevisions,
  type RevisionLLMCaller,
  type RevisionExecutionResult,
} from "@/lib/domain/planValidation/revisionExecutor";
import {
  analyzeImpact,
  type ImpactReport,
} from "@/lib/domain/planValidation/impactAnalyzer";
import { DEFAULT_MAX_ROUNDS } from "@/lib/validation/revisionPlan";

/**
 * Revalidation Loop Controller — orchestrates the full revision cycle:
 *
 *   diagnose → plan → execute → impact analysis → revalidate → repeat
 *
 * The loop is bounded by maxRounds (default 3). It stops when:
 * 1. All blocking/high findings are resolved (validation passes)
 * 2. No further safe corrections are possible
 * 3. The revision limit is reached
 * 4. Human approval is needed before further revision
 * 5. New contradictions are introduced by a revision
 *
 * The controller never calls an LLM directly — it delegates to the injected
 * RevisionLLMCaller. All validation is deterministic (no AI reasoning in the loop).
 */

// ---------------------------------------------------------------------------
// Round result — one iteration of the loop
// ---------------------------------------------------------------------------

export interface RevisionRoundResult {
  round: number;
  diagnoses: FindingDiagnosis[];
  revisionPlan: RevisionPlan;
  executionResult: RevisionExecutionResult;
  impactReports: ImpactReport[];
  revalidationFindings: RichValidationFinding[];
  revalidationPassed: boolean;
  newFindingsIntroduced: RichValidationFinding[];
  stopped: boolean;
  stopReason: string;
}

// ---------------------------------------------------------------------------
// Loop result — the final output
// ---------------------------------------------------------------------------

export type LoopStopReason =
  | "all_blocking_resolved"
  | "no_safe_corrections"
  | "max_rounds_reached"
  | "human_approval_needed"
  | "new_contradictions_introduced"
  | "execution_failed"
  | "no_findings";

export interface RevalidationLoopResult {
  finalPlan: SeasonPlan;
  rounds: RevisionRoundResult[];
  totalRounds: number;
  finalFindings: RichValidationFinding[];
  finalPassed: boolean;
  stopReason: LoopStopReason;
  totalRevisionsApplied: number;
  totalRevisionsRejected: number;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface RevisionValidateFn {
  (plan: SeasonPlan, bible: StoryBibleContent | null): {
    findings: RichValidationFinding[];
    passed: boolean;
  };
}

export interface RevalidationLoopInput {
  initialFindings: RichValidationFinding[];
  plan: SeasonPlan;
  bible: StoryBibleContent | null;
  ledger: ContinuityLedger | null;
  seriesTitle: string;
  llm: RevisionLLMCaller;
  validate?: RevisionValidateFn;
  maxRounds?: number;
  isSeasonFinale?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasBlockingOrHighFindings(findings: RichValidationFinding[]): boolean {
  return findings.some((f) => f.severity === "blocking" || f.severity === "high");
}

function hasActionableFindings(findings: RichValidationFinding[]): boolean {
  return findings.some(
    (f) => f.severity === "blocking" || f.severity === "high" || f.severity === "medium",
  );
}

function findNewFindings(
  original: RichValidationFinding[],
  revised: RichValidationFinding[],
): RichValidationFinding[] {
  const originalIds = new Set(original.map((f) => f.findingId));
  const originalMessages = new Set(original.map((f) => f.message));
  return revised.filter(
    (f) => !originalIds.has(f.findingId) && !originalMessages.has(f.message),
  );
}

function hasNewBlockingFindings(
  original: RichValidationFinding[],
  revised: RichValidationFinding[],
): boolean {
  const newFindings = findNewFindings(original, revised);
  return newFindings.some((f) => f.severity === "blocking");
}

function buildImpactReports(
  executionResult: RevisionExecutionResult,
  originalPlan: SeasonPlan,
  revisedPlan: SeasonPlan,
): ImpactReport[] {
  const reports: ImpactReport[] = [];
  for (const result of executionResult.results) {
    if (result.status !== "success" || !result.episodeNumber) continue;
    const originalEp = originalPlan.episodeProgression.find(
      (e) => e.episodeNumber === result.episodeNumber,
    );
    const revisedEp = revisedPlan.episodeProgression.find(
      (e) => e.episodeNumber === result.episodeNumber,
    );
    if (!originalEp || !revisedEp) continue;
    const report = analyzeImpact({
      originalEpisode: originalEp,
      revisedEpisode: revisedEp,
      plan: revisedPlan,
    });
    if (report.changes.length > 0) {
      reports.push(report);
    }
  }
  return reports;
}

// ---------------------------------------------------------------------------
// Main loop function
// ---------------------------------------------------------------------------

export async function runRevalidationLoop(
  input: RevalidationLoopInput,
): Promise<RevalidationLoopResult> {
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const isSeasonFinale = input.isSeasonFinale ?? false;
  const validate = input.validate ?? validateSeasonPlanRich;

  const rounds: RevisionRoundResult[] = [];
  let currentPlan = input.plan;
  let currentFindings = input.initialFindings;
  let totalRevisionsApplied = 0;
  let totalRevisionsRejected = 0;
  let stopReason: LoopStopReason = "no_findings";

  if (!hasActionableFindings(currentFindings)) {
    return {
      finalPlan: currentPlan,
      rounds: [],
      totalRounds: 0,
      finalFindings: currentFindings,
      finalPassed: true,
      stopReason: "no_findings",
      totalRevisionsApplied: 0,
      totalRevisionsRejected: 0,
    };
  }

  for (let round = 1; round <= maxRounds; round += 1) {
    const diagnoses = diagnoseFindings({
      findings: currentFindings,
      plan: currentPlan,
      bible: input.bible,
      ledger: input.ledger,
      isSeasonFinale,
    });

    const revisionPlan = planRevisions({ diagnoses, round, maxRounds });

    let stopped = false;
    let roundStopReason: string = "";

    if (revisionPlan.actions.length === 0 && revisionPlan.skipped.length > 0) {
      const hasInvestigate = revisionPlan.skipped.some(
        (s) => s.classification === "ambiguous_requires_investigation",
      );
      if (hasInvestigate) {
        stopped = true;
        roundStopReason = "Findings require human investigation.";
        stopReason = "human_approval_needed";
      } else {
        stopped = true;
        roundStopReason = "No safe corrections possible.";
        stopReason = "no_safe_corrections";
      }
    }

    if (!stopped && shouldStopRevising(revisionPlan)) {
      stopped = true;
      if (revisionPlan.actions.length === 0) {
        roundStopReason = "No actions to execute.";
        stopReason = "no_safe_corrections";
      } else {
        roundStopReason = "Cannot auto-apply any actions.";
        stopReason = "human_approval_needed";
      }
    }

    if (!stopped && !revisionPlan.canAutoApply && revisionPlan.requiresHumanApproval) {
      stopped = true;
      roundStopReason = "All remaining actions require human approval.";
      stopReason = "human_approval_needed";
    }

    let executionResult: RevisionExecutionResult;
    let impactReports: ImpactReport[];
    let revalidationFindings: RichValidationFinding[];
    let revalidationPassed: boolean;
    let newFindingsIntroduced: RichValidationFinding[];

    if (stopped) {
      executionResult = {
        revisedPlan: currentPlan,
        results: [],
        successCount: 0,
        rejectedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        allActionsApplied: false,
        stoppedEarly: true,
        stopReason: roundStopReason,
      };
      impactReports = [];
      revalidationFindings = currentFindings;
      revalidationPassed = !hasBlockingOrHighFindings(currentFindings);
      newFindingsIntroduced = [];
    } else {
      const planBeforeExecution = currentPlan;
      executionResult = await executeRevisions({
        plan: revisionPlan,
        seasonPlan: currentPlan,
        bible: input.bible,
        seriesTitle: input.seriesTitle,
        llm: input.llm,
      });

      currentPlan = executionResult.revisedPlan;
      totalRevisionsApplied += executionResult.successCount;
      totalRevisionsRejected += executionResult.rejectedCount;

      impactReports = buildImpactReports(executionResult, planBeforeExecution, currentPlan);

      const revalidationResult = validate(currentPlan, input.bible);
      revalidationFindings = revalidationResult.findings;
      revalidationPassed = revalidationResult.passed;
      currentFindings = revalidationFindings;

      newFindingsIntroduced = findNewFindings(input.initialFindings, revalidationFindings);

      if (executionResult.failedCount > 0 && executionResult.successCount === 0) {
        stopped = true;
        roundStopReason = `All ${executionResult.failedCount} action(s) failed.`;
        stopReason = "execution_failed";
      } else if (hasNewBlockingFindings(input.initialFindings, revalidationFindings)) {
        stopped = true;
        roundStopReason = "Revision introduced new blocking contradictions.";
        stopReason = "new_contradictions_introduced";
      } else if (!hasBlockingOrHighFindings(revalidationFindings)) {
        stopped = true;
        roundStopReason = "All blocking and high findings resolved.";
        stopReason = "all_blocking_resolved";
      } else if (executionResult.successCount === 0 && executionResult.rejectedCount > 0) {
        stopped = true;
        roundStopReason = "All revision attempts were rejected as unsafe.";
        stopReason = "no_safe_corrections";
      }
    }

    rounds.push({
      round,
      diagnoses,
      revisionPlan,
      executionResult,
      impactReports,
      revalidationFindings,
      revalidationPassed,
      newFindingsIntroduced,
      stopped,
      stopReason: roundStopReason,
    });

    if (stopped) break;

    if (round === maxRounds) {
      stopReason = "max_rounds_reached";
      rounds[rounds.length - 1]!.stopped = true;
      rounds[rounds.length - 1]!.stopReason = `Maximum rounds (${maxRounds}) reached.`;
      break;
    }
  }

  const finalPassed = !hasBlockingOrHighFindings(currentFindings);

  return {
    finalPlan: currentPlan,
    rounds,
    totalRounds: rounds.length,
    finalFindings: currentFindings,
    finalPassed,
    stopReason,
    totalRevisionsApplied,
    totalRevisionsRejected,
  };
}