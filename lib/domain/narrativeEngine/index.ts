import type { NarrativeRegistry, NarrativeValidationFinding, NarrativeValidationResult, NarrativeRegistryContext } from "@/lib/validation/narrativeEngine";
import { buildNarrativeRegistry } from "@/lib/domain/narrativeEngine/registryBuilder";
import { validateSeasonNarrative, summarizeFindings } from "@/lib/domain/narrativeEngine/validators";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { makeFindingId } from "@/lib/validation/seasonPlanValidation";
import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { CanonicalEntityRegistry } from "@/lib/validation/canonicalRegistry";
import { buildRegistry } from "@/lib/domain/canonicalRegistry";
import type { CharacterProfile } from "@/lib/validation/productionStages";

export interface NarrativeEngineInput {
  bible: StoryBibleContent | null;
  plan: SeasonPlan;
  ledger: ContinuityLedger | null;
  ledgerAsOfEpisode?: number;
  characterProfiles?: CharacterProfile[];
  canonicalRegistry?: CanonicalEntityRegistry;
}

export function convertToRichFindings(
  findings: NarrativeValidationFinding[],
): RichValidationFinding[] {
  return findings.map((f) => ({
    findingId: makeFindingId("ne"),
    category: mapCodeToCategory(f.code),
    severity: f.severity === "error" ? "blocking" : f.severity === "warning" ? "high" : "low",
    episodeNumber: f.episode || undefined,
    message: f.message,
    explanation: f.evidence,
    evidence: f.evidence ? [f.evidence] : [],
    recommendation: f.suggestedAction,
    requiresHumanReview: f.severity === "error",
    source: "deterministic",
  }));
}

function mapCodeToCategory(code: string): RichValidationFinding["category"] {
  const map: Record<string, RichValidationFinding["category"]> = {
    DUPLICATE_CANONICAL_IDENTITY: "canon_contradiction",
    ALIAS_CONFLICT: "canon_contradiction",
    APPEARANCE_BEFORE_INTRODUCTION: "temporal_continuity",
    UNEXPLAINED_PRE_INTRODUCTION_REFERENCE: "unknown_entity_reference",
    DECEASED_ENTITY_ACTIVE: "character_state",
    AUDIENCE_REVEAL_BEFORE_EVENT: "temporal_continuity",
    DUPLICATE_OCCURRENCE_ORDER: "temporal_continuity",
    CYCLIC_CAUSAL_DEPENDENCY: "cyclic_dependency",
    DUPLICATE_KNOWLEDGE_ACQUISITION: "knowledge_chronology",
    PROTECTED_REVELATION_DISCLOSED_EARLY: "knowledge_chronology",
    RELATIONSHIP_INVALID_ENTITY: "relationship_integrity",
    RELATIONSHIP_BEFORE_ENTITY_INTRODUCTION: "relationship_integrity",
    RELATIONSHIP_NO_STATE_CHANGE: "relationship_integrity",
    MISSING_CAUSAL_EVENT: "temporal_continuity",
    UNACKNOWLEDGED_PREVIOUS_CONSEQUENCE: "narrative_progression",
    BROKEN_CAUSAL_LINK: "temporal_continuity",
    CAUSAL_LINK_BACKWARDS: "temporal_continuity",
    BROKEN_THREAD_REFERENCE: "setup_payoff",
    PAYOFF_BEFORE_SETUP: "setup_payoff",
    PAYOFF_WITHOUT_SETUP: "setup_payoff",
    ABANDONED_MAJOR_THREAD: "setup_payoff",
    UNJUSTIFIED_CARRY_FORWARD: "setup_payoff",
    RESOLVED_THREAD_UNANSWERED_QUESTION: "setup_payoff",
    THREAD_DISAPPEARED: "narrative_integrity",
    ENTITY_STATUS_UNCLEAR: "character_state",
    FINALE_ABANDONED_MAJOR_THREAD: "climax_resolution",
    FINALE_NO_RESOLUTION: "climax_resolution",
    FINALE_UNJUSTIFIED_HOOK: "climax_resolution",
    FINALE_MINOR_OPEN_THREAD: "climax_resolution",
  };
  return map[code] ?? "narrative_integrity";
}

export function runNarrativeEngine(input: NarrativeEngineInput): {
  registry: NarrativeRegistry;
  findings: NarrativeValidationFinding[];
  richFindings: RichValidationFinding[];
  result: NarrativeValidationResult;
} {
  const canonicalRegistry = input.canonicalRegistry ?? buildRegistry({
    bible: input.bible,
    plan: input.plan,
    ledger: input.ledger,
    ledgerAsOfEpisode: input.ledgerAsOfEpisode,
    characterProfiles: input.characterProfiles,
  });

  const ctx: NarrativeRegistryContext = {
    canonicalRegistry,
    bible: input.bible,
    plan: input.plan,
    ledger: input.ledger,
    ledgerAsOfEpisode: input.ledgerAsOfEpisode,
    characterProfiles: input.characterProfiles,
  };

  const registry = buildNarrativeRegistry(ctx);
  const findings = validateSeasonNarrative(registry, {
    centralConflictOrMystery: input.plan.centralConflictOrMystery,
    intendedSeasonConclusion: input.plan.intendedSeasonConclusion,
    unresolvedQuestions: input.plan.unresolvedQuestions,
  });

  const summary = summarizeFindings(findings);
  const richFindings = convertToRichFindings(findings);

  const result: NarrativeValidationResult = {
    valid: summary.errors === 0,
    complete: true,
    registry,
    findings,
    summary,
  };

  return { registry, findings, richFindings, result };
}