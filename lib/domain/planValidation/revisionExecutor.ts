import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RevisionPlan, RevisionAction } from "@/lib/validation/revisionPlan";
import { AUTO_APPLICABLE_ACTIONS } from "@/lib/validation/revisionPlan";
import {
  type EpisodeRevisionPrompt,

} from "@/lib/providers/llm/episodeRevision";
import type { LLMProvider } from "@/lib/providers/llm/types";
import {
  checkRevisionSafety,
  checkPlanIsolation,
  type SafetyCheckResult,
} from "@/lib/domain/planValidation/revisionSafetyChecker";

/**
 * Revision Executor — takes a RevisionPlan and applies targeted corrections
 * to the season plan using the LLM.
 *
 * The executor:
 * 1. Iterates over auto-applicable actions in priority order
 * 2. For each action, builds a revision prompt and calls the LLM
 * 3. Validates the LLM response with safety checks
 * 4. Applies the revision to the plan if safe, rejects if unsafe
 * 5. Records the result of each action
 * 6. Returns the revised plan + execution results
 *
 * The executor is injectable: tests pass a mock LLM caller instead of
 * calling a real provider.
 */

// ---------------------------------------------------------------------------
// LLM caller interface — injectable for testing
// ---------------------------------------------------------------------------

export interface RevisionLLMCaller {
  reviseEpisode(
    prompt: EpisodeRevisionPrompt,
  ): Promise<{ episode: EpisodePlanItem; provider: string; model: string }>;
}

// ---------------------------------------------------------------------------
// Execution result types
// ---------------------------------------------------------------------------

export type ActionExecutionStatus = "success" | "rejected_unsafe" | "failed" | "skipped";

export interface ActionExecutionResult {
  actionId: string;
  groupId: string;
  status: ActionExecutionStatus;
  episodeNumber: number | null;
  provider: string;
  model: string;
  violations: SafetyCheckResult["violations"];
  message: string;
  appliedAt: string;
}

export interface RevisionExecutionResult {
  revisedPlan: SeasonPlan;
  results: ActionExecutionResult[];
  successCount: number;
  rejectedCount: number;
  failedCount: number;
  skippedCount: number;
  allActionsApplied: boolean;
  stoppedEarly: boolean;
  stopReason: string | null;
}

// ---------------------------------------------------------------------------
// Helper: find an episode in the plan
// ---------------------------------------------------------------------------

function findEpisode(plan: SeasonPlan, episodeNumber: number): EpisodePlanItem | null {
  return plan.episodeProgression.find((ep) => ep.episodeNumber === episodeNumber) ?? null;
}

// ---------------------------------------------------------------------------
// Helper: apply a revised episode to the plan
// ---------------------------------------------------------------------------

function applyRevisedEpisode(plan: SeasonPlan, revisedEpisode: EpisodePlanItem): SeasonPlan {
  const episodeProgression = plan.episodeProgression.map((ep) =>
    ep.episodeNumber === revisedEpisode.episodeNumber ? revisedEpisode : ep,
  );
  return { ...plan, episodeProgression };
}

// ---------------------------------------------------------------------------
// Helper: build the prompt for an action
// ---------------------------------------------------------------------------

function buildPrompt(
  action: RevisionAction,
  plan: SeasonPlan,
  bible: StoryBibleContent | null,
  seriesTitle: string,
): EpisodeRevisionPrompt | null {
  const episodeNumber = action.target.episodeNumber ?? action.affectedEpisodes[0];
  if (!episodeNumber) return null;

  const currentEpisode = findEpisode(plan, episodeNumber);
  if (!currentEpisode) return null;

  const previousEpisode = episodeNumber > 1 ? findEpisode(plan, episodeNumber - 1) : null;
  const nextEpisode = findEpisode(plan, episodeNumber + 1);

  return {
    seriesTitle,
    action,
    currentEpisode,
    seasonPlanObjective: plan.seasonObjective,
    bible,
    previousEpisode,
    nextEpisode,
  };
}

// ---------------------------------------------------------------------------
// Helper: determine if an action should be executed
// ---------------------------------------------------------------------------

function shouldExecute(action: RevisionAction): boolean {
  if (action.requiresHumanApproval) return false;
  if (!AUTO_APPLICABLE_ACTIONS.has(action.type)) return false;
  if (action.type === "preserve_intentional") return false;
  if (action.type === "investigate") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main executor function
// ---------------------------------------------------------------------------

export interface ExecuteRevisionsInput {
  plan: RevisionPlan;
  seasonPlan: SeasonPlan;
  bible: StoryBibleContent | null;
  seriesTitle: string;
  llm: RevisionLLMCaller;
  stopOnFailure?: boolean;
}

export async function executeRevisions(
  input: ExecuteRevisionsInput,
): Promise<RevisionExecutionResult> {
  const { plan, bible, seriesTitle, llm } = input;
  const stopOnFailure = input.stopOnFailure ?? true;

  let currentPlan = input.seasonPlan;
  const results: ActionExecutionResult[] = [];
  let stoppedEarly = false;
  let stopReason: string | null = null;

  for (const action of plan.actions) {
    if (!shouldExecute(action)) {
      results.push({
        actionId: action.actionId,
        groupId: action.groupId,
        status: "skipped",
        episodeNumber: action.target.episodeNumber ?? null,
        provider: "",
        model: "",
        violations: [],
        message: `Action type "${action.type}" requires human approval or is not auto-applicable.`,
        appliedAt: new Date().toISOString(),
      });
      continue;
    }

    const prompt = buildPrompt(action, currentPlan, bible, seriesTitle);
    if (!prompt) {
      results.push({
        actionId: action.actionId,
        groupId: action.groupId,
        status: "skipped",
        episodeNumber: action.target.episodeNumber ?? null,
        provider: "",
        model: "",
        violations: [],
        message: "Could not build prompt — target episode not found in plan.",
        appliedAt: new Date().toISOString(),
      });
      continue;
    }

    let llmResult;
    try {
      llmResult = await llm.reviseEpisode(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        actionId: action.actionId,
        groupId: action.groupId,
        status: "failed",
        episodeNumber: action.target.episodeNumber ?? null,
        provider: "",
        model: "",
        violations: [],
        message: `LLM call failed: ${message}`,
        appliedAt: new Date().toISOString(),
      });
      if (stopOnFailure) {
        stoppedEarly = true;
        stopReason = `LLM call failed for action ${action.actionId}: ${message}`;
        break;
      }
      continue;
    }

    const originalEpisode = prompt.currentEpisode;
    const safetyResult = checkRevisionSafety(
      originalEpisode,
      llmResult.episode,
      action,
      bible,
    );

    if (!safetyResult.passed) {
      results.push({
        actionId: action.actionId,
        groupId: action.groupId,
        status: "rejected_unsafe",
        episodeNumber: action.target.episodeNumber ?? null,
        provider: llmResult.provider,
        model: llmResult.model,
        violations: safetyResult.violations,
        message: `Revision rejected: ${safetyResult.violations.map((v) => v.message).join("; ")}`,
        appliedAt: new Date().toISOString(),
      });
      continue;
    }

    const revisedPlan = applyRevisedEpisode(currentPlan, llmResult.episode);
    const isolationResult = checkPlanIsolation(
      currentPlan,
      revisedPlan,
      llmResult.episode.episodeNumber,
    );

    if (!isolationResult.passed) {
      results.push({
        actionId: action.actionId,
        groupId: action.groupId,
        status: "rejected_unsafe",
        episodeNumber: action.target.episodeNumber ?? null,
        provider: llmResult.provider,
        model: llmResult.model,
        violations: isolationResult.violations,
        message: `Isolation check failed: ${isolationResult.violations.map((v) => v.message).join("; ")}`,
        appliedAt: new Date().toISOString(),
      });
      continue;
    }

    currentPlan = revisedPlan;
    results.push({
      actionId: action.actionId,
      groupId: action.groupId,
      status: "success",
      episodeNumber: llmResult.episode.episodeNumber,
      provider: llmResult.provider,
      model: llmResult.model,
      violations: [],
      message: `Revision applied successfully to episode ${llmResult.episode.episodeNumber}.`,
      appliedAt: new Date().toISOString(),
    });
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const rejectedCount = results.filter((r) => r.status === "rejected_unsafe").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const executableActions = plan.actions.filter(shouldExecute).length;
  const allActionsApplied = successCount === executableActions && !stoppedEarly;

  return {
    revisedPlan: currentPlan,
    results,
    successCount,
    rejectedCount,
    failedCount,
    skippedCount,
    allActionsApplied,
    stoppedEarly,
    stopReason,
  };
}

// ---------------------------------------------------------------------------
// Utility: create a mock LLM caller for testing
// ---------------------------------------------------------------------------

export function createMockLLMCaller(
  handler: (prompt: EpisodeRevisionPrompt) => EpisodePlanItem,
  provider = "mock",
  model = "mock-model",
): RevisionLLMCaller {
  return {
    async reviseEpisode(prompt: EpisodeRevisionPrompt) {
      const episode = handler(prompt);
      return { episode, provider, model };
    },
  };
}
export function createRevisionLLMCallerFromProvider(
  llm: Pick<LLMProvider, "reviseEpisode">,
): RevisionLLMCaller {
  return {
    async reviseEpisode(prompt: EpisodeRevisionPrompt) {
      if (!llm.reviseEpisode) {
        throw new Error("LLM provider does not support episode revision.");
      }
      const result = await llm.reviseEpisode(prompt);
      return {
        episode: result.episode,
        provider: result.provider ?? "unknown",
        model: result.model ?? "unknown",
      };
    },
  };
}