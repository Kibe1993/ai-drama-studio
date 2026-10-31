import { JobError, type EngineSet, type JobRecord, type JobType, type RunRecord } from "@/lib/pipeline/types";

/**
 * Stand-in engines. They return fixed production data and never call a provider.
 * Tests use `failNext` to force a transient or permanent failure.
 */
export function createMockEngines(): EngineSet {
  const failures = new Map<JobType, { remaining: number; retryable: boolean }>();

  return {
    failNext(jobType, times, retryable) {
      failures.set(jobType, { remaining: times, retryable });
    },
    async run(job: JobRecord, run: RunRecord) {
      const pending = failures.get(job.jobType);
      if (pending && pending.remaining > 0) {
        pending.remaining -= 1;
        throw new JobError(
          pending.retryable ? "The stage timed out" : "The stage was rejected",
          pending.retryable ? "timeout" : "rejected",
          pending.retryable
        );
      }

      if (job.jobType === "story.generate") {
        return {
          title: run.stageResults.story?.title ?? "A private meeting",
          synopsis: "Two people keep meeting after the family forbids it.",
        };
      }
      if (job.jobType === "character.extract") {
        return { names: ["Amara", "Julian", "Mr. Adeyemi"] };
      }
      if (job.jobType === "scene.breakdown") {
        return {
          items: [
            { sceneNumber: 1, title: "The refusal", videoReady: false, failed: false },
            { sceneNumber: 2, title: "The secret", videoReady: false, failed: false },
          ],
        };
      }
      if (job.jobType === "video.scene") {
        return { sceneNumber: job.sceneNumber, referenceUsed: false };
      }
      return { ready: true };
    },
  };
}
