/**
 * CASNA stage gates.
 *
 * These are pure functions so the same rules run on the backend (services and
 * the production pipeline) and can be unit tested without a database. They are
 * deliberately the single source of truth for "may this episode be generated?":
 * the UI only mirrors them.
 */

export type CasnaGateCode =
  | "ok"
  | "bible_required"
  | "season_plan_required"
  | "plan_stale"
  | "plan_revision_pending"
  | "plan_episode_missing"
  | "episode_locked";

export type CasnaGate = {
  allowed: boolean;
  code: CasnaGateCode;
  reason: string | null;
};

const ALLOWED: CasnaGate = { allowed: true, code: "ok", reason: null };

/** Episode statuses that mean a creator approved the episode's screenplay. */
const APPROVED_EPISODE_STATUSES = new Set(["story_approved", "completed"]);

export type PlanGateView = {
  version: number;
  status: "awaiting_approval" | "approved" | "failed";
  basedOnBibleVersion: number;
  episodeProgression: { episodeNumber: number }[];
};

export type LedgerGateView = {
  asOfEpisode: number;
  basedOnPlanVersion: number;
};

export type EpisodeGateView = {
  episodeNumber: number;
  status: string;
};

export function episodeIsApproved(status: string): boolean {
  return APPROVED_EPISODE_STATUSES.has(status);
}

/** The episode number a new episode would receive. */
export function nextEpisodeNumber(episodes: { episodeNumber: number }[]): number {
  return episodes.reduce((max, episode) => Math.max(max, episode.episodeNumber), 0) + 1;
}

/** The last approved episode before `episodeNumber`, if there is one. */
export function previousApprovedEpisode<T extends EpisodeGateView>(
  episodes: T[],
  episodeNumber: number
): T | null {
  const earlier = episodes
    .filter((episode) => episode.episodeNumber < episodeNumber && episodeIsApproved(episode.status))
    .sort((a, b) => b.episodeNumber - a.episodeNumber);
  return earlier[0] ?? null;
}

/**
 * Whether the approved Season Plan can still be used as the source of truth.
 * A plan is stale as soon as the approved Story Bible it was developed from
 * changes, or when a newer plan revision is waiting for approval.
 */
export function planGate(input: {
  approvedPlan: PlanGateView | null;
  latestPlan: PlanGateView | null;
  bibleApprovedVersion: number;
}): CasnaGate {
  const { approvedPlan, latestPlan, bibleApprovedVersion } = input;
  if (bibleApprovedVersion === 0) {
    return {
      allowed: false,
      code: "bible_required",
      reason: "Approve the Story Bible before generating episodes.",
    };
  }
  if (!approvedPlan) {
    return {
      allowed: false,
      code: "season_plan_required",
      reason: "Generate and approve a Season Plan before generating episodes.",
    };
  }
  if (approvedPlan.basedOnBibleVersion !== bibleApprovedVersion) {
    return {
      allowed: false,
      code: "plan_stale",
      reason:
        "The approved Story Bible changed since this Season Plan was approved. Review and re-approve the Season Plan.",
    };
  }
  if (
    latestPlan &&
    latestPlan.status !== "approved" &&
    latestPlan.version > approvedPlan.version
  ) {
    return {
      allowed: false,
      code: "plan_revision_pending",
      reason:
        "A newer Season Plan revision is waiting for approval. Approve or discard it before generating another episode.",
    };
  }
  return ALLOWED;
}

/**
 * The full sequential gate for one target episode.
 *
 * Episodes are generated in chronological order. Episode N is only available
 * when every earlier episode has been approved, and the Continuity Ledger has
 * caught up with N - 1. A later episode can therefore never ignore what an
 * earlier approved episode established.
 */
export function episodeGenerationGate(input: {
  productionMode: string;
  bibleApprovedVersion: number;
  approvedPlan: PlanGateView | null;
  latestPlan?: PlanGateView | null;
  ledger: LedgerGateView | null;
  episodes: EpisodeGateView[];
  targetEpisodeNumber: number;
}): CasnaGate {
  const serialized = input.productionMode === "serialized";
  if (input.bibleApprovedVersion === 0) {
    return {
      allowed: false,
      code: "bible_required",
      reason: "Approve the Story Bible before generating episodes.",
    };
  }
  if (!serialized) return ALLOWED;

  const plan = planGate({
    approvedPlan: input.approvedPlan,
    latestPlan: input.latestPlan ?? input.approvedPlan,
    bibleApprovedVersion: input.bibleApprovedVersion,
  });
  if (!plan.allowed) return plan;

  if (!input.approvedPlan!.episodeProgression.some((item) => item.episodeNumber === input.targetEpisodeNumber)) {
    return {
      allowed: false,
      code: "plan_episode_missing",
      reason: `The approved Season Plan does not include episode ${input.targetEpisodeNumber}. Revise the plan to extend the season.`,
    };
  }

  const blocking = input.episodes
    .filter(
      (episode) =>
        episode.episodeNumber < input.targetEpisodeNumber && !episodeIsApproved(episode.status)
    )
    .sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
  if (blocking) {
    return {
      allowed: false,
      code: "episode_locked",
      reason: `Episode ${input.targetEpisodeNumber} is locked until episode ${blocking.episodeNumber} is approved.`,
    };
  }

  const requiredLedgerEpisode = input.targetEpisodeNumber - 1;
  if (requiredLedgerEpisode >= 1 && (input.ledger?.asOfEpisode ?? 0) < requiredLedgerEpisode) {
    return {
      allowed: false,
      code: "episode_locked",
      reason: `The Continuity Ledger has not caught up with episode ${requiredLedgerEpisode}. Approve that episode before generating episode ${input.targetEpisodeNumber}.`,
    };
  }

  return ALLOWED;
}

/**
 * An episode was written against an older Season Plan version than the one now
 * approved. Its content is preserved but flagged for continuity review.
 */
export function episodeNeedsPlanReview(input: {
  approvedPlanVersion: number;
  episodeBasePlanVersion: number;
}): boolean {
  return (
    input.approvedPlanVersion > 0 &&
    input.episodeBasePlanVersion > 0 &&
    input.episodeBasePlanVersion < input.approvedPlanVersion
  );
}
