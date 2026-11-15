import "server-only";
import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type {
  RichValidationFinding,
  SeasonPlanValidationResult,
  RepairAttempt,
} from "@/lib/validation/seasonPlanValidation";
import {
  buildValidationResult,
  runDeterministicValidation,
  type ValidationOptions,
} from "@/lib/domain/planValidation";
import { deriveNarrativeContract } from "@/lib/domain/planValidation/climaxValidator";
import { extractEvents } from "@/lib/domain/planValidation/temporalValidator";
import { extractStoryThreads } from "@/lib/domain/planValidation/setupPayoffValidator";
import {
  initializeCharacterStates,
  applyEpisodeToStates,
} from "@/lib/domain/planValidation/characterStateValidator";
import {
  selectFindingsForRepair,
  shouldAttemptRepair,
  buildRepairInstruction,
  applyEpisodeRepair,
  createRepairAttempt,
} from "@/lib/domain/planValidation/repairEngine";
import { convertAIToRichFindings, type SeasonPlanReasoningPrompt, type AIReasoningResult } from "@/lib/providers/llm/seasonPlanReasoning";
import { log } from "@/lib/log";

export interface ValidationReport {
  overallResult: "pass" | "fail" | "pass_with_warnings";
  approvalEligible: boolean;
  totalFindings: number;
  blockingCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  affectedEpisodes: number[];
  canonConsistencyResult: "pass" | "fail" | "not_checked";
  chronologyResult: "pass" | "fail" | "not_checked";
  characterContinuityResult: "pass" | "fail" | "not_checked";
  narrativeProgressionResult: "pass" | "fail" | "not_checked";
  setupPayoffResult: "pass" | "fail" | "not_checked";
  climaxFinaleResult: "pass" | "fail" | "not_checked";
  aiReasoningAvailable: boolean;
  repairStatus: "none" | "attempted" | "resolved" | "failed";
  findings: RichValidationFinding[];
  repairHistory: RepairAttempt[];
}

export function buildValidationReport(result: SeasonPlanValidationResult): ValidationReport {
  const findings = result.findings;
  const blockingCount = findings.filter((f) => f.severity === "blocking").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;
  const affectedEpisodes = [...new Set(
    findings.filter((f) => f.episodeNumber).map((f) => f.episodeNumber!)
  )].sort((a, b) => a - b);

  const hasCategory = (prefix: string) => findings.some((f) => f.category.startsWith(prefix));
  const categoryFailed = (prefix: string) => findings.some((f) =>
    f.category.startsWith(prefix) && (f.severity === "blocking" || f.severity === "high")
  );

  const repairStatus = result.repairHistory.length === 0
    ? "none"
    : result.repairHistory.some((r) => r.status === "success")
      ? "resolved"
      : "failed";

  return {
    overallResult: result.passed
      ? mediumCount + lowCount > 0 ? "pass_with_warnings" : "pass"
      : "fail",
    approvalEligible: result.passed,
    totalFindings: findings.length,
    blockingCount,
    highCount,
    mediumCount,
    lowCount,
    affectedEpisodes,
    canonConsistencyResult: hasCategory("canon") || hasCategory("unknown_entity") || hasCategory("world_rule")
      ? categoryFailed("canon") || categoryFailed("unknown_entity") || categoryFailed("world_rule") ? "fail" : "pass"
      : "not_checked",
    chronologyResult: hasCategory("temporal") || hasCategory("cyclic")
      ? categoryFailed("temporal") || categoryFailed("cyclic") ? "fail" : "pass"
      : "not_checked",
    characterContinuityResult: hasCategory("character") || hasCategory("knowledge")
      ? categoryFailed("character") || categoryFailed("knowledge") ? "fail" : "pass"
      : "not_checked",
    narrativeProgressionResult: hasCategory("narrative") || hasCategory("episode_prog") || hasCategory("conflict")
      ? categoryFailed("narrative") || categoryFailed("episode_prog") || categoryFailed("conflict") ? "fail" : "pass"
      : "not_checked",
    setupPayoffResult: hasCategory("setup")
      ? categoryFailed("setup") ? "fail" : "pass"
      : "not_checked",
    climaxFinaleResult: hasCategory("climax") || hasCategory("premature")
      ? categoryFailed("climax") || categoryFailed("premature") ? "fail" : "pass"
      : "not_checked",
    aiReasoningAvailable: result.aiReasoning?.available ?? false,
    repairStatus,
    findings,
    repairHistory: result.repairHistory,
  };
}

export interface ValidationServiceDeps {
  llm?: {
    reasonSeasonPlan?(input: SeasonPlanReasoningPrompt, options?: { signal?: AbortSignal }): Promise<{
      result: AIReasoningResult;
      provider?: string;
      model?: string;
      fallbackFrom?: string | null;
    }>;
  };
  enableAIReasoning?: boolean;
}

export function createSeasonPlanValidationService(deps: ValidationServiceDeps = {}) {
  return {
    async validate(
      plan: SeasonPlan,
      bible: StoryBibleContent | null,
      options?: ValidationOptions,
    ): Promise<SeasonPlanValidationResult> {
      const deterministicFindings = runDeterministicValidation(plan, bible, options);
      let aiFindings: RichValidationFinding[] | null = null;
      let aiMetadata: {
        available: boolean;
        provider?: string;
        model?: string;
        fallbackFrom?: string | null;
        error?: string;
        latencyMs?: number;
      } = { available: false };

      if (deps.enableAIReasoning && deps.llm?.reasonSeasonPlan) {
        try {
          const contract = deriveNarrativeContract(plan);
          const events = extractEvents(plan);
          const threads = extractStoryThreads(plan);
          const charStates = initializeCharacterStates(bible);
          for (const ep of plan.episodeProgression) {
            applyEpisodeToStates(charStates, ep);
          }

          const reasoningInput: SeasonPlanReasoningPrompt = {
            seriesTitle: bible?.identity.title ?? "Unknown",
            seasonPlan: plan,
            bibleContent: bible,
            deterministicFindings,
            narrativeContract: contract,
            eventDependencies: events,
            characterStateTransitions: Array.from(charStates.values()),
            setupPayoffRecords: threads,
          };

          const aiStart = Date.now();
          const response = await deps.llm.reasonSeasonPlan(reasoningInput, {
            signal: AbortSignal.timeout(120_000),
          });
          aiFindings = convertAIToRichFindings(response.result.findings);
          aiMetadata = {
            available: true,
            provider: response.provider,
            model: response.model,
            fallbackFrom: response.fallbackFrom,
            latencyMs: Date.now() - aiStart,
          };
          log.info("season-plan-validation", "AI reasoning complete", {
            findingCount: aiFindings.length,
            provider: response.provider,
            model: response.model,
            latencyMs: aiMetadata.latencyMs,
          });
        } catch (error) {
          aiMetadata = {
            available: false,
            error: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
          };
          log.info("season-plan-validation", "AI reasoning failed", {
            error: aiMetadata.error,
          });
        }
      }

      return buildValidationResult(deterministicFindings, aiFindings, options, aiMetadata);
    },

    buildReport(result: SeasonPlanValidationResult): ValidationReport {
      return buildValidationReport(result);
    },

    selectFindingsForRepair,
    shouldAttemptRepair,
    buildRepairInstruction,
    applyEpisodeRepair,
    createRepairAttempt,
  };
}