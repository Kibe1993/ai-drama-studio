

/**
 * Revision History — types for tracking plan revisions over time.
 *
 * Each entry records a single revision event: what triggered it, what changed,
 * what the revalidation loop did, and the user review status.
 */

export type RevisionSource = "auto_revalidation" | "manual_edit" | "rollback";
export type ReviewStatus = "pending" | "approved" | "rejected";

export interface RevisionEpisodeChange {
  episodeNumber: number;
  changedFields: string[];
}

export interface RevisionRoundSummary {
  round: number;
  actionsApplied: number;
  actionsRejected: number;
  actionsFailed: number;
  stopReason: string;
}

export interface RevisionHistoryEntry {
  entryId: string;
  timestamp: string;
  source: RevisionSource;
  fromVersion: number;
  toVersion: number;
  reason: string;
  stopReason: string;
  totalRounds: number;
  totalRevisionsApplied: number;
  totalRevisionsRejected: number;
  rounds: RevisionRoundSummary[];
  episodeChanges: RevisionEpisodeChange[];
  findingsBefore: number;
  findingsAfter: number;
  blockingResolved: boolean;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

export interface UserReviewDecision {
  decision: "approve" | "reject";
  notes: string | null;
  reviewedBy: string;
  reviewedAt: string;
}

export const REVIEW_STATUSES: readonly ReviewStatus[] = ["pending", "approved", "rejected"];
export const REVISION_SOURCES: readonly RevisionSource[] = ["auto_revalidation", "manual_edit", "rollback"];