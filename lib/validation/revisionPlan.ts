import type { FindingDomain, FindingClassification } from "@/lib/validation/seasonPlanValidation";

// ---------------------------------------------------------------------------
// Revision action types — the kinds of corrections the revision system can make
// ---------------------------------------------------------------------------

export const REVISION_ACTION_TYPES = [
  "alias_resolution",
  "canon_addition",
  "episode_revision",
  "screenplay_revision",
  "setup_addition",
  "payoff_addition",
  "canon_correction",
  "preserve_intentional",
  "investigate",
] as const;
export type RevisionActionType = (typeof REVISION_ACTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Safety constraints — enforce the revision safety rules from the specification
// ---------------------------------------------------------------------------

export const SAFETY_CONSTRAINTS = [
  "preserve_dialogue",
  "preserve_scene_order",
  "preserve_motivations",
  "preserve_deliberate_mysteries",
  "smallest_possible_change",
  "no_canon_modification",
  "no_premise_change",
  "no_full_rewrite",
  "no_history_invention",
  "no_character_removal",
  "no_rule_weakening",
] as const;
export type SafetyConstraint = (typeof SAFETY_CONSTRAINTS)[number];

// ---------------------------------------------------------------------------
// Revision action — a single targeted correction
// ---------------------------------------------------------------------------

export interface RevisionActionTarget {
  episodeNumber?: number;
  field?: string;
  entity?: string;
  proposedResolution?: string;
}

export interface RevisionAction {
  actionId: string;
  groupId: string;
  findingIds: string[];
  type: RevisionActionType;
  domain: FindingDomain;
  classification: FindingClassification;
  priority: number;
  affectedEpisodes: number[];
  description: string;
  correctionGuidance: string;
  safetyConstraints: SafetyConstraint[];
  requiresHumanApproval: boolean;
  target: RevisionActionTarget;
}

// ---------------------------------------------------------------------------
// Skipped diagnosis — a diagnosis that does not produce a revision action
// ---------------------------------------------------------------------------

export interface SkippedDiagnosis {
  groupId: string;
  classification: FindingClassification;
  reason: string;
}

// ---------------------------------------------------------------------------
// Revision plan — the output of the revision planner
// ---------------------------------------------------------------------------

export interface RevisionPlan {
  planId: string;
  round: number;
  maxRounds: number;
  actions: RevisionAction[];
  skipped: SkippedDiagnosis[];
  requiresHumanApproval: boolean;
  canAutoApply: boolean;
  totalActions: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Domain priority — lower number = higher priority
// Based on the spec: identity → hard continuity → relationships/chronology →
// narrative progression → setup/payoff → unresolved threads → repetition → minor
// ---------------------------------------------------------------------------

export const DOMAIN_PRIORITY: Record<FindingDomain, number> = {
  character_identity_aliases: 1,
  character_continuity: 2,
  story_bible_inconsistencies: 2,
  relationship_continuity: 3,
  timeline_chronology: 3,
  narrative_progression: 4,
  missing_setup: 5,
  missing_payoff: 5,
  unresolved_plot_threads: 6,
  repeated_narrative_functions: 7,
  character_knowledge_motivations: 8,
  location_continuity: 8,
  episode_contradictions: 8,
};

// ---------------------------------------------------------------------------
// Action types that can be automatically applied without human approval
// ---------------------------------------------------------------------------

export const AUTO_APPLICABLE_ACTIONS: ReadonlySet<RevisionActionType> = new Set([
  "alias_resolution",
  "episode_revision",
  "setup_addition",
  "payoff_addition",
  "canon_correction",
]);

// ---------------------------------------------------------------------------
// Default revision loop bounds
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ROUNDS = 3;