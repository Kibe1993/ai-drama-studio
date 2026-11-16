import type { CanonAuthorization, CanonState, NarrativeGenerationRequest, NarrativeRevisionResponse } from "@/lib/validation/narrativeControl";
import { emptyAuthorization } from "@/lib/validation/narrativeControl";
import type { NarrativeFinding, ValidationTrace } from "@/lib/domain/narrativeControl/findings";
import { evaluateProposal, type ControlDecision } from "@/lib/domain/narrativeControl/orchestrator";
import type { InMemoryCanonStore } from "@/lib/domain/narrativeControl/store";

export const DEFAULT_MAX_REVISION_ROUNDS = 3;

export interface RevisionCycleResult {
  committed: boolean;
  canon: CanonState;
  text: string;
  rounds: number;
  decision: ControlDecision["decision"];
  findings: NarrativeFinding[];
  traces: ValidationTrace[];
}

/**
 * Bounded repair. The smallest unit is whatever the proposer returns, and
 * protected canon is never changed unless the application passed authorization.
 * After the last round, the last accepted canon is kept.
 */
export async function runControlledRevision(input: {
  canon: CanonState;
  episode: number;
  text: string;
  request: NarrativeGenerationRequest;
  maxRounds?: number;
  authorization?: CanonAuthorization;
  provider?: string;
  store?: InMemoryCanonStore;
  /**
   * Production reviews can replace the text-only decision with the screenplay
   * validator. Tests keep the default proposal check.
   */
  assess?: (input: {
    text: string;
    response: NarrativeRevisionResponse;
    round: number;
  }) => ControlDecision | Promise<ControlDecision>;
  propose: (input: {
    round: number;
    findings: NarrativeFinding[];
    objective: string;
  }) => NarrativeRevisionResponse | Promise<NarrativeRevisionResponse>;
}): Promise<RevisionCycleResult> {
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_REVISION_ROUNDS;
  const authorization = input.authorization ?? emptyAuthorization();
  let text = input.text;
  let canon = input.canon;
  let lastValid = input.canon;
  let findings: NarrativeFinding[] = [];
  let traces: ValidationTrace[] = [];
  let decision: ControlDecision["decision"] = "reject";
  let rounds = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    rounds = round;
    const current = await decide(input, {
      text,
      round,
      authorization,
      response: {
        taskId: input.request.taskId,
        projectId: canon.projectId,
        narrativeVersion: canon.version,
        proposedContent: text,
        proposedChanges: [],
        newEntities: [],
        newFacts: [],
        modifiedFacts: [],
        dependencies: [],
        uncertainties: [],
      },
    });
    traces = traces.concat(current.traces);
    findings = current.findings.filter((finding) => finding.severity === "ERROR");
    if (findings.length === 0) {
      decision = "approve";
      lastValid = current.nextCanon ?? canon;
      break;
    }
    if (findings.some((finding) => finding.requiresCanonAuthorization)) {
      decision = "needs_authorization";
      break;
    }

    const proposal = await input.propose({
      round,
      findings,
      objective: input.request.objective,
    });
    const reviewed = await decide(input, {
      text: proposal.proposedContent || text,
      round,
      authorization,
      response: proposal,
    });
    traces = traces.concat(reviewed.traces);
    decision = reviewed.decision;
    findings = reviewed.findings.filter((finding) => finding.severity === "ERROR");
    if (reviewed.decision === "needs_authorization") break;
    if (reviewed.decision === "approve" && reviewed.nextCanon) {
      canon = reviewed.nextCanon;
      lastValid = reviewed.nextCanon;
      text = proposal.proposedContent || text;
      const clean = await decide(input, {
        text,
        round,
        authorization,
        response: {
          ...proposal,
          narrativeVersion: canon.version,
          proposedChanges: [],
          proposedContent: text,
        },
      });
      traces = traces.concat(clean.traces);
      if (clean.findings.every((finding) => finding.severity !== "ERROR")) {
        decision = "approve";
        findings = [];
        break;
      }
      findings = clean.findings.filter((finding) => finding.severity === "ERROR");
    }
  }

  const committedCanon = decision === "approve" ? lastValid : input.canon;
  if (decision === "approve" && input.store) {
    input.store.commit(input.canon.projectId, input.canon.version, committedCanon, input.request.objective);
  }

  return {
    committed: decision === "approve" && Boolean(input.store),
    canon: decision === "approve" ? (input.store?.latest(input.canon.projectId) ?? committedCanon) : input.canon,
    text: decision === "approve" ? text : input.text,
    rounds,
    decision,
    findings,
    traces,
  };
}

function decide(
  input: {
    canon: CanonState;
    episode: number;
    provider?: string;
    assess?: (value: {
      text: string;
      response: NarrativeRevisionResponse;
      round: number;
    }) => ControlDecision | Promise<ControlDecision>;
  },
  value: {
    text: string;
    round: number;
    authorization: CanonAuthorization;
    response: NarrativeRevisionResponse;
  },
): Promise<ControlDecision> {
  if (input.assess) return Promise.resolve(input.assess({ text: value.text, response: value.response, round: value.round }));
  return Promise.resolve(evaluateProposal({
    canon: input.canon,
    episode: input.episode,
    provider: input.provider,
    revisionRound: value.round,
    authorization: value.authorization,
    response: value.response,
  }));
}
