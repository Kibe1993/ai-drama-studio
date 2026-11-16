import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { RevisionHistoryEntry, RevisionEpisodeChange, RevisionRoundSummary, RevisionSource } from "@/lib/validation/revisionHistory";
import type { UserReviewDecision } from "@/lib/validation/revisionHistory";
import type { RevalidationLoopResult } from "@/lib/domain/planValidation/revalidationLoop";

/**
 * Revision History domain functions — pure functions for creating and
 * updating revision history entries from revalidation loop results.
 */

let entryCounter = 0;

function makeEntryId(): string {
  entryCounter += 1;
  return `rev-hist-${entryCounter.toString(36).padStart(4, "0")}`;
}

export function resetEntryCounter(): void {
  entryCounter = 0;
}

const EPISODE_FIELDS: readonly (keyof EpisodePlanItem)[] = [
  "workingTitle",
  "narrativePurpose",
  "startingSituation",
  "mainObjective",
  "centralConflict",
  "majorStoryBeats",
  "informationRevealed",
  "characterDevelopment",
  "importantEvents",
  "consequences",
  "storyContribution",
  "endingOrCliffhanger",
  "unresolvedThreads",
  "continuityRequirements",
  "characterArcChanges",
  "relationshipChanges",
  "objectChanges",
  "locationChanges",
];

function normalizeValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === undefined || value === null) return "";
  return String(value);
}

export function summarizeEpisodeChanges(
  originalPlan: SeasonPlan,
  revisedPlan: SeasonPlan,
): RevisionEpisodeChange[] {
  const changes: RevisionEpisodeChange[] = [];

  for (const revisedEp of revisedPlan.episodeProgression) {
    const originalEp = originalPlan.episodeProgression.find(
      (e) => e.episodeNumber === revisedEp.episodeNumber,
    );
    if (!originalEp) {
      changes.push({
        episodeNumber: revisedEp.episodeNumber,
        changedFields: [...EPISODE_FIELDS],
      });
      continue;
    }

    const changedFields: string[] = [];
    for (const field of EPISODE_FIELDS) {
      if (normalizeValue(originalEp[field]) !== normalizeValue(revisedEp[field])) {
        changedFields.push(field);
      }
    }

    if (changedFields.length > 0) {
      changes.push({
        episodeNumber: revisedEp.episodeNumber,
        changedFields,
      });
    }
  }

  return changes;
}

function buildRoundSummaries(
  result: RevalidationLoopResult,
): RevisionRoundSummary[] {
  return result.rounds.map((round) => ({
    round: round.round,
    actionsApplied: round.executionResult.successCount,
    actionsRejected: round.executionResult.rejectedCount,
    actionsFailed: round.executionResult.failedCount,
    stopReason: round.stopReason,
  }));
}

export function createRevisionHistoryEntry(
  loopResult: RevalidationLoopResult,
  source: RevisionSource,
  fromVersion: number,
  toVersion: number,
  reason: string,
  findingsBefore: number,
  originalPlan: SeasonPlan,
): RevisionHistoryEntry {
  return {
    entryId: makeEntryId(),
    timestamp: new Date().toISOString(),
    source,
    fromVersion,
    toVersion,
    reason,
    stopReason: loopResult.stopReason,
    totalRounds: loopResult.totalRounds,
    totalRevisionsApplied: loopResult.totalRevisionsApplied,
    totalRevisionsRejected: loopResult.totalRevisionsRejected,
    rounds: buildRoundSummaries(loopResult),
    episodeChanges: summarizeEpisodeChanges(originalPlan, loopResult.finalPlan),
    findingsBefore,
    findingsAfter: loopResult.finalFindings.length,
    blockingResolved: loopResult.finalPassed,
    reviewStatus: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
  };
}

export function applyReviewDecision(
  entry: RevisionHistoryEntry,
  decision: UserReviewDecision,
): RevisionHistoryEntry {
  return {
    ...entry,
    reviewStatus: decision.decision === "approve" ? "approved" : "rejected",
    reviewedBy: decision.reviewedBy,
    reviewedAt: decision.reviewedAt,
    reviewNotes: decision.notes,
  };
}

export function isPendingReview(entry: RevisionHistoryEntry): boolean {
  return entry.reviewStatus === "pending";
}

export function isApproved(entry: RevisionHistoryEntry): boolean {
  return entry.reviewStatus === "approved";
}

export function isRejected(entry: RevisionHistoryEntry): boolean {
  return entry.reviewStatus === "rejected";
}

export function hasEpisodeChanges(entry: RevisionHistoryEntry): boolean {
  return entry.episodeChanges.length > 0;
}

export function getChangedEpisodeNumbers(entry: RevisionHistoryEntry): number[] {
  return entry.episodeChanges.map((c) => c.episodeNumber);
}