import type {
  CanonFactEntry,
  CanonFactKind,
  DerivedCanonState,
  Evidence,
  NarrativeMode,
  AssertionKind,
  FactualStatus,
} from "@/lib/canon/schema";
import { reduceCanonIncremental, ReduceError } from "@/lib/canon/reduce";

export type PreparedFact = {
  id: string;
  episode: number;
  sourceStoryId: string | null;
  kind: CanonFactKind;
  targetId: string;
  payload: unknown;
  evidence: Evidence;
  narrativeMode: NarrativeMode;
  assertionKind: AssertionKind;
  factualStatus: FactualStatus;
  asserterId: string | null;
  reason: string;
  extractor: string;
  evidencePosition: number;
  sceneNumber: number;
};

export type ReconciledFact = PreparedFact & { operation: "add" | "modify" };

export type ReconciliationIssue = {
  factId: string;
  code: string;
  message: string;
  fact: PreparedFact;
};

export type ReconcileResult = {
  committed: ReconciledFact[];
  issues: ReconciliationIssue[];
};

function targetExists(
  state: DerivedCanonState,
  kind: CanonFactKind,
  targetId: string,
): boolean {
  switch (kind) {
    case "entity":
      return state.entities.some((e) => e.id === targetId);
    case "relationship":
      return state.relationships.some((r) => r.id === targetId);
    case "event":
      return state.events.some((e) => e.id === targetId);
    case "thread":
      return state.threads.some((t) => t.id === targetId);
    case "fact":
      return state.facts.some((f) => f.id === targetId);
    case "knowledge":
      return state.knowledge.some((k) => k.id === targetId);
    case "rule":
      return state.rules.some((r) => r.id === targetId);
  }
}

function sortFacts(facts: PreparedFact[]): PreparedFact[] {
  return [...facts].sort((a, b) => {
    if (a.sceneNumber !== b.sceneNumber) return a.sceneNumber - b.sceneNumber;
    if (a.evidencePosition !== b.evidencePosition)
      return a.evidencePosition - b.evidencePosition;
    return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
  });
}

function toTrialEntry(
  fact: PreparedFact & { operation: "add" | "modify" },
  projectId: string,
  sequence: number,
): CanonFactEntry {
  return {
    id: fact.id,
    sequence,
    projectId,
    episode: fact.episode,
    sourceStoryId: fact.sourceStoryId,
    operation: fact.operation,
    kind: fact.kind,
    targetId: fact.targetId,
    payload: fact.payload,
    newClassification: null,
    evidence: fact.evidence,
    narrativeMode: fact.narrativeMode,
    assertionKind: fact.assertionKind,
    factualStatus: fact.factualStatus,
    asserterId: fact.asserterId,
    commitBatchId: null,
    reason: fact.reason,
    extractor: fact.extractor,
    createdAt: new Date(),
  };
}

export function reconcileBatch(input: {
  projectId: string;
  baseState: DerivedCanonState;
  facts: PreparedFact[];
}): ReconcileResult {
  const sorted = sortFacts(input.facts);
  let workingState = input.baseState;
  const committed: ReconciledFact[] = [];
  const issues: ReconciliationIssue[] = [];

  for (const fact of sorted) {
    const operation: "add" | "modify" = targetExists(
      workingState,
      fact.kind,
      fact.targetId,
    )
      ? "modify"
      : "add";

    const trialSequence = workingState.sequence + 1;
    const trialEntry = toTrialEntry(
      { ...fact, operation },
      input.projectId,
      trialSequence,
    );

    try {
      workingState = reduceCanonIncremental(workingState, [trialEntry], "strict");
      committed.push({ ...fact, operation });
    } catch (error) {
      if (error instanceof ReduceError) {
        issues.push({
          factId: fact.id,
          code: error.code,
          message: error.message,
          fact,
        });
      } else {
        issues.push({
          factId: fact.id,
          code: "reconciliation_error",
          message:
            error instanceof Error ? error.message : "Unknown reconciliation error.",
          fact,
        });
      }
    }
  }

  return { committed, issues };
}