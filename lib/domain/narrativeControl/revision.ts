import type {
  CanonAuthorization,
  CanonState,
  NarrativeFact,
  ProposedChange,
} from "@/lib/validation/narrativeControl";
import { isProtectedFact } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { objectOwnershipChanged } from "@/lib/domain/narrativeControl/objects";

export interface ChangeDecision {
  change: ProposedChange;
  accepted: boolean;
  reason: string;
  downstreamIds: string[];
}

export interface RevisionImpact {
  decisions: ChangeDecision[];
  findings: NarrativeFinding[];
  requiresAuthorization: boolean;
}

function granted(change: ProposedChange, canon: CanonState, authorization: CanonAuthorization): boolean {
  if (change.targetKind === "fact") return authorization.factIds.includes(change.targetId);
  if (change.targetKind === "rule") return authorization.ruleIds.includes(change.targetId);
  if (change.targetKind === "entity" || change.targetKind === "object") return authorization.entityIds.includes(change.targetId);
  if (change.targetKind === "scene") return true;
  const fact = canon.facts.find((item) => item.id === change.targetId);
  return fact ? authorization.factIds.includes(fact.id) : false;
}

function factByKey(canon: CanonState, key: string): NarrativeFact | undefined {
  return canon.facts.find((fact) => fact.key === key && isProtectedFact(fact));
}

export function analyzeRevision(
  canon: CanonState,
  changes: readonly ProposedChange[],
  authorization: CanonAuthorization,
): RevisionImpact {
  const decisions: ChangeDecision[] = [];
  const findings: NarrativeFinding[] = [];

  for (const change of changes) {
    const downstreamIds = downstreamOf(canon, change);
    if (change.kind === "ADD" && change.targetKind === "fact" && change.proposedValue.includes("=")) {
      const [proposedKey, proposedLiteral] = change.proposedValue.split("=", 2);
      const existing = factByKey(canon, proposedKey?.trim() || "");
      if (existing && proposedLiteral && existing.value && proposedLiteral.trim() !== existing.value) {
        decisions.push(reject(change, "A protected fact already owns this key.", downstreamIds));
        findings.push(protectedFinding(change, existing.statement));
        continue;
      }
    }

    const protectedTarget = isProtectedTarget(canon, change);
    if (protectedTarget && !granted(change, canon, authorization)) {
      decisions.push(reject(change, "This changes protected canon without application authorization.", downstreamIds));
      findings.push(protectedFinding(change, protectedTarget));
      continue;
    }

    if ((change.targetKind === "object" || change.targetKind === "entity") && change.kind === "MODIFY" && change.objective === "ownership") {
      const entity = canon.entities.find((item) => item.id === change.targetId);
      if (entity) {
        const ownership = objectOwnershipChanged(entity, change.proposedValue || null, change.dependencies[0] ?? null);
        if (ownership) {
          decisions.push(reject(change, ownership.explanation, downstreamIds));
          findings.push(ownership);
          continue;
        }
      }
    }

    if ((change.kind === "MODIFY" || change.kind === "REMOVE" || change.kind === "RETRACT") && !targetExists(canon, change) && change.targetKind !== "scene") {
      decisions.push(reject(change, "The target does not exist in this canon version.", downstreamIds));
      findings.push(makeFinding({
        algorithm: "revision",
        severity: "ERROR",
        category: "structural",
        artifactId: change.targetId,
        evidence: change.id,
        expected: "A target that exists in the current canon version.",
        actual: change.targetId,
        explanation: `Change ${change.id} targets missing ${change.targetKind} ${change.targetId}.`,
        suggestedCorrection: "Retarget the change or add the entity first.",
      }));
      continue;
    }

    decisions.push({ change, accepted: true, reason: "Permitted within the current canon boundary.", downstreamIds });
    if (downstreamIds.length > 0 && protectedTarget) {
      findings.push(makeFinding({
        algorithm: "revision",
        severity: "INFO",
        category: "impact",
        artifactId: change.targetId,
        evidence: downstreamIds.join(", "),
        expected: "Downstream artifacts stay untouched until they are regenerated or approved.",
        actual: downstreamIds.join(", "),
        explanation: `Authorized change ${change.id} affects ${downstreamIds.join(", ")}. Those records are not rewritten automatically.`,
        suggestedCorrection: "Review the listed dependencies before regenerating them.",
      }));
    }
  }

  return {
    decisions,
    findings,
    requiresAuthorization: decisions.some((decision) => !decision.accepted && decision.reason.includes("authorization")),
  };
}

function reject(change: ProposedChange, reason: string, downstreamIds: string[]): ChangeDecision {
  return { change, accepted: false, reason, downstreamIds };
}

function protectedFinding(change: ProposedChange, expected: string): NarrativeFinding {
  return makeFinding({
    algorithm: "revision",
    severity: "ERROR",
    category: "canon",
    artifactId: change.targetId,
    evidence: `${change.currentValue} -> ${change.proposedValue}`,
    expected,
    actual: change.proposedValue,
    explanation: `Change ${change.id} would alter protected canon (${change.targetKind} ${change.targetId}).`,
    suggestedCorrection: "Drop the canon change or request explicit authorization.",
    requiresCanonAuthorization: true,
  });
}

function isProtectedTarget(canon: CanonState, change: ProposedChange): string | null {
  if (change.targetKind === "scene") return null;
  if (change.targetKind === "fact" || change.targetKind === "knowledge") {
    const fact = canon.facts.find((item) => item.id === change.targetId);
    if (fact && isProtectedFact(fact) && (change.kind === "MODIFY" || change.kind === "REMOVE" || change.kind === "RETRACT" || change.kind === "REINTERPRET")) {
      return fact.statement;
    }
  }
  if (change.targetKind === "rule") {
    const rule = canon.rules.find((item) => item.id === change.targetId);
    if (rule && rule.approvalStatus === "approved" && change.kind !== "ADD") return rule.description;
  }
  if ((change.targetKind === "entity" || change.targetKind === "object") && (change.kind === "REMOVE" || change.objective === "identity" || change.objective === "ownership")) {
    const entity = canon.entities.find((item) => item.id === change.targetId);
    if (entity) return entity.name;
  }
  return null;
}

function targetExists(canon: CanonState, change: ProposedChange): boolean {
  if (change.targetKind === "fact" || change.targetKind === "knowledge") return canon.facts.some((fact) => fact.id === change.targetId);
  if (change.targetKind === "rule") return canon.rules.some((rule) => rule.id === change.targetId);
  if (change.targetKind === "event") return canon.events.some((event) => event.id === change.targetId);
  if (change.targetKind === "thread") return canon.threads.some((thread) => thread.id === change.targetId);
  if (change.targetKind === "relationship") return canon.relationships.some((item) => item.id === change.targetId);
  return canon.entities.some((entity) => entity.id === change.targetId);
}

function downstreamOf(canon: CanonState, change: ProposedChange): string[] {
  const ids = new Set<string>(change.dependencies);
  const fact = canon.facts.find((item) => item.id === change.targetId);
  for (const entityId of fact?.subjectEntityIds ?? []) {
    for (const event of canon.events) {
      if (event.participantIds.includes(entityId)) ids.add(event.id);
    }
  }
  if (change.targetKind === "rule") {
    for (const event of canon.events) {
      if (event.description.includes(change.targetId)) ids.add(event.id);
    }
  }
  ids.delete(change.targetId);
  return [...ids];
}

export function applyAcceptedChanges(canon: CanonState, decisions: readonly ChangeDecision[]): CanonState {
  const next: CanonState = structuredClone(canon);
  for (const decision of decisions) {
    if (!decision.accepted) continue;
    const change = decision.change;
    if (change.targetKind === "fact" && (change.kind === "MODIFY" || change.kind === "REINTERPRET")) {
      const fact = next.facts.find((item) => item.id === change.targetId);
      if (fact) {
        fact.value = change.proposedValue;
        if (change.kind === "REINTERPRET") fact.statement = change.proposedValue || fact.statement;
      }
    } else if (change.targetKind === "fact" && change.kind === "RETRACT") {
      const fact = next.facts.find((item) => item.id === change.targetId);
      if (fact) {
        fact.classification = "RETRACTED";
        fact.protected = false;
      }
    } else if (change.targetKind === "fact" && change.kind === "REMOVE") {
      next.facts = next.facts.filter((fact) => fact.id !== change.targetId);
    } else if (change.targetKind === "rule" && change.kind === "MODIFY") {
      const rule = next.rules.find((item) => item.id === change.targetId);
      if (rule) rule.description = change.proposedValue || rule.description;
    } else if ((change.targetKind === "entity" || change.targetKind === "object") && change.kind === "MODIFY" && change.objective === "ownership") {
      const entity = next.entities.find((item) => item.id === change.targetId);
      if (entity) {
        const fromOwnerId = entity.ownerId;
        entity.ownerId = change.proposedValue || null;
        entity.transfers.push({
          episode: 1,
          fromOwnerId,
          toOwnerId: entity.ownerId,
          eventId: change.dependencies[0] ?? null,
        });
      }
    }
  }
  return next;
}
