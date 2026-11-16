import type { CanonState } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";

export type CausalClass =
  | "valid_progression"
  | "unacknowledged_consequence"
  | "contradictory_consequence"
  | "missing_prerequisite"
  | "uncertain_cause";

export interface CausalAssessment {
  eventId: string;
  classification: CausalClass;
  finding: NarrativeFinding | null;
}

export function assessCausality(canon: CanonState): CausalAssessment[] {
  const byId = new Map(canon.events.map((event) => [event.id, event]));
  const assessments: CausalAssessment[] = [];

  for (const event of canon.events) {
    for (const preconditionId of event.preconditions) {
      const precondition = byId.get(preconditionId);
      if (!precondition || precondition.episode > event.episode) {
        const finding = makeFinding({
          algorithm: "causal",
          severity: "ERROR",
          category: "causal",
          episode: event.episode,
          artifactId: event.id,
          evidence: event.description,
          expected: `Precondition ${preconditionId} exists in an earlier or same episode.`,
          actual: precondition ? `Precondition occurs in episode ${precondition.episode}.` : "Precondition is missing.",
          explanation: `${event.description} depends on ${preconditionId}, which is not available yet.`,
          suggestedCorrection: "Add the missing event or remove the dependency.",
        });
        assessments.push({ eventId: event.id, classification: "missing_prerequisite", finding });
      }
    }

    for (const conflictId of event.contradictoryWith) {
      const other = byId.get(conflictId);
      if (!other) continue;
      assessments.push({
        eventId: event.id,
        classification: "contradictory_consequence",
        finding: makeFinding({
          algorithm: "causal",
          severity: "ERROR",
          category: "causal",
          episode: event.episode,
          artifactId: event.id,
          evidence: `${event.id} contradicts ${conflictId}`,
          expected: "Consequences agree with earlier outcomes.",
          actual: other.description,
          explanation: `"${event.description}" contradicts "${other.description}".`,
          suggestedCorrection: "Change one outcome or record an authorized event that supersedes the earlier one.",
          requiresCanonAuthorization: true,
        }),
      });
    }

    if (event.requiresCause && event.causedBy.length === 0 && event.triggers.length === 0 && event.preconditions.length === 0) {
      assessments.push({
        eventId: event.id,
        classification: "uncertain_cause",
        finding: makeFinding({
          algorithm: "causal",
          severity: "WARNING",
          category: "causal",
          episode: event.episode,
          artifactId: event.id,
          evidence: event.description,
          expected: "An explicit cause, trigger, or precondition.",
          actual: "No causal link is stored.",
          explanation: `"${event.description}" is marked as requiring a cause, and none is stored.`,
          suggestedCorrection: "Link the event to the earlier event that makes it possible.",
        }),
      });
    }
  }

  for (const earlier of canon.events) {
    if (earlier.acknowledgement !== "required" || earlier.consequences.length === 0) continue;
    const later = canon.events.some((event) =>
      event.episode > earlier.episode
      && (event.causedBy.includes(earlier.id) || event.triggers.includes(earlier.id) || earlier.consequences.includes(event.id)),
    );
    if (!later) {
      assessments.push({
        eventId: earlier.id,
        classification: "unacknowledged_consequence",
        finding: makeFinding({
          algorithm: "causal",
          severity: "WARNING",
          category: "causal",
          episode: earlier.episode,
          artifactId: earlier.id,
          evidence: earlier.description,
          expected: "A later event, relationship change, or situation that develops this consequence.",
          actual: "No later event references it.",
          explanation: `The consequence of "${earlier.description}" is required and no later event develops it.`,
          suggestedCorrection: "Acknowledge it through a later action, relationship, or situation.",
        }),
      });
    } else {
      assessments.push({ eventId: earlier.id, classification: "valid_progression", finding: null });
    }
  }

  return assessments;
}

export function causalFindings(canon: CanonState): NarrativeFinding[] {
  return assessCausality(canon).flatMap((item) => item.finding ? [item.finding] : []);
}
