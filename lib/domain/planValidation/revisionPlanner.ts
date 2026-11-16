import type { FindingDomain, FindingClassification } from "@/lib/validation/seasonPlanValidation";
import type { FindingDiagnosis } from "@/lib/domain/planValidation/findingDiagnoser";
import {
  DOMAIN_PRIORITY,
  AUTO_APPLICABLE_ACTIONS,
  DEFAULT_MAX_ROUNDS,
  type RevisionAction,
  type RevisionActionType,
  type RevisionPlan,
  type RevisionActionTarget,
  type SafetyConstraint,
  type SkippedDiagnosis,
} from "@/lib/validation/revisionPlan";

/**
 * Revision Planner — consumes FindingDiagnosis[] from Milestone 1 and produces
 * a prioritized, bounded RevisionPlan with targeted correction actions.
 *
 * The planner:
 * 1. Filters out diagnoses that don't need revision (false positives, intentional)
 * 2. Determines the action type for each revisable diagnosis
 * 3. Assigns priority based on the domain priority order
 * 4. Attaches safety constraints to each action
 * 5. Determines which actions can be auto-applied vs need human approval
 * 6. Enforces the bounded loop (max rounds)
 *
 * The planner never calls an LLM and never modifies any artifacts.
 * It produces a structured plan that Milestone 3 will execute.
 */

// ---------------------------------------------------------------------------
// Safety constraint sets per action type
// ---------------------------------------------------------------------------

const SAFETY_BY_ACTION_TYPE: Record<RevisionActionType, SafetyConstraint[]> = {
  alias_resolution: [
    "smallest_possible_change",
    "no_canon_modification",
    "preserve_dialogue",
    "no_character_removal",
  ],
  canon_addition: [
    "no_history_invention",
    "no_premise_change",
  ],
  episode_revision: [
    "smallest_possible_change",
    "no_canon_modification",
    "preserve_dialogue",
    "preserve_scene_order",
    "preserve_motivations",
    "preserve_deliberate_mysteries",
    "no_full_rewrite",
  ],
  screenplay_revision: [
    "smallest_possible_change",
    "preserve_dialogue",
    "preserve_scene_order",
    "no_full_rewrite",
  ],
  setup_addition: [
    "smallest_possible_change",
    "preserve_scene_order",
    "no_canon_modification",
  ],
  payoff_addition: [
    "smallest_possible_change",
    "preserve_scene_order",
    "no_canon_modification",
  ],
  canon_correction: [
    "smallest_possible_change",
    "no_premise_change",
    "no_history_invention",
    "no_rule_weakening",
  ],
  preserve_intentional: [
    "preserve_deliberate_mysteries",
  ],
  investigate: [],
};

// ---------------------------------------------------------------------------
// Action type determination
// ---------------------------------------------------------------------------

function isLocationDiagnosis(diagnosis: FindingDiagnosis): boolean {
  if (diagnosis.domain === "location_continuity") return true;
  return diagnosis.rootCause.toLowerCase().startsWith("location ");
}

function determineActionType(
  diagnosis: FindingDiagnosis,
): RevisionActionType | null {
  const { classification, domain } = diagnosis;

  switch (classification) {
    case "validator_false_positive":
      return null;

    case "intentional_creative_decision":
      return "preserve_intentional";

    case "ambiguous_requires_investigation":
      return "investigate";

    case "missing_canon_information":
      if (isLocationDiagnosis(diagnosis)) return "canon_addition";
      if (domain === "character_identity_aliases") {
        if (diagnosis.recommendedCorrection?.includes("alias for")) {
          return "alias_resolution";
        }
        return "canon_addition";
      }
      return "episode_revision";

    case "genuine_continuity_error":
      if (domain === "character_identity_aliases") return "canon_correction";
      if (domain === "story_bible_inconsistencies") return "canon_correction";
      return "episode_revision";

    case "genuine_narrative_problem":
      if (domain === "narrative_progression") return "episode_revision";
      return "episode_revision";
  }
}

// ---------------------------------------------------------------------------
// Target extraction
// ---------------------------------------------------------------------------

function buildTarget(diagnosis: FindingDiagnosis): RevisionActionTarget {
  const target: RevisionActionTarget = {};

  if (diagnosis.affectedEpisodes.length > 0) {
    target.episodeNumber = diagnosis.affectedEpisodes[0];
  }

  const entity = diagnosis.sourceEvidence.ledgerCharacterStates.length > 0
    ? diagnosis.sourceEvidence.ledgerCharacterStates[0]?.split(":")[0]?.trim()
    : undefined;
  if (entity) target.entity = entity;

  if (diagnosis.recommendedCorrection) {
    target.proposedResolution = diagnosis.recommendedCorrection;
  }

  return target;
}

// ---------------------------------------------------------------------------
// Description and guidance generation
// ---------------------------------------------------------------------------

function buildDescription(diagnosis: FindingDiagnosis, actionType: RevisionActionType): string {
  const episodes = diagnosis.affectedEpisodes.length > 0
    ? ` (episodes: ${diagnosis.affectedEpisodes.join(", ")})`
    : "";

  switch (actionType) {
    case "alias_resolution":
      return `Resolve character alias in ${diagnosis.domain}${episodes}.`;
    case "canon_addition":
      return `Add missing canon information for ${diagnosis.domain}${episodes}.`;
    case "episode_revision":
      return `Revise episode content to fix ${diagnosis.domain}${episodes}.`;
    case "screenplay_revision":
      return `Revise screenplay to fix ${diagnosis.domain}${episodes}.`;
    case "setup_addition":
      return `Add missing setup for ${diagnosis.domain}${episodes}.`;
    case "payoff_addition":
      return `Add missing payoff for ${diagnosis.domain}${episodes}.`;
    case "canon_correction":
      return `Correct canon contradiction in ${diagnosis.domain}${episodes}.`;
    case "preserve_intentional":
      return `Preserve intentional creative decision in ${diagnosis.domain}${episodes}.`;
    case "investigate":
      return `Flag for human investigation: ${diagnosis.domain}${episodes}.`;
  }
}

function buildCorrectionGuidance(diagnosis: FindingDiagnosis, actionType: RevisionActionType): string {
  const parts: string[] = [];

  parts.push(`Root cause: ${diagnosis.rootCause}`);

  if (diagnosis.recommendedCorrection) {
    parts.push(`Recommended correction: ${diagnosis.recommendedCorrection}`);
  }

  if (diagnosis.potentialDownstreamEffects.length > 0) {
    parts.push(`Downstream effects to consider:`);
    for (const effect of diagnosis.potentialDownstreamEffects) {
      parts.push(`  - ${effect}`);
    }
  }

  switch (actionType) {
    case "alias_resolution":
      parts.push("Apply the alias mapping to internal references. Preserve the natural name in dialogue.");
      break;
    case "canon_addition":
      parts.push("Propose the new entity for addition to the Story Bible. Do not invent history or background beyond what is evidenced.");
      break;
    case "episode_revision":
      parts.push("Revise only the affected episode section. Make the smallest possible change that addresses the finding.");
      break;
    case "screenplay_revision":
      parts.push("Revise only the affected screenplay section. Do not rewrite the entire screenplay.");
      break;
    case "setup_addition":
      parts.push("Add setup to the most appropriate earlier episode. Do not change existing scene order.");
      break;
    case "payoff_addition":
      parts.push("Add payoff to the most appropriate subsequent episode. Do not change existing scene order.");
      break;
    case "canon_correction":
      parts.push("Correct the contradiction in the episode to align with established canon. Do not change the central premise.");
      break;
    case "preserve_intentional":
      parts.push("Record this as an intentional creative decision. No revision needed.");
      break;
    case "investigate":
      parts.push("This finding requires human investigation before any revision can be planned.");
      break;
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Human approval determination
// ---------------------------------------------------------------------------

function determineHumanApproval(
  diagnosis: FindingDiagnosis,
  actionType: RevisionActionType,
): boolean {
  if (diagnosis.requiresHumanApproval) return true;
  if (actionType === "canon_addition") return true;
  if (actionType === "investigate") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Action creation
// ---------------------------------------------------------------------------

let actionCounter = 0;

function makeActionId(): string {
  actionCounter += 1;
  return `act-${actionCounter.toString(36).padStart(4, "0")}`;
}

export function resetActionCounter(): void {
  actionCounter = 0;
}

function createAction(diagnosis: FindingDiagnosis, actionType: RevisionActionType): RevisionAction {
  const priority = DOMAIN_PRIORITY[diagnosis.domain];

  return {
    actionId: makeActionId(),
    groupId: diagnosis.groupId,
    findingIds: diagnosis.findingIds,
    type: actionType,
    domain: diagnosis.domain,
    classification: diagnosis.classification,
    priority,
    affectedEpisodes: diagnosis.affectedEpisodes,
    description: buildDescription(diagnosis, actionType),
    correctionGuidance: buildCorrectionGuidance(diagnosis, actionType),
    safetyConstraints: SAFETY_BY_ACTION_TYPE[actionType],
    requiresHumanApproval: determineHumanApproval(diagnosis, actionType),
    target: buildTarget(diagnosis),
  };
}

// ---------------------------------------------------------------------------
// Skip reason generation
// ---------------------------------------------------------------------------

function skipReason(classification: FindingClassification): string {
  switch (classification) {
    case "validator_false_positive":
      return "Finding is a validator false positive — the story material does not contain an actual defect.";
    case "intentional_creative_decision":
      return "Finding represents an intentional creative decision (mystery, cliffhanger). No revision needed.";
    case "ambiguous_requires_investigation":
      return "Finding is ambiguous and requires human investigation before revision can be planned.";
    default:
      return "Finding does not require revision.";
  }
}

// ---------------------------------------------------------------------------
// Main planner function
// ---------------------------------------------------------------------------

export interface PlanRevisionsInput {
  diagnoses: FindingDiagnosis[];
  round: number;
  maxRounds?: number;
}

export function planRevisions(input: PlanRevisionsInput): RevisionPlan {
  const { diagnoses, round } = input;
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;

  const actions: RevisionAction[] = [];
  const skipped: SkippedDiagnosis[] = [];

  for (const diagnosis of diagnoses) {
    const actionType = determineActionType(diagnosis);

    if (actionType === null) {
      skipped.push({
        groupId: diagnosis.groupId,
        classification: diagnosis.classification,
        reason: skipReason(diagnosis.classification),
      });
      continue;
    }

    if (actionType === "preserve_intentional") {
      actions.push(createAction(diagnosis, actionType));
      continue;
    }

    if (actionType === "investigate") {
      skipped.push({
        groupId: diagnosis.groupId,
        classification: diagnosis.classification,
        reason: skipReason(diagnosis.classification),
      });
      continue;
    }

    actions.push(createAction(diagnosis, actionType));
  }

  actions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const severityRank: Record<string, number> = { blocking: 4, high: 3, medium: 2, low: 1 };
    const aRank = severityRank[a.classification] ?? 0;
    const bRank = severityRank[b.classification] ?? 0;
    if (aRank !== bRank) return bRank - aRank;
    return a.actionId.localeCompare(b.actionId);
  });

  const requiresHumanApproval = actions.some((a) => a.requiresHumanApproval);
  const withinRoundLimit = round <= maxRounds;
  const canAutoApply = withinRoundLimit && actions.some(
    (a) => !a.requiresHumanApproval && AUTO_APPLICABLE_ACTIONS.has(a.type),
  );

  return {
    planId: `rev-plan-r${round}-${Date.now().toString(36)}`,
    round,
    maxRounds,
    actions,
    skipped,
    requiresHumanApproval,
    canAutoApply,
    totalActions: actions.length,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function getAutoApplicableActions(plan: RevisionPlan): RevisionAction[] {
  return plan.actions.filter(
    (a) => !a.requiresHumanApproval && AUTO_APPLICABLE_ACTIONS.has(a.type),
  );
}

export function getActionsRequiringApproval(plan: RevisionPlan): RevisionAction[] {
  return plan.actions.filter((a) => a.requiresHumanApproval);
}

export function getActionsByDomain(plan: RevisionPlan, domain: FindingDomain): RevisionAction[] {
  return plan.actions.filter((a) => a.domain === domain);
}

export function hasExceededMaxRounds(plan: RevisionPlan): boolean {
  return plan.round > plan.maxRounds;
}

export function shouldStopRevising(plan: RevisionPlan): boolean {
  if (hasExceededMaxRounds(plan)) return true;
  if (plan.actions.length === 0) return true;
  if (!plan.canAutoApply && !plan.requiresHumanApproval) return true;
  return false;
}