import type {
  CanonAuthorization,
  CanonState,
  NarrativeRevisionResponse,
  ValidationLayer,
} from "@/lib/validation/narrativeControl";
import { emptyAuthorization, narrativeRevisionResponseSchema } from "@/lib/validation/narrativeControl";
import { causalFindings } from "@/lib/domain/narrativeControl/causal";
import { dedupeFindings, timedFindings, upgradeRegressions, type NarrativeFinding, type ValidationTrace } from "@/lib/domain/narrativeControl/findings";
import { identityFindings, resolveIdentity } from "@/lib/domain/narrativeControl/identity";
import { validateKnowledge } from "@/lib/domain/narrativeControl/implication";
import { validateObjects } from "@/lib/domain/narrativeControl/objects";
import { analyzeRevision, applyAcceptedChanges, type RevisionImpact } from "@/lib/domain/narrativeControl/revision";
import { sceneLooksLikeFlashback, validateEntityUse } from "@/lib/domain/narrativeControl/temporal";
import { validateFinale, validateThreads } from "@/lib/domain/narrativeControl/threads";
import { validateWorldRules } from "@/lib/domain/narrativeControl/worldRules";

export interface SceneAppearance {
  sceneNumber: number;
  charactersPresent: string[];
  location: string;
  text: string;
}

export interface SemanticAnalyzer {
  (input: { canon: CanonState; episode: number; text: string }): NarrativeFinding[];
}

export interface ControlDecision {
  decision: "approve" | "reject" | "needs_authorization";
  canonVersion: number;
  layers: ValidationLayer[];
  findings: NarrativeFinding[];
  impact: RevisionImpact;
  traces: ValidationTrace[];
  retryable: false;
  provider: string;
  nextCanon: CanonState | null;
}

export function parseRevisionResponse(input: unknown):
  | { ok: true; data: NarrativeRevisionResponse }
  | { ok: false; errors: { path: string; message: string }[] } {
  const parsed = narrativeRevisionResponseSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function failureIsRetryable(kind: "provider" | "validation"): boolean {
  return kind === "provider";
}

export function evaluateProposal(input: {
  canon: CanonState;
  response: NarrativeRevisionResponse;
  episode: number;
  provider?: string;
  revisionRound?: number;
  authorization?: CanonAuthorization;
  scenes?: SceneAppearance[];
  finaleEpisode?: number | null;
  semanticAnalyzer?: SemanticAnalyzer;
}): ControlDecision {
  const provider = input.provider ?? "application";
  const round = input.revisionRound ?? 0;
  const authorization = input.authorization ?? emptyAuthorization();
  const traces: ValidationTrace[] = [];
  const layers = new Set<ValidationLayer>();
  const findings: NarrativeFinding[] = [];

  layers.add("structural");
  findings.push(...timedFindings(traces, trace("structural", input.canon.version, round, provider), () => {
    const structural: NarrativeFinding[] = [];
    if (input.response.projectId !== input.canon.projectId) {
      structural.push(structuralFinding("The response names a different project.", input.response.projectId));
    }
    if (input.response.narrativeVersion !== input.canon.version) {
      structural.push(structuralFinding(
        `The response was built for canon version ${input.response.narrativeVersion}, but the current version is ${input.canon.version}.`,
        String(input.response.narrativeVersion),
      ));
    }
    return structural;
  }));

  const text = input.response.proposedContent;
  layers.add("deterministic");
  findings.push(...timedFindings(traces, trace("identity", input.canon.version, round, provider), () => {
    const resolutions = input.response.newEntities.map((entity) => resolveIdentity(entity.name, input.canon.entities));
    return identityFindings(resolutions, input.episode);
  }));
  findings.push(...timedFindings(traces, trace("knowledge", input.canon.version, round, provider), () =>
    validateKnowledge(input.canon, input.episode, text),
  ));
  findings.push(...timedFindings(traces, trace("world_rules", input.canon.version, round, provider), () =>
    validateWorldRules(input.canon, input.episode, text),
  ));
  findings.push(...timedFindings(traces, trace("objects", input.canon.version, round, provider), () =>
    validateObjects(input.canon, input.episode, text),
  ));
  if (input.scenes) {
    findings.push(...timedFindings(traces, trace("temporal", input.canon.version, round, provider), () =>
      validateScenes(input.canon, input.episode, input.scenes ?? []),
    ));
  }

  const impact = analyzeRevision(input.canon, input.response.proposedChanges, authorization);
  traces.push({
    algorithm: "revision",
    durationMs: 0,
    findingCount: impact.findings.length,
    revisionRound: round,
    sourceVersion: input.canon.version,
    provider,
  });
  findings.push(...impact.findings);

  const touchesGraph = input.response.proposedChanges.some((change) =>
    change.targetKind === "event" || change.targetKind === "thread",
  );
  if (touchesGraph) {
    findings.push(...timedFindings(traces, trace("causal", input.canon.version, round, provider), () => causalFindings(input.canon)));
    findings.push(...timedFindings(traces, trace("threads", input.canon.version, round, provider), () => validateThreads(input.canon)));
  }
  if (input.finaleEpisode) {
    findings.push(...timedFindings(traces, trace("finale", input.canon.version, round, provider), () =>
      validateFinale(input.canon, input.finaleEpisode ?? input.episode),
    ));
  }

  if (input.semanticAnalyzer) {
    layers.add("semantic");
    const semantic = timedFindings(traces, trace("semantic", input.canon.version, round, provider), () =>
      input.semanticAnalyzer?.({ canon: input.canon, episode: input.episode, text }) ?? [],
    ).map((finding) => finding.severity === "ERROR"
      ? {
          ...finding,
          explanation: `Semantic review blocked this proposal and does not change canon. ${finding.explanation}`,
        }
      : finding);
    findings.push(...semantic);
  }

  layers.add("regression");
  const regressed = upgradeRegressions(input.canon.resolvedFindingSignatures, dedupeFindings(findings));
  const blocking = regressed.filter((finding) => finding.severity === "ERROR");
  let decision: ControlDecision["decision"] = blocking.length === 0 ? "approve" : "reject";
  if (impact.requiresAuthorization) decision = "needs_authorization";

  const accepted = impact.decisions.filter((item) => item.accepted);
  const nextCanon = decision === "approve" ? applyAcceptedChanges(input.canon, accepted) : null;

  return {
    decision,
    canonVersion: input.canon.version,
    layers: [...layers],
    findings: regressed,
    impact,
    traces,
    retryable: false,
    provider,
    nextCanon,
  };
}

function validateScenes(canon: CanonState, episode: number, scenes: SceneAppearance[]): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  for (const scene of scenes) {
    const flashback = sceneLooksLikeFlashback(scene.text);
    for (const name of scene.charactersPresent) {
      const resolved = resolveIdentity(name, canon.entities);
      if (resolved.ambiguous) findings.push(...identityFindings([resolved], episode));
      if (!resolved.canonicalId) continue;
      const entity = canon.entities.find((item) => item.id === resolved.canonicalId);
      if (!entity) continue;
      findings.push(...validateEntityUse(entity, episode, "physical", { flashback, sceneNumber: scene.sceneNumber }));
    }
    if (!scene.location.trim()) continue;
    const location = resolveIdentity(scene.location, canon.entities.filter((entity) => entity.kind === "location"));
    if (!location.canonicalId) continue;
    const entity = canon.entities.find((item) => item.id === location.canonicalId);
    if (!entity) continue;
    findings.push(...validateEntityUse(entity, episode, "physical", { flashback, sceneNumber: scene.sceneNumber }));
  }
  return findings;
}

function structuralFinding(explanation: string, actual: string): NarrativeFinding {
  return {
    id: `structural-${actual}`.slice(0, 16),
    algorithm: "structural",
    severity: "ERROR",
    category: "structural",
    entityId: null,
    artifactId: null,
    episode: null,
    sceneNumber: null,
    evidence: actual,
    expected: "A response for the current project and canon version.",
    actual,
    explanation,
    suggestedCorrection: "Rebuild the request from the current canon version.",
    automaticRepairSafe: false,
    signature: `structural:version:${actual}`,
    requiresCanonAuthorization: false,
    title: "Structural mismatch",
    confidence: "high",
    affectedAct: null,
  };
}

function trace(algorithm: string, sourceVersion: number, revisionRound: number, provider: string) {
  return { algorithm, revisionRound, sourceVersion, provider };
}
