// No "server-only" guard: this service is also imported by the BullMQ worker
// through lib/pipeline/live.ts. The worker is server-side but runs outside
// Next.js's module graph, where the guard would throw at startup.
import type { RequestAuth } from "@/lib/auth/session";
import { isObjectId } from "@/lib/repositories/ownership";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { continuityLedgerRepository } from "@/lib/repositories/continuityLedgerRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { StudioError } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { deriveEpisodePlan } from "@/lib/domain/episodePlan";
import { extractEpisodeCanon } from "@/lib/domain/episodeCanon";
import { applyCanonToLedger } from "@/lib/domain/ledger";
import type { ContinuityLedger, ContinuityLedgerRecord } from "@/lib/validation/continuityLedger";
import type { EpisodeRecord } from "@/lib/validation/episode";
import type { SeasonPlanRecord } from "@/lib/validation/seasonPlan";
import type { StoryRecord } from "@/lib/validation/story";

type ProjectPort = Pick<typeof projectRepository, "findOwned">;
type PlanPort = Pick<typeof seasonPlanRepository, "findApproved">;
type LedgerPort = Pick<typeof continuityLedgerRepository, "findLatest" | "upsert">;
type EpisodePort = Pick<typeof episodeRepository, "listOwned">;
type StoryPort = Pick<
  typeof storyRepository,
  "findLatestAwaitingEpisode" | "saveCanonSummary" | "findOwned"
>;

/**
 * A development proposed by an episode draft. It is deliberately not part of
 * the persisted ledger: proposed material only becomes established canon when
 * the creator approves the episode. The continuity view shows it separately.
 */
export type ProposedDevelopment = {
  episodeNumber: number;
  development: string;
  source: "episode_plan";
};

export type ContinuityState = {
  ledger: ContinuityLedgerRecord | null;
  proposedDevelopments: ProposedDevelopment[];
  /** Approved episodes exist but no ledger yet, so it can be rebuilt safely. */
  canRebuild: boolean;
};

export type RebuildResult = {
  replayedEpisodes: number;
  created: boolean;
  ledger: ContinuityLedgerRecord | null;
};

export function createContinuityService(
  projects: ProjectPort = projectRepository,
  plans: PlanPort = seasonPlanRepository,
  ledgers: LedgerPort = continuityLedgerRepository,
  episodes: EpisodePort = episodeRepository,
  stories: StoryPort = storyRepository
) {
  async function replay(
    clerkUserId: string,
    projectId: string,
    plan: SeasonPlanRecord,
    approved: EpisodeRecord[],
    startingLedger: ContinuityLedger | null,
    dryRun: boolean
  ): Promise<RebuildResult> {
    let merged: ContinuityLedger = startingLedger ?? {
      events: [],
      characterStates: [],
      locationStates: [],
      objectStates: [],
      revealedSecrets: [],
      unresolvedThreads: [],
      consequences: [],
      timelineNotes: "",
    };
    let previousEpisode: { episodeNumber: number; title: string; synopsis: string } | null = null;
    let replayed = 0;
    let lastEpisodeNumber = 0;
    for (const episode of approved) {
      const story = episode.currentStoryId
        ? await stories.findOwned(clerkUserId, episode.currentStoryId)
        : null;
      if (!story || story.status !== "approved") continue;
      const episodePlan =
        story.plan ??
        deriveEpisodePlan({
          plan,
          ledger: merged,
          previousEpisode,
          episodeNumber: episode.episodeNumber,
        });
      const summary = extractEpisodeCanon({
        episodeNumber: episode.episodeNumber,
        story,
        plan,
        episodePlan,
        ledger: merged,
      });
      if (!dryRun) await stories.saveCanonSummary(clerkUserId, story.id, summary);
      merged = applyCanonToLedger(merged, summary);
      previousEpisode = {
        episodeNumber: episode.episodeNumber,
        title: story.title,
        synopsis: story.synopsis,
      };
      lastEpisodeNumber = episode.episodeNumber;
      replayed += 1;
    }
    if (replayed === 0) return { replayedEpisodes: 0, created: false, ledger: null };
    if (dryRun) {
      return {
        replayedEpisodes: replayed,
        created: false,
        ledger: {
          ...merged,
          id: "dry-run",
          clerkUserId,
          projectId,
          asOfEpisode: lastEpisodeNumber,
          basedOnPlanVersion: plan.version,
          version: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    }
    const saved = await ledgers.upsert({
      ...merged,
      clerkUserId,
      projectId,
      asOfEpisode: lastEpisodeNumber,
      basedOnPlanVersion: plan.version,
    });
    log.info("continuity", "ledger rebuilt from approved episodes", {
      projectId,
      replayedEpisodes: replayed,
      ledgerVersion: saved.version,
    });
    return { replayedEpisodes: replayed, created: true, ledger: saved };
  }

  return {
    /**
     * Get established canon plus the developments proposed by an unapproved
     * draft. The two are returned separately so nothing can mistake a proposal
     * for canon.
     */
    async get(actor: RequestAuth, projectId: string): Promise<ContinuityState> {
      if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
      const project = await projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");
      const ledger = await ledgers.findLatest(actor.userId, projectId);
      const draft = await stories.findLatestAwaitingEpisode(actor.userId, projectId);
      const plan = draft?.plan ?? null;
      const proposedDevelopments: ProposedDevelopment[] = plan
        ? [
            ...plan.newDevelopments,
            ...plan.consequencesCreated,
            ...plan.characterChanges,
            ...(plan.characterArcChanges ?? []).map((change) => `${change.name}: ${change.change}`),
            ...(plan.relationshipChanges ?? []).map(
              (change) => `${change.from} → ${change.to}: ${change.change}`
            ),
            ...(plan.objectChanges ?? []).map(
              (change) => `${change.name} (${change.ownership}, ${change.condition})`
            ),
            ...(plan.locationChanges ?? []).map((change) => `${change.name}: ${change.change}`),
          ]
            .slice(0, 14)
            .map((development) => ({
              episodeNumber: plan.episodeNumber,
              development,
              source: "episode_plan" as const,
            }))
        : [];
      const approvedEpisodes = ledger
        ? []
        : ((await episodes.listOwned(actor.userId, projectId)) ?? []).filter(
            (episode) => episode.status === "story_approved" || episode.status === "completed"
          );
      return {
        ledger,
        proposedDevelopments,
        canRebuild: Boolean(ledger === null && approvedEpisodes.length > 0),
      };
    },

    /**
     * Rebuild the Continuity Ledger from approved material only.
     *
     * This exists for seasons whose episodes were approved before CASNA started
     * recording continuity. It replays the approved Season Plan entry and the
     * approved screenplay for each approved episode in order. It never reads an
     * unapproved draft, and it is a no-op when a ledger already exists.
     */
    async rebuild(
      actor: RequestAuth,
      projectId: string,
      options: { dryRun?: boolean; force?: boolean } = {}
    ): Promise<RebuildResult> {
      if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
      const project = await projects.findOwned(actor.userId, projectId);
      if (!project) throw new StudioError("Project not found", 404, "not_found");
      const existing = await ledgers.findLatest(actor.userId, projectId);
      if (existing && !options.force) {
        return { replayedEpisodes: 0, created: false, ledger: existing };
      }
      const plan = await plans.findApproved(actor.userId, projectId);
      if (!plan) {
        throw new StudioError(
          "Approve a Season Plan before rebuilding continuity.",
          409,
          "season_plan_required"
        );
      }
      const approved = ((await episodes.listOwned(actor.userId, projectId)) ?? [])
        .filter((episode) => episode.status === "story_approved" || episode.status === "completed")
        .sort((a, b) => a.episodeNumber - b.episodeNumber);
      if (approved.length === 0) {
        throw new StudioError(
          "There are no approved episodes to rebuild continuity from.",
          409,
          "no_approved_episodes"
        );
      }
      return replay(
        actor.userId,
        projectId,
        plan,
        approved,
        options.force ? null : existing,
        options.dryRun ?? false
      );
    },

    /**
     * CASNA Stage I: promote an approved episode into established canon.
     *
     * Called only after the creator has approved the episode's screenplay, and
     * only with that approved story. It saves the authoritative summary, merges
     * the extracted facts into the Continuity Ledger, and returns the new ledger
     * version. A failure throws so the caller can roll the approval back.
     */
    async onEpisodeApproved(input: {
      clerkUserId: string;
      projectId: string;
      episodeNumber: number;
      story: StoryRecord;
    }): Promise<ContinuityLedgerRecord | null> {
      const { clerkUserId, projectId, episodeNumber, story } = input;
      const plan = await plans.findApproved(clerkUserId, projectId);
      if (!plan) {
        log.info("continuity", "no approved season plan; canon ledger unchanged", {
          projectId,
          episodeNumber,
        });
        return null;
      }
      const existing = await ledgers.findLatest(clerkUserId, projectId);
      // Approval is retried by the caller when a later step fails. The ledger is
      // already current for this episode in that case, so do not apply it twice.
      if (existing && existing.asOfEpisode >= episodeNumber) {
        return existing;
      }
      const episodePlan =
        story.plan ??
        deriveEpisodePlan({
          plan,
          ledger: existing,
          previousEpisode: null,
          episodeNumber,
        });
      const summary = extractEpisodeCanon({
        episodeNumber,
        story,
        plan,
        episodePlan,
        ledger: existing,
      });
      await stories.saveCanonSummary(clerkUserId, story.id, summary);
      const merged = applyCanonToLedger(existing, summary);
      const saved = await ledgers.upsert({
        ...merged,
        clerkUserId,
        projectId,
        asOfEpisode: episodeNumber,
        basedOnPlanVersion: plan.version,
      });
      log.info("continuity", "ledger updated after episode approval", {
        projectId,
        episodeNumber,
        ledgerVersion: saved.version,
        eventCount: saved.events.length,
        characterCount: saved.characterStates.length,
      });
      return saved;
    },
  };
}

export const continuityService = createContinuityService();
