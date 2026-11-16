import { z } from "zod";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const VALIDATION_SEVERITIES = [
  "blocking",
  "high",
  "medium",
  "low",
] as const;
export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];

export const VALIDATION_CATEGORIES = [
  "structural",
  "reference_integrity",
  "relationship_integrity",
  "episode_indexing",
  "canon_contradiction",
  "unknown_entity_reference",
  "world_rule_violation",
  "character_history_contradiction",
  "unexplained_status_change",
  "temporal_continuity",
  "cyclic_dependency",
  "character_state",
  "knowledge_chronology",
  "episode_progression",
  "narrative_progression",
  "conflict_escalation",
  "episode_differentiation",
  "setup_payoff",
  "climax_resolution",
  "premature_climax",
  "narrative_integrity",
  "continuity",
  "progression",
  "repetition",
  "character_development",
  "narrative_structure",
] as const;
export type ValidationCategory = (typeof VALIDATION_CATEGORIES)[number];

export const CANON_ISSUE_TYPES = [
  "CANON_CONTRADICTION",
  "UNKNOWN_ENTITY_REFERENCE",
  "RELATIONSHIP_CONTRADICTION",
  "WORLD_RULE_VIOLATION",
  "CHARACTER_HISTORY_CONTRADICTION",
  "UNEXPLAINED_STATUS_CHANGE",
  "UNAUTHORIZED_CANON_MODIFICATION",
] as const;
export type CanonIssueType = (typeof CANON_ISSUE_TYPES)[number];

export const richValidationFindingSchema = z.object({
  findingId: text(1, 80),
  category: z.enum(VALIDATION_CATEGORIES),
  severity: z.enum(VALIDATION_SEVERITIES),
  episodeNumber: z.number().int().positive().max(100).optional(),
  affectedField: z.string().trim().max(200).optional(),
  affectedEvent: z.string().trim().max(200).optional(),
  message: text(1, 600),
  explanation: z.string().trim().max(1000).optional(),
  evidence: z.array(z.string().trim().max(500)).max(6).optional(),
  whyItMatters: z.string().trim().max(500).optional(),
  recommendation: z.string().trim().max(600).optional(),
  requiresHumanReview: z.boolean().default(false),
  source: z.enum(["deterministic", "ai_reasoning"]).default("deterministic"),
  canonIssueType: z.enum(CANON_ISSUE_TYPES).optional(),
});
export type RichValidationFinding = z.infer<typeof richValidationFindingSchema>;

export const repairAttemptSchema = z.object({
  attempt: z.number().int().min(1).max(5),
  findingId: text(1, 80),
  episodeNumber: z.number().int().positive().max(100).optional(),
  provider: z.string().max(80).default(""),
  model: z.string().max(120).default(""),
  status: z.enum(["success", "failed", "skipped"]).default("failed"),
  message: text(1, 500),
  repairedAt: text(1, 40),
});
export type RepairAttempt = z.infer<typeof repairAttemptSchema>;

export const aiReasoningMetadataSchema = z.object({
  available: z.boolean(),
  provider: z.string().max(80).default(""),
  model: z.string().max(120).default(""),
  fallbackFrom: z.string().max(80).nullable().default(null),
  findingCount: z.number().int().min(0).default(0),
  error: z.string().max(300).optional(),
  latencyMs: z.number().int().min(0).optional(),
});
export type AIReasoningMetadata = z.infer<typeof aiReasoningMetadataSchema>;

export const seasonPlanValidationResultSchema = z.object({
  passed: z.boolean(),
  overallSeverity: z.enum(VALIDATION_SEVERITIES).default("low"),
  findings: z.array(richValidationFindingSchema),
  deterministicFindingCount: z.number().int().min(0).default(0),
  aiFindingCount: z.number().int().min(0).default(0),
  aiReasoning: aiReasoningMetadataSchema.optional(),
  repairHistory: z.array(repairAttemptSchema).max(10).default([]),
  validatorVersion: text(1, 20).default("2.0"),
  validatedAt: text(1, 40),
  bibleVersion: z.number().int().min(0).optional(),
  planVersion: z.number().int().min(1).optional(),
});
export type SeasonPlanValidationResult = z.infer<typeof seasonPlanValidationResultSchema>;

// ---------------------------------------------------------------------------
// Finding classification — used by the intelligent revision system to
// distinguish genuine story defects from false positives, missing canon,
// intentional creative decisions, and ambiguous findings.
// ---------------------------------------------------------------------------

export const FINDING_CLASSIFICATIONS = [
  "genuine_continuity_error",
  "genuine_narrative_problem",
  "validator_false_positive",
  "missing_canon_information",
  "intentional_creative_decision",
  "ambiguous_requires_investigation",
] as const;
export type FindingClassification = (typeof FINDING_CLASSIFICATIONS)[number];

// ---------------------------------------------------------------------------
// Finding domains — the 13 high-level categories the revision system groups
// findings into. These are broader than the 25 granular ValidationCategory
// values and map the existing validators to the revision system's vocabulary.
// ---------------------------------------------------------------------------

export const FINDING_DOMAINS = [
  "character_continuity",
  "character_identity_aliases",
  "relationship_continuity",
  "location_continuity",
  "timeline_chronology",
  "character_knowledge_motivations",
  "narrative_progression",
  "repeated_narrative_functions",
  "missing_setup",
  "missing_payoff",
  "unresolved_plot_threads",
  "episode_contradictions",
  "story_bible_inconsistencies",
] as const;
export type FindingDomain = (typeof FINDING_DOMAINS)[number];

export function toFindingDomain(category: ValidationCategory): FindingDomain {
  const map: Record<ValidationCategory, FindingDomain> = {
    structural: "story_bible_inconsistencies",
    reference_integrity: "character_identity_aliases",
    relationship_integrity: "relationship_continuity",
    episode_indexing: "episode_contradictions",
    canon_contradiction: "story_bible_inconsistencies",
    unknown_entity_reference: "character_identity_aliases",
    world_rule_violation: "story_bible_inconsistencies",
    character_history_contradiction: "character_continuity",
    unexplained_status_change: "character_continuity",
    temporal_continuity: "timeline_chronology",
    cyclic_dependency: "timeline_chronology",
    character_state: "character_knowledge_motivations",
    knowledge_chronology: "character_knowledge_motivations",
    episode_progression: "narrative_progression",
    narrative_progression: "narrative_progression",
    conflict_escalation: "narrative_progression",
    episode_differentiation: "repeated_narrative_functions",
    setup_payoff: "missing_setup",
    climax_resolution: "narrative_progression",
    premature_climax: "narrative_progression",
    narrative_integrity: "unresolved_plot_threads",
    continuity: "character_continuity",
    progression: "narrative_progression",
    repetition: "repeated_narrative_functions",
    character_development: "character_knowledge_motivations",
    narrative_structure: "narrative_progression",
  };
  return map[category];
}

// ---------------------------------------------------------------------------
// Finding group — related findings that share the same underlying problem.
// The revision system treats a group as one unit to avoid redundant fixes.
// ---------------------------------------------------------------------------

export interface FindingGroup {
  groupId: string;
  findingIds: string[];
  domain: FindingDomain;
  category: ValidationCategory;
  severity: ValidationSeverity;
  affectedEpisodes: number[];
  sharedEntity: string | null;
  findings: RichValidationFinding[];
}

export const VALIDATOR_VERSION = "2.0";

export function severityRank(s: ValidationSeverity): number {
  return { blocking: 4, high: 3, medium: 2, low: 1 }[s];
}

export function highestSeverity(findings: RichValidationFinding[]): ValidationSeverity {
  if (findings.length === 0) return "low";
  return findings.reduce((max, f) =>
    severityRank(f.severity) > severityRank(max) ? f.severity : max
  , "low" as ValidationSeverity);
}

export function passesValidation(findings: RichValidationFinding[]): boolean {
  return !findings.some((f) => f.severity === "blocking");
}

export function toLegacySeverity(s: ValidationSeverity): "error" | "warning" {
  return s === "blocking" ? "error" : "warning";
}

export function toLegacyCategory(c: ValidationCategory): string {
  const map: Record<ValidationCategory, string> = {
    structural: "continuity",
    reference_integrity: "continuity",
    relationship_integrity: "continuity",
    episode_indexing: "continuity",
    canon_contradiction: "continuity",
    unknown_entity_reference: "continuity",
    world_rule_violation: "continuity",
    character_history_contradiction: "continuity",
    unexplained_status_change: "continuity",
    temporal_continuity: "continuity",
    cyclic_dependency: "continuity",
    character_state: "character_development",
    knowledge_chronology: "continuity",
    episode_progression: "progression",
    narrative_progression: "progression",
    conflict_escalation: "progression",
    episode_differentiation: "repetition",
    setup_payoff: "narrative_structure",
    climax_resolution: "narrative_structure",
    premature_climax: "narrative_structure",
    narrative_integrity: "narrative_structure",
    continuity: "continuity",
    progression: "progression",
    repetition: "repetition",
    character_development: "character_development",
    narrative_structure: "narrative_structure",
  };
  return map[c];
}

let findingCounter = 0;
export function makeFindingId(prefix: string): string {
  findingCounter += 1;
  return `${prefix}-${findingCounter.toString(36).padStart(4, "0")}`;
}
export function resetFindingIdCounter(): void {
  findingCounter = 0;
}