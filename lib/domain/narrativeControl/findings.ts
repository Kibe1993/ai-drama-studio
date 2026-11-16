import { createHash } from "node:crypto";
import type { FindingSeverity } from "@/lib/validation/narrativeControl";

export interface NarrativeFinding {
  id: string;
  algorithm: string;
  severity: FindingSeverity;
  category: string;
  entityId: string | null;
  artifactId: string | null;
  episode: number | null;
  sceneNumber: number | null;
  evidence: string;
  expected: string;
  actual: string;
  explanation: string;
  suggestedCorrection: string;
  automaticRepairSafe: boolean;
  signature: string;
  requiresCanonAuthorization: boolean;
}

export interface ValidationTrace {
  algorithm: string;
  durationMs: number;
  findingCount: number;
  revisionRound: number;
  sourceVersion: number;
  provider: string;
}

type FindingInput = {
  algorithm: string;
  severity: FindingSeverity;
  category: string;
  entityId?: string | null;
  artifactId?: string | null;
  episode?: number | null;
  sceneNumber?: number | null;
  evidence?: string;
  expected?: string;
  actual?: string;
  explanation: string;
  suggestedCorrection?: string;
  automaticRepairSafe?: boolean;
  requiresCanonAuthorization?: boolean;
};

export function makeFinding(input: FindingInput): NarrativeFinding {
  const signature = [
    input.algorithm,
    input.category,
    input.entityId ?? "",
    input.expected ?? "",
  ].join(":");
  const id = createHash("sha256")
    .update([signature, input.evidence ?? "", String(input.episode ?? ""), input.actual ?? ""].join("|"))
    .digest("hex")
    .slice(0, 16);
  return {
    id,
    algorithm: input.algorithm,
    severity: input.severity,
    category: input.category,
    entityId: input.entityId ?? null,
    artifactId: input.artifactId ?? null,
    episode: input.episode ?? null,
    sceneNumber: input.sceneNumber ?? null,
    evidence: input.evidence ?? "",
    expected: input.expected ?? "",
    actual: input.actual ?? "",
    explanation: input.explanation,
    suggestedCorrection: input.suggestedCorrection ?? "",
    automaticRepairSafe: input.automaticRepairSafe ?? false,
    signature,
    requiresCanonAuthorization: input.requiresCanonAuthorization ?? false,
  };
}

export function timedFindings(
  traces: ValidationTrace[],
  trace: Omit<ValidationTrace, "durationMs" | "findingCount">,
  run: () => NarrativeFinding[],
): NarrativeFinding[] {
  const started = Date.now();
  const findings = run();
  traces.push({
    ...trace,
    durationMs: Date.now() - started,
    findingCount: findings.length,
  });
  return findings;
}

export function upgradeRegressions(
  resolvedSignatures: readonly string[],
  findings: NarrativeFinding[],
): NarrativeFinding[] {
  const resolved = new Set(resolvedSignatures);
  return findings.map((finding) => {
    if (!resolved.has(finding.signature) || finding.severity === "ERROR") return finding;
    return {
      ...finding,
      severity: "ERROR",
      category: "regression",
      explanation: `A previously corrected contradiction returned: ${finding.explanation}`,
      automaticRepairSafe: false,
    };
  });
}

export function dedupeFindings(findings: NarrativeFinding[]): NarrativeFinding[] {
  const seen = new Set<string>();
  const unique: NarrativeFinding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.id)) continue;
    seen.add(finding.id);
    unique.push(finding);
  }
  return unique;
}
