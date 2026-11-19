import { log } from "@/lib/log";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { canonExtractionOutboxRepository } from "@/lib/repositories/canonExtractionOutboxRepository";


type EpisodePort = Pick<
  typeof episodeRepository,
  "findOwned" | "updateCanonExtractionStatus" | "findApprovedWithoutExtraction" | "findExtractionProcessing" | "findAllExtractionCandidates"
>;

type StoryPort = Pick<typeof storyRepository, "findOwned">;

type OutboxPort = Pick<
  typeof canonExtractionOutboxRepository,
  "enqueue" | "claimPending" | "claimPendingGlobal" | "markCompleted" | "markFailed" | "findPending"
>;

type ExtractionPort = {
  extractAndCommit(input: {
    clerkUserId: string;
    projectId: string;
    episodeId: string;
    storyId: string;
    episodeNumber: number;
    jobId: string;
  }): Promise<{ committed: number; issues: number; status: string }>;
};

export function createCanonExtractionDispatcher(
  extraction: ExtractionPort,
  episodes: EpisodePort = episodeRepository,
  stories: StoryPort = storyRepository,
  outbox: OutboxPort = canonExtractionOutboxRepository,
) {
  return {
    async reconcileCrashes(input: {
      clerkUserId: string;
      projectId: string;
    }): Promise<{ enqueued: number }> {
      let enqueued = 0;

      const processing = await episodes.findExtractionProcessing(
        input.clerkUserId,
        input.projectId,
      );
      for (const ep of processing) {
        if (!ep.currentStoryId) continue;
        const story = await stories.findOwned(input.clerkUserId, ep.currentStoryId);
        if (!story || story.status !== "approved") continue;

        const commitBatchId = `canon-extract-crash-recovery:${ep.id}:${story.id}`;
        const result = await outbox.enqueue({
          clerkUserId: input.clerkUserId,
          projectId: input.projectId,
          episodeId: ep.id,
          storyId: story.id,
          commitBatchId,
        });
        if (result.enqueued) {
          enqueued += 1;
          log.info("canon-dispatcher", "recovered orphaned extraction status", {
            episodeId: ep.id,
          });
        }
      }

      const approved = await episodes.findApprovedWithoutExtraction(
        input.clerkUserId,
        input.projectId,
      );
      for (const ep of approved) {
        if (!ep.currentStoryId) continue;
        const story = await stories.findOwned(input.clerkUserId, ep.currentStoryId);
        if (!story || story.status !== "approved") continue;

        const commitBatchId = `canon-extract-approved:${ep.id}:${story.id}`;
        const result = await outbox.enqueue({
          clerkUserId: input.clerkUserId,
          projectId: input.projectId,
          episodeId: ep.id,
          storyId: story.id,
          commitBatchId,
        });
        if (result.enqueued) {
          enqueued += 1;
          log.info("canon-dispatcher", "enqueued extraction for approved episode", {
            episodeId: ep.id,
          });
        }
      }

      return { enqueued };
    },

    async dispatchPending(input: {
      clerkUserId: string;
      limit?: number;
    }): Promise<{ dispatched: number; succeeded: number; failed: number }> {
      const pending = await outbox.claimPending({
        clerkUserId: input.clerkUserId,
        limit: input.limit,
      });

      let succeeded = 0;
      let failed = 0;

      for (const event of pending) {
        try {
          const episode = await episodes.findOwned(
            input.clerkUserId,
            event.projectId,
            event.episodeId,
          );
          if (!episode) {
            await outbox.markFailed({
              clerkUserId: input.clerkUserId,
              commitBatchId: event.commitBatchId,
              error: "Episode not found.",
            });
            failed += 1;
            continue;
          }

          const result = await extraction.extractAndCommit({
            clerkUserId: input.clerkUserId,
            projectId: event.projectId,
            episodeId: event.episodeId,
            storyId: event.storyId,
            episodeNumber: episode.episodeNumber,
            jobId: `canon-dispatch:${event.commitBatchId}`,
          });

          await outbox.markCompleted({
            clerkUserId: input.clerkUserId,
            commitBatchId: event.commitBatchId,
          });
          succeeded += 1;

          log.info("canon-dispatcher", "dispatched extraction", {
            episodeId: event.episodeId,
            committed: result.committed,
            issues: result.issues,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Dispatch failed.";
          await outbox.markFailed({
            clerkUserId: input.clerkUserId,
            commitBatchId: event.commitBatchId,
            error: message,
          });
          failed += 1;
          log.error("canon-dispatcher", "dispatch failed", {
            episodeId: event.episodeId,
            error: message,
          });
        }
      }

      return { dispatched: pending.length, succeeded, failed };
    },

    async dispatchPendingGlobal(input: {
      limit?: number;
    }): Promise<{ dispatched: number; succeeded: number; failed: number }> {
      const pending = await outbox.claimPendingGlobal({
        limit: input.limit,
      });

      let succeeded = 0;
      let failed = 0;

      for (const event of pending) {
        try {
          const episode = await episodes.findOwned(
            event.clerkUserId,
            event.projectId,
            event.episodeId,
          );
          if (!episode) {
            await outbox.markFailed({
              clerkUserId: event.clerkUserId,
              commitBatchId: event.commitBatchId,
              error: "Episode not found.",
            });
            failed += 1;
            continue;
          }

          const result = await extraction.extractAndCommit({
            clerkUserId: event.clerkUserId,
            projectId: event.projectId,
            episodeId: event.episodeId,
            storyId: event.storyId,
            episodeNumber: episode.episodeNumber,
            jobId: `canon-dispatch:${event.commitBatchId}`,
          });

          await outbox.markCompleted({
            clerkUserId: event.clerkUserId,
            commitBatchId: event.commitBatchId,
          });
          succeeded += 1;

          log.info("canon-dispatcher", "dispatched extraction", {
            episodeId: event.episodeId,
            committed: result.committed,
            issues: result.issues,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Dispatch failed.";
          await outbox.markFailed({
            clerkUserId: event.clerkUserId,
            commitBatchId: event.commitBatchId,
            error: message,
          });
          failed += 1;
          log.error("canon-dispatcher", "dispatch failed", {
            episodeId: event.episodeId,
            error: message,
          });
        }
      }

      return { dispatched: pending.length, succeeded, failed };
    },

    async run(input: {
      clerkUserId: string;
      projectId: string;
      limit?: number;
    }): Promise<{ enqueued: number; dispatched: number; succeeded: number; failed: number }> {
      const { enqueued } = await this.reconcileCrashes({
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
      });
      const { dispatched, succeeded, failed } = await this.dispatchPending({
        clerkUserId: input.clerkUserId,
        limit: input.limit,
      });
      return { enqueued, dispatched, succeeded, failed };
    },

    async runGlobal(input: {
      limit?: number;
    }): Promise<{ enqueued: number; dispatched: number; succeeded: number; failed: number }> {
      const candidates = await episodes.findAllExtractionCandidates();
      let enqueued = 0;
      for (const candidate of candidates) {
        try {
          const result = await this.reconcileCrashes({
            clerkUserId: candidate.clerkUserId,
            projectId: candidate.projectId,
          });
          enqueued += result.enqueued;
        } catch (error) {
          log.error("canon-dispatcher", "reconcileCrashes failed for candidate", {
            clerkUserId: candidate.clerkUserId,
            projectId: candidate.projectId,
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      }

      const { dispatched, succeeded, failed } = await this.dispatchPendingGlobal({
        limit: input.limit,
      });
      return { enqueued, dispatched, succeeded, failed };
    },
  };
}

export const canonExtractionDispatcher = createCanonExtractionDispatcher(
  {} as ExtractionPort,
);