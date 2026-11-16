import type {
  RichValidationFinding,
  FindingClassification,
  FindingDomain,
} from "@/lib/validation/seasonPlanValidation";
import { toFindingDomain } from "@/lib/validation/seasonPlanValidation";

/**
 * Finding Classifier — determines the nature of a validation finding.
 *
 * Not every warning is a story defect. The classifier distinguishes:
 * - Genuine continuity errors (the story contradicts itself or canon)
 * - Genuine narrative problems (structural issues in the story)
 * - Validator false positives (the validator is wrong, not the story)
 * - Missing canon information (the Story Bible lacks needed data)
 * - Intentional creative decisions (deliberate mysteries, cliffhangers)
 * - Ambiguous findings requiring further investigation
 *
 * The classifier uses heuristics based on the finding's category, severity,
 * canonIssueType, message content, and whether it requires human review.
 * It does NOT call an LLM — it is a fast deterministic first pass.
 */

export interface ClassificationContext {
  finding: RichValidationFinding;
  domain: FindingDomain;
  hasSubsequentEpisodes: boolean;
  isSeasonFinale: boolean;
  knownAliases: Set<string>;
  bibleCharacterNames: Set<string>;
}

export interface ClassificationResult {
  findingId: string;
  classification: FindingClassification;
  confidence: number;
  reason: string;
}

const FALSE_POSITIVE_INDICATORS = [
  "not referenced in episode",
  "is not referenced",

];

const INTENTIONAL_INDICATORS = [
  "cliffhanger",
  "deliberately unresolved",
  "intentionally",
  "season finale",
  "season-ending",
  "reserved for",
  "future season",
  "to be resolved",
  "mystery",
  "unresolved question",
  "unresolved thread",
];

const MISSING_CANON_INDICATORS = [
  "not in the story bible",
  "not established in the story bible",
  "not found in canon",
  "missing from",
  "not defined in",
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function containsAny(text: string, indicators: string[]): boolean {
  const lower = normalizeText(text);
  return indicators.some((indicator) => lower.includes(indicator));
}

function isAliasIssue(
  finding: RichValidationFinding,
  context: ClassificationContext,
): boolean {
  if (context.domain !== "character_identity_aliases") return false;
  const message = normalizeText(finding.message);
  return (
    message.includes("who is not in the story bible") ||
    message.includes("unknown character") ||
    message.includes("references character")
  );
}

function isMissingPayoffInLaterEpisodes(
  finding: RichValidationFinding,
  context: ClassificationContext,
): boolean {
  if (context.domain !== "missing_setup" && context.domain !== "missing_payoff") {
    return false;
  }
  return (
    containsAny(finding.message, ["no payoff", "no resolution", "has no payoff"]) &&
    context.hasSubsequentEpisodes
  );
}

function isIntentionalUnresolved(
  finding: RichValidationFinding,
  context: ClassificationContext,
): boolean {
  if (context.domain !== "unresolved_plot_threads") return false;
  if (containsAny(finding.message, INTENTIONAL_INDICATORS)) return true;
  if (context.isSeasonFinale && finding.severity === "medium") return true;
  return false;
}

function isValidatorFalsePositive(
  finding: RichValidationFinding,
  _context: ClassificationContext,
): boolean {
  if (finding.source === "ai_reasoning" && finding.severity === "low") return true;
  if (containsAny(finding.message, FALSE_POSITIVE_INDICATORS)) {
    if (finding.severity === "low" || finding.severity === "medium") return true;
  }
  return false;
}

function isMissingCanon(
  finding: RichValidationFinding,
  context: ClassificationContext,
): boolean {
  if (!containsAny(finding.message, MISSING_CANON_INDICATORS)) return false;
  if (context.domain === "location_continuity") return true;
  if (isAliasIssue(finding, context) && context.knownAliases.size > 0) return false;
  return true;
}

function isGenuineContinuityError(
  finding: RichValidationFinding,
  context: ClassificationContext,
): boolean {
  if (finding.severity === "blocking") return true;
  if (finding.canonIssueType === "CANON_CONTRADICTION") return true;
  if (finding.canonIssueType === "RELATIONSHIP_CONTRADICTION") return true;
  if (finding.canonIssueType === "WORLD_RULE_VIOLATION") return true;
  if (finding.canonIssueType === "CHARACTER_HISTORY_CONTRADICTION") return true;
  if (finding.canonIssueType === "UNEXPLAINED_STATUS_CHANGE") return true;
  if (context.domain === "episode_contradictions" && finding.severity === "high") return true;
  if (context.domain === "timeline_chronology" && finding.severity === "high") return true;
  return false;
}

function isGenuineNarrativeProblem(
  finding: RichValidationFinding,
  context: ClassificationContext,
): boolean {
  if (context.domain === "narrative_progression" && finding.severity === "high") return true;
  if (context.domain === "repeated_narrative_functions" && finding.severity === "high") return true;
  if (finding.category === "premature_climax" && finding.severity === "high") return true;
  if (finding.category === "climax_resolution" && finding.severity === "high") return true;
  return false;
}

export function classifyFinding(
  finding: RichValidationFinding,
  context: Omit<ClassificationContext, "finding" | "domain">,
): ClassificationResult {
  const domain = toFindingDomain(finding.category);
  const fullContext: ClassificationContext = { ...context, finding, domain };

  if (isValidatorFalsePositive(finding, fullContext)) {
    return {
      findingId: finding.findingId,
      classification: "validator_false_positive",
      confidence: 0.7,
      reason: "Finding message matches false-positive indicators or is a low-severity AI finding.",
    };
  }

  if (isIntentionalUnresolved(finding, fullContext)) {
    return {
      findingId: finding.findingId,
      classification: "intentional_creative_decision",
      confidence: 0.8,
      reason: "Finding describes a deliberate mystery, cliffhanger, or unresolved thread.",
    };
  }

  if (isMissingCanon(finding, fullContext)) {
    return {
      findingId: finding.findingId,
      classification: "missing_canon_information",
      confidence: 0.75,
      reason: "Finding references an entity not established in the Story Bible — likely a canon gap, not a story error.",
    };
  }

  if (isAliasIssue(finding, fullContext) && fullContext.knownAliases.size > 0) {
    return {
      findingId: finding.findingId,
      classification: "ambiguous_requires_investigation",
      confidence: 0.6,
      reason: "Character reference may be an alias for an existing canonical character. Requires source investigation.",
    };
  }

  if (isMissingPayoffInLaterEpisodes(finding, fullContext)) {
    return {
      findingId: finding.findingId,
      classification: "ambiguous_requires_investigation",
      confidence: 0.65,
      reason: "Setup/foreshadowing may have a payoff in a subsequent episode not yet inspected. Requires source investigation.",
    };
  }

  if (isGenuineContinuityError(finding, fullContext)) {
    return {
      findingId: finding.findingId,
      classification: "genuine_continuity_error",
      confidence: 0.85,
      reason: "Finding represents a direct contradiction with established canon or a blocking structural issue.",
    };
  }

  if (isGenuineNarrativeProblem(finding, fullContext)) {
    return {
      findingId: finding.findingId,
      classification: "genuine_narrative_problem",
      confidence: 0.8,
      reason: "Finding represents a structural narrative problem (progression, climax, or repetition).",
    };
  }

  return {
    findingId: finding.findingId,
    classification: "ambiguous_requires_investigation",
    confidence: 0.5,
    reason: "Finding does not match any specific classification heuristic. Defaulting to ambiguous for investigation.",
  };
}

export function classifyFindings(
  findings: RichValidationFinding[],
  context: Omit<ClassificationContext, "finding" | "domain">,
): ClassificationResult[] {
  return findings.map((finding) => classifyFinding(finding, context));
}