import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type {
  RichValidationFinding,
  FindingGroup,
  FindingClassification,
  FindingDomain,
} from "@/lib/validation/seasonPlanValidation";

import {
  classifyFinding,
  type ClassificationResult,
  type ClassificationContext,
} from "@/lib/domain/planValidation/findingClassifier";
import { groupFindings } from "@/lib/domain/planValidation/findingGrouper";
import {
  investigateFinding,
  type SourceEvidence,
  type InvestigationInput,
} from "@/lib/domain/planValidation/sourceInvestigator";

/**
 * Finding Diagnoser — the core of the intelligent revision system's
 * investigation stage. For each group of related findings, the diagnoser:
 *
 * 1. Classifies the finding (genuine error, false positive, etc.)
 * 2. Investigates the relevant source material
 * 3. Determines the root cause
 * 4. Decides whether revision is necessary
 * 5. Produces a recommended correction
 * 6. Identifies potential downstream effects
 *
 * The diagnoser never modifies anything. It produces a structured diagnosis
 * that the revision planner (Milestone 2) will consume.
 */

export interface FindingDiagnosis {
  groupId: string;
  findingIds: string[];
  classification: FindingClassification;
  domain: FindingDomain;
  severity: string;
  affectedEpisodes: number[];
  sourceEvidence: SourceEvidence;
  rootCause: string;
  revisionNecessary: boolean;
  recommendedCorrection: string | null;
  potentialDownstreamEffects: string[];
  requiresHumanApproval: boolean;
  classificationConfidence: number;
  classificationReason: string;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isLocationFinding(group: FindingGroup): boolean {
  if (group.domain === "location_continuity") return true;
  return group.findings.some((f) => {
    const msg = normalizeName(f.message);
    return msg.includes("location") && (msg.includes("not in the story bible") || msg.includes("not established"));
  });
}

function determineRootCause(
  group: FindingGroup,
  evidence: SourceEvidence,
  classification: FindingClassification,
): string {
  const messages = group.findings.map((f) => f.message).join("; ");

  if (classification === "validator_false_positive") {
    return `Validator false positive: ${messages}. The validator flagged this but the story material does not contain an actual defect.`;
  }

  if (classification === "intentional_creative_decision") {
    return `Intentional creative decision: ${messages}. The unresolved element appears to be a deliberate mystery or cliffhanger.`;
  }

  if (classification === "missing_canon_information") {
    if (isLocationFinding(group)) {
      const entity = group.sharedEntity ?? "unknown location";
      const knownLocs = evidence.locationRecords.join(", ");
      return `Location "${entity}" is referenced but not in the Story Bible. Known locations: ${knownLocs}. This may be a legitimate new location or a naming inconsistency.`;
    }
    if (group.domain === "character_identity_aliases") {
      const entity = group.sharedEntity ?? "unknown entity";
      const knownChars = evidence.characterRecords.join(", ");
      return `Entity "${entity}" is referenced in the episode but not established in the Story Bible. Known characters: ${knownChars}. This may be a missing alias mapping or a genuinely new character that needs to be added to canon.`;
    }
    return `Missing canon information: ${messages}. The Story Bible does not contain the referenced entity or fact.`;
  }

  if (classification === "ambiguous_requires_investigation") {
    if (group.domain === "character_identity_aliases") {
      return `Ambiguous character reference: ${messages}. The referenced name may be an alias for an existing canonical character. Source investigation needed to determine the correct mapping.`;
    }
    if (group.domain === "missing_setup" || group.domain === "missing_payoff") {
      const subsequentCount = evidence.subsequentEpisodePlans.length;
      return `Ambiguous setup/payoff: ${messages}. ${subsequentCount} subsequent episodes exist that may contain the payoff. Source investigation needed to search for semantically equivalent payoffs.`;
    }
    return `Ambiguous finding: ${messages}. Further investigation needed to determine the nature of the problem.`;
  }

  if (classification === "genuine_continuity_error") {
    return `Genuine continuity error: ${messages}. The episode material directly contradicts established canon or creates a structural impossibility.`;
  }

  return `Genuine narrative problem: ${messages}. The story structure has a progression, climax, or repetition issue that affects narrative quality.`;
}

function determineRevisionNecessary(
  classification: FindingClassification,
  group: FindingGroup,
): boolean {
  switch (classification) {
    case "genuine_continuity_error":
    case "genuine_narrative_problem":
      return true;
    case "missing_canon_information":
      return group.severity === "high" || group.severity === "blocking";
    case "ambiguous_requires_investigation":
      return false;
    case "validator_false_positive":
    case "intentional_creative_decision":
      return false;
  }
}

function recommendCorrection(
  group: FindingGroup,
  evidence: SourceEvidence,
  classification: FindingClassification,
): string | null {
  if (classification === "validator_false_positive") {
    return null;
  }

  if (classification === "intentional_creative_decision") {
    return `Preserve the unresolved element. Record its status as intentionally unresolved with the reason.`;
  }

  if (classification === "missing_canon_information" && isLocationFinding(group)) {
    const entity = group.sharedEntity ?? "unknown location";
    return `Determine whether "${entity}" is a legitimate new location. If so, register it in continuity records. If it contradicts established geography, revise the affected section.`;
  }

  if (classification === "missing_canon_information" && group.domain === "character_identity_aliases") {
    const entity = group.sharedEntity ?? "unknown";
    const knownChars = evidence.characterRecords;
    const possibleAlias = knownChars.find((c) => {
      const norm = normalizeName(c);
      const entNorm = normalizeName(entity);
      return norm.includes(entNorm) || entNorm.includes(norm.split(" ")[0] ?? "");
    });
    if (possibleAlias) {
      return `Resolve "${entity}" as an alias for canonical character "${possibleAlias}". Update internal references while preserving the natural name in dialogue.`;
    }
    return `Determine whether "${entity}" is an intentional new character. If so, propose adding it to the Story Bible canon. If not, correct the reference.`;
  }

  if (classification === "ambiguous_requires_investigation" && group.domain === "missing_setup") {
    return `Search all subsequent episodes for a semantically equivalent payoff before revising. If no payoff exists, add a meaningful one to the most appropriate subsequent episode.`;
  }

  if (classification === "genuine_continuity_error") {
    return group.findings[0]?.recommendation ?? `Revise the affected episode to resolve the continuity contradiction. Make the smallest possible change that addresses the specific finding.`;
  }

  if (classification === "genuine_narrative_problem") {
    return group.findings[0]?.recommendation ?? `Revise the affected episode to resolve the narrative structure problem. Preserve the central premise and character motivations.`;
  }

  return null;
}

function identifyDownstreamEffects(
  group: FindingGroup,
  evidence: SourceEvidence,
  classification: FindingClassification,
): string[] {
  const effects: string[] = [];

  if (!evidence.subsequentEpisodePlans.length) return effects;

  if (group.domain === "character_identity_aliases" && classification !== "validator_false_positive") {
    effects.push("Character identity correction may affect all subsequent episodes that reference this character.");
  }

  if (group.domain === "relationship_continuity") {
    effects.push("Relationship change correction may affect subsequent episodes that assume the current relationship state.");
  }

  if (group.domain === "timeline_chronology") {
    effects.push("Timeline correction may affect subsequent episodes that depend on the chronological order of events.");
  }

  if (group.domain === "character_knowledge_motivations") {
    effects.push("Knowledge state correction may affect subsequent episodes where the character acts on that knowledge.");
  }

  if (group.domain === "missing_setup" || group.domain === "missing_payoff") {
    effects.push("Setup/payoff addition may change the pacing or information reveal order in subsequent episodes.");
  }

  if (group.domain === "narrative_progression") {
    effects.push("Narrative progression correction may affect the buildup toward the season climax.");
  }

  return effects;
}

function determineHumanApprovalRequired(
  classification: FindingClassification,
  group: FindingGroup,
): boolean {
  if (group.findings.some((f) => f.requiresHumanReview)) return true;
  if (classification === "missing_canon_information" && group.domain === "character_identity_aliases") {
    return true;
  }
  if (classification === "intentional_creative_decision") return true;
  if (classification === "ambiguous_requires_investigation") return true;
  return false;
}

export interface DiagnoseInput {
  findings: RichValidationFinding[];
  plan: SeasonPlan;
  bible: StoryBibleContent | null;
  ledger: ContinuityLedger | null;
  isSeasonFinale: boolean;
}

export function diagnoseFindings(input: DiagnoseInput): FindingDiagnosis[] {
  const { findings, plan, bible, ledger, isSeasonFinale } = input;

  const groups = groupFindings(findings);


  const bibleCharacterNames = new Set<string>();
  if (bible) {
    for (const char of bible.characters.characters) {
      bibleCharacterNames.add(normalizeName(char.name));
    }
  }

  const knownAliases = new Set<string>();
  const maxEpisode = plan.episodeProgression.length;

  const classificationContext: Omit<ClassificationContext, "finding" | "domain"> = {
    hasSubsequentEpisodes: maxEpisode > 1,
    isSeasonFinale,
    knownAliases,
    bibleCharacterNames,
  };

  const diagnoses: FindingDiagnosis[] = [];

  for (const group of groups) {
    const primaryFinding = group.findings[0]!;
    const classificationResult = classifyFinding(primaryFinding, classificationContext);

    const evidence = investigateFinding({
      group,
      plan,
      bible,
      ledger,
    } as InvestigationInput);

    const rootCause = determineRootCause(group, evidence, classificationResult.classification);
    const revisionNecessary = determineRevisionNecessary(classificationResult.classification, group);
    const correction = recommendCorrection(group, evidence, classificationResult.classification);
    const downstreamEffects = identifyDownstreamEffects(group, evidence, classificationResult.classification);
    const requiresHumanApproval = determineHumanApprovalRequired(classificationResult.classification, group);

    diagnoses.push({
      groupId: group.groupId,
      findingIds: group.findingIds,
      classification: classificationResult.classification,
      domain: group.domain,
      severity: group.severity,
      affectedEpisodes: group.affectedEpisodes,
      sourceEvidence: evidence,
      rootCause,
      revisionNecessary,
      recommendedCorrection: correction,
      potentialDownstreamEffects: downstreamEffects,
      requiresHumanApproval,
      classificationConfidence: classificationResult.confidence,
      classificationReason: classificationResult.reason,
    });
  }

  return diagnoses;
}

export { groupFindings, classifyFinding, investigateFinding };
export type { ClassificationResult, SourceEvidence, FindingGroup };