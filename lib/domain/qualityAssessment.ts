import type {
  QualityAssessment,
  QualityDimension,
  ValidationFinding,
  CritiqueFinding,
} from "@/lib/validation/qualityAssessment";

const DIMENSION_MAX_SCORE = 100;

const ERROR_PENALTY = 25;
const WARNING_PENALTY = 8;
const INFO_PENALTY = 2;

const APPROVE_THRESHOLD = 75;
const REJECT_THRESHOLD = 30;

function clampScore(score: number): number {
  return Math.max(0, Math.min(DIMENSION_MAX_SCORE, Math.round(score)));
}

function scoreFromFindings(
  findings: Array<{ severity: "error" | "warning" | "info" }>,
): number {
  let penalty = 0;
  for (const finding of findings) {
    if (finding.severity === "error") penalty += ERROR_PENALTY;
    else if (finding.severity === "warning") penalty += WARNING_PENALTY;
    else penalty += INFO_PENALTY;
  }
  return clampScore(DIMENSION_MAX_SCORE - penalty);
}

function groupByCategory(
  findings: ValidationFinding[],
): Map<string, ValidationFinding[]> {
  const map = new Map<string, ValidationFinding[]>();
  for (const finding of findings) {
    const list = map.get(finding.category) ?? [];
    list.push(finding);
    map.set(finding.category, list);
  }
  return map;
}

export function computeQualityAssessment(
  validationFindings: ValidationFinding[],
  critiqueFindings: CritiqueFinding[] = [],
  options: { approveThreshold?: number; rejectThreshold?: number } = {},
): QualityAssessment {
  const approveThreshold = options.approveThreshold ?? APPROVE_THRESHOLD;
  const rejectThreshold = options.rejectThreshold ?? REJECT_THRESHOLD;

  const dimensions: QualityDimension[] = [];
  const blockingFindings: Array<{ dimension: string; message: string }> = [];

  const validationByCategory = groupByCategory(validationFindings);
  const knownCategories = new Set([
    "completeness",
    "canon",
    "continuity",
    "repetition",
    "structure",
  ]);

  for (const category of knownCategories) {
    const findings = validationByCategory.get(category) ?? [];
    const score = scoreFromFindings(findings);
    const dimension: QualityDimension = {
      name: category,
      score,
      maxScore: DIMENSION_MAX_SCORE,
      findings: findings.map((f) => ({
        severity: f.severity,
        message: f.message,
        category: f.category,
      })),
    };
    dimensions.push(dimension);
    for (const f of findings) {
      if (f.severity === "error") {
        blockingFindings.push({ dimension: category, message: f.message });
      }
    }
  }

  if (critiqueFindings.length > 0) {
    const score = scoreFromFindings(critiqueFindings);
    const dimension: QualityDimension = {
      name: "semantic",
      score,
      maxScore: DIMENSION_MAX_SCORE,
      findings: critiqueFindings.map((f) => ({
        severity: f.severity,
        message: f.message,
        category: f.category ?? "semantic",
      })),
    };
    dimensions.push(dimension);
    for (const f of critiqueFindings) {
      if (f.severity === "error") {
        blockingFindings.push({ dimension: "semantic", message: f.message });
      }
    }
  }

  const weights: Record<string, number> = {
    completeness: 2.0,
    canon: 2.0,
    continuity: 1.5,
    structure: 1.5,
    repetition: 1.0,
    semantic: 1.0,
  };
  let totalWeight = 0;
  let weightedSum = 0;
  for (const dim of dimensions) {
    const weight = weights[dim.name] ?? 1.0;
    totalWeight += weight;
    weightedSum += dim.score * weight;
  }
  const overallScore = totalWeight > 0 ? clampScore(weightedSum / totalWeight) : 0;

  let recommendation: "approve" | "revise" | "reject";
  if (overallScore >= approveThreshold && blockingFindings.length === 0) {
    recommendation = "approve";
  } else if (overallScore < rejectThreshold || blockingFindings.length > 3) {
    recommendation = "reject";
  } else {
    recommendation = "revise";
  }

  const summaryParts: string[] = [];
  summaryParts.push(`Overall quality score: ${overallScore}/100.`);
  if (blockingFindings.length > 0) {
    summaryParts.push(`${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? "" : "s"}.`);
  }
  const weakDimensions = dimensions.filter((d) => d.score < approveThreshold);
  if (weakDimensions.length > 0) {
    summaryParts.push(`Areas needing attention: ${weakDimensions.map((d) => d.name).join(", ")}.`);
  }
  if (recommendation === "approve") {
    summaryParts.push("Recommended for approval.");
  } else if (recommendation === "revise") {
    summaryParts.push("Recommended for revision before approval.");
  } else {
    summaryParts.push("Recommended for rejection — significant issues found.");
  }

  return {
    overallScore,
    dimensions,
    blockingFindings,
    recommendation,
    summary: summaryParts.join(" "),
    assessedAt: new Date().toISOString(),
  };
}

export function shouldBlockApproval(
  assessment: QualityAssessment,
  threshold: number = APPROVE_THRESHOLD,
): boolean {
  if (assessment.recommendation === "reject") return true;
  if (assessment.overallScore < threshold) return true;
  if (assessment.blockingFindings.length > 0) return true;
  return false;
}