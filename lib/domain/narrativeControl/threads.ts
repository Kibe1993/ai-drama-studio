import type { CanonState, CanonThread } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";

const CLOSED = new Set(["paid_off", "resolved", "deliberately_carried_forward", "abandoned_with_explanation"]);

function referenceFindings(thread: CanonThread): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  for (const payoff of thread.payoffEpisodes) {
    for (const setup of thread.setupEpisodes) {
      if (payoff < setup) {
        findings.push(makeFinding({
          algorithm: "threads",
          severity: "ERROR",
          category: "thread",
          artifactId: thread.id,
          episode: payoff,
          evidence: thread.description,
          expected: `Payoff at or after setup episode ${setup}.`,
          actual: `Payoff in episode ${payoff}.`,
          explanation: `"${thread.description}" pays off in episode ${payoff} before its setup in episode ${setup}.`,
          suggestedCorrection: "Point the setup and payoff at the episodes where they actually occur.",
        }));
      }
    }
  }
  if ((thread.status === "resolved" || thread.status === "paid_off") && thread.setupEpisodes.length > 0 && thread.payoffEpisodes.length === 0) {
    findings.push(makeFinding({
      algorithm: "threads",
      severity: "ERROR",
      category: "thread",
      artifactId: thread.id,
      episode: thread.introducedEpisode,
      evidence: thread.description,
      expected: "At least one payoff episode for a resolved thread that has a setup.",
      actual: "No payoff episode is recorded.",
      explanation: `"${thread.description}" is marked ${thread.status} without a payoff reference.`,
      suggestedCorrection: "Record the episode that pays it off, or leave it open.",
    }));
  }
  if (thread.status === "abandoned_with_explanation" && thread.explanation.trim().length === 0) {
    findings.push(makeFinding({
      algorithm: "threads",
      severity: "ERROR",
      category: "thread",
      artifactId: thread.id,
      episode: thread.introducedEpisode,
      evidence: thread.description,
      expected: "An explanation for abandoning the thread.",
      actual: "The explanation is empty.",
      explanation: `"${thread.description}" is abandoned without an explanation.`,
      suggestedCorrection: "Record why the thread was dropped, or restore it.",
    }));
  }
  if (thread.status === "deliberately_carried_forward" && !thread.carryForward) {
    findings.push(makeFinding({
      algorithm: "threads",
      severity: "WARNING",
      category: "thread",
      artifactId: thread.id,
      episode: thread.introducedEpisode,
      evidence: thread.description,
      expected: "carryForward is true for a deliberate future hook.",
      actual: "carryForward is false.",
      explanation: `"${thread.description}" is carried forward without the carry-forward designation.`,
      suggestedCorrection: "Mark it as a deliberate carry-forward and name the intended season.",
    }));
  }
  return findings;
}

export function validateThreads(canon: CanonState): NarrativeFinding[] {
  return canon.threads.flatMap(referenceFindings);
}

/**
 * Finale checks are scoped. A future-season hook is not a failed ending.
 * A central conflict that is still open, with no carry-forward, is.
 */
export function validateFinale(canon: CanonState, finaleEpisode: number): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  for (const thread of canon.threads) {
    if (CLOSED.has(thread.status)) continue;
    if (thread.scope === "hook" || thread.category === "future_season_hook") {
      findings.push(makeFinding({
        algorithm: "threads",
        severity: "INFO",
        category: "thread",
        artifactId: thread.id,
        episode: finaleEpisode,
        evidence: thread.description,
        expected: "A future hook may remain open.",
        actual: thread.status,
        explanation: `"${thread.description}" remains open as a future-season hook.`,
        suggestedCorrection: "",
      }));
      continue;
    }
    if (thread.scope === "secondary") {
      findings.push(makeFinding({
        algorithm: "threads",
        severity: "INFO",
        category: "thread",
        artifactId: thread.id,
        episode: finaleEpisode,
        evidence: thread.description,
        expected: "Secondary threads may remain open.",
        actual: thread.status,
        explanation: `Secondary thread "${thread.description}" is still open at the finale.`,
        suggestedCorrection: "",
      }));
      continue;
    }
    if (thread.scope === "central") {
      findings.push(makeFinding({
        algorithm: "threads",
        severity: "ERROR",
        category: "thread",
        artifactId: thread.id,
        episode: finaleEpisode,
        evidence: thread.description,
        expected: "The central season conflict is resolved, paid off, or deliberately carried forward.",
        actual: thread.status,
        explanation: `The central thread "${thread.description}" is still ${thread.status} at episode ${finaleEpisode}.`,
        suggestedCorrection: "Resolve it in the finale or mark a deliberate carry-forward with a reason.",
      }));
      continue;
    }
    findings.push(makeFinding({
      algorithm: "threads",
      severity: "WARNING",
      category: "thread",
      artifactId: thread.id,
      episode: finaleEpisode,
      evidence: thread.description,
      expected: "A character or relationship arc is resolved or explicitly continued.",
      actual: thread.status,
      explanation: `"${thread.description}" is still open at the finale.`,
      suggestedCorrection: "Resolve the arc or record that it continues.",
    }));
  }
  return findings;
}
