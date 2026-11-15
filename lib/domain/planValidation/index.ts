import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type {
  RichValidationFinding,
  SeasonPlanValidationResult,
} from "@/lib/validation/seasonPlanValidation";
import {
  VALIDATOR_VERSION,
  highestSeverity,
  makeFindingId,
  passesValidation,
  resetFindingIdCounter,
  toLegacyCategory,
  toLegacySeverity,
} from "@/lib/validation/seasonPlanValidation";

import { validateSeasonStructure, validateReferenceIntegrity, validateRelationshipIntegrity, validateEpisodeIndexing } from "./structuralValidator";
import { validateCanonConsistency } from "./canonValidator";
import { validateTemporalContinuity } from "./temporalValidator";
import { validateCharacterStateContinuity } from "./characterStateValidator";
import { validateEpisodeProgression, validateCharacterDevelopment } from "./progressionValidator";
import { validateSetupPayoff } from "./setupPayoffValidator";
import { validateClimaxAndResolution } from "./climaxValidator";

export interface ValidationOptions {
  expectedEpisodeCount?: number;
  enableAIReasoning?: boolean;
  bibleVersion?: number;
  planVersion?: number;
}

export function runDeterministicValidation(
  plan: SeasonPlan,
  bible: StoryBibleContent | null,
  options?: ValidationOptions,
): RichValidationFinding[] {
  resetFindingIdCounter();
  const findings: RichValidationFinding[] = [
    ...validateSeasonStructure(plan, options?.expectedEpisodeCount),
    ...validateEpisodeIndexing(plan),
    ...validateReferenceIntegrity(plan, bible),
    ...validateRelationshipIntegrity(plan, bible),
    ...validateCanonConsistency(plan, bible),
    ...validateTemporalContinuity(plan),
    ...validateCharacterStateContinuity(plan, bible),
    ...validateEpisodeProgression(plan),
    ...validateCharacterDevelopment(plan),
    ...validateSetupPayoff(plan),
    ...validateClimaxAndResolution(plan, bible),
  ];
  return findings;
}

export function buildValidationResult(
  deterministicFindings: RichValidationFinding[],
  aiFindings: RichValidationFinding[] | null,
  options?: ValidationOptions,
  aiMetadata?: {
    available: boolean;
    provider?: string;
    model?: string;
    fallbackFrom?: string | null;
    error?: string;
    latencyMs?: number;
  },
): SeasonPlanValidationResult {
  const allFindings = aiFindings
    ? [...deterministicFindings, ...aiFindings]
    : deterministicFindings;
  const overall = highestSeverity(allFindings);
  const passed = passesValidation(allFindings);

  return {
    passed,
    overallSeverity: overall,
    findings: allFindings,
    deterministicFindingCount: deterministicFindings.length,
    aiFindingCount: aiFindings?.length ?? 0,
    aiReasoning: aiMetadata
      ? {
          available: aiMetadata.available,
          provider: aiMetadata.provider ?? "",
          model: aiMetadata.model ?? "",
          fallbackFrom: aiMetadata.fallbackFrom ?? null,
          findingCount: aiFindings?.length ?? 0,
          error: aiMetadata.error,
          latencyMs: aiMetadata.latencyMs,
        }
      : undefined,
    repairHistory: [],
    validatorVersion: VALIDATOR_VERSION,
    validatedAt: new Date().toISOString(),
    bibleVersion: options?.bibleVersion,
    planVersion: options?.planVersion,
  };
}

export function validateSeasonPlanRich(
  plan: SeasonPlan,
  bible: StoryBibleContent | null,
  options?: ValidationOptions,
): SeasonPlanValidationResult {
  const deterministicFindings = runDeterministicValidation(plan, bible, options);
  return buildValidationResult(deterministicFindings, null, options);
}

export function toLegacyFindings(
  richFindings: RichValidationFinding[],
): Array<{
  category: string;
  severity: "error" | "warning";
  episodeNumber?: number;
  message: string;
}> {
  return richFindings.map((f) => ({
    category: toLegacyCategory(f.category) as
      | "continuity" | "progression" | "repetition"
      | "character_development" | "narrative_structure",
    severity: toLegacySeverity(f.severity),
    episodeNumber: f.episodeNumber,
    message: f.message,
  }));
}

export type { RichValidationFinding, SeasonPlanValidationResult };
export { makeFindingId, resetFindingIdCounter };