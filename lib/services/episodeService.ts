import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { isObjectId } from "@/lib/repositories/ownership";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { continuityLedgerRepository } from "@/lib/repositories/continuityLedgerRepository";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { StudioError } from "@/lib/http/errors";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { episodeSuggestionReference } from "@/lib/pipeline/episodeSuggestionContext";
import { stageMessage } from "@/lib/pipeline/messages";
import type { JobQueue } from "@/lib/pipeline/types";
import type { EpisodeInput } from "@/lib/validation/episode";
import {
  episodeGenerationGate,
  nextEpisodeNumber,
  type CasnaGate,
} from "@/lib/domain/casna";

type EpisodePort = Pick<typeof episodeRepository, "listOwned" | "create">;
type ProjectPort = Pick<typeof projectRepository, "findOwned">;
type RunPort = Pick<typeof productionRunRepository, "findLatest">;
type BiblePort = Pick<typeof storyBibleRepository, "findOwned">;
type PlanPort = Pick<typeof seasonPlanRepository, "findApproved" | "findLatest">;
type LedgerPort = Pick<typeof continuityLedgerRepository, "findLatest">;
type JobWriter = Pick<typeof generationJobRepository, "insert" | "listByKeyPrefix" | "save">;
type GenerationPort = { jobs: JobWriter; queueFactory: () => JobQueue | null };
const ACTIVE_RUNS = new Set(["pending", "running", "waiting_for_approval"]);
const OPEN = new Set(["queued", "processing"]);
const MAX_ATTEMPTS = 3;

export function createEpisodeService(
  episodes: EpisodePort,
  projects: ProjectPort,
  runs: RunPort,
  bibles: BiblePort,
  generation: GenerationPort = {
    jobs: generationJobRepository,
    queueFactory: () => livePipelineDeps().queue,
  },
  plans: PlanPort = seasonPlanRepository,
  ledgers: LedgerPort = continuityLedgerRepository,
) {
  function validateProjectId(projectId: string) {
    if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
  }

  /**
   * CASNA Stage E: the backend decides whether an episode may be generated.
   * Serialized dramas need an approved, current Season Plan and every earlier
   * episode approved with the Continuity Ledger caught up. The UI only mirrors
   * this gate; it never authorizes generation on its own.
   */
  async function gateFor(input: {
    clerkUserId: string;
    projectId: string;
    productionMode: string;
    targetEpisodeNumber: number;
    bibleApprovedVersion: number;
    episodes: { episodeNumber: number; status: string }[];
  }): Promise<CasnaGate> {
    const [approvedPlan, latestPlan, ledger] = await Promise.all([
      plans.findApproved(input.clerkUserId, input.projectId),
      plans.findLatest(input.clerkUserId, input.projectId),
      ledgers.findLatest(input.clerkUserId, input.projectId),
    ]);
    return episodeGenerationGate({
      productionMode: input.productionMode,
      bibleApprovedVersion: input.bibleApprovedVersion,
      approvedPlan,
      latestPlan,
      ledger,
      episodes: input.episodes,
      targetEpisodeNumber: input.targetEpisodeNumber,
    });
  }

  return {
    async list(actor: RequestAuth, projectId: string) {
      validateProjectId(projectId);
      const rows = await episodes.listOwned(actor.userId, projectId);
      if (!rows) throw new StudioError("Project not found", 404, "not_found");
      return rows;
    },

    async create(actor: RequestAuth, projectId: string, input: EpisodeInput) {
      validateProjectId(projectId);
      const project = await projects.findOwned(actor.userId, projectId);
      if (!project || project.status === "archived") throw new StudioError("Project not found", 404, "not_found");
      const latestRun = await runs.findLatest(actor.userId, projectId);
      if (latestRun && ACTIVE_RUNS.has(latestRun.status)) {
        throw new StudioError("Finish or stop the active episode before creating another", 409, "episode_run_active");
      }
      const existing = await episodes.listOwned(actor.userId, projectId);
      if (!existing) throw new StudioError("Project not found", 404, "not_found");
      const bible = await bibles.findOwned(actor.userId, projectId);
      const snapshotVersion = bible?.approvedVersion ?? 0;
      // Episodes build on approved canon. The backend refuses to create one
      // before the Story Bible has been approved, for every production mode.
      if (snapshotVersion === 0) {
        throw new StudioError("Approve the Story Bible before creating episodes", 409, "bible_required");
      }
      const targetEpisodeNumber = nextEpisodeNumber(existing);
      const gate = await gateFor({
        clerkUserId: actor.userId,
        projectId,
        productionMode: project.productionMode,
        targetEpisodeNumber,
        bibleApprovedVersion: snapshotVersion,
        episodes: existing,
      });
      if (!gate.allowed) {
        throw new StudioError(gate.reason ?? "This episode is locked.", 409, gate.code);
      }
      const approvedPlan = await plans.findApproved(actor.userId, projectId);
      let episode;
      try {
        episode = await episodes.create(
          actor.userId,
          projectId,
          input,
          snapshotVersion,
          approvedPlan?.version ?? 0
        );
      } catch (error) {
        // A concurrent create won the unique episode-number index. Report a
        // conflict instead of surfacing a duplicate-key failure.
        const name = error instanceof Error ? error.name : "";
        if (name === "MongoServerError") {
          throw new StudioError(
            "Another episode was created at the same time. Reload and try again.",
            409,
            "episode_conflict"
          );
        }
        throw error;
      }
      if (!episode) throw new StudioError("Project not found", 404, "not_found");
      return episode;
    },

    async requestGenerate(actor: RequestAuth, projectId: string) {
      validateProjectId(projectId);
      const project = await projects.findOwned(actor.userId, projectId);
      if (!project || project.status === "archived") throw new StudioError("Project not found", 404, "not_found");
      const latestRun = await runs.findLatest(actor.userId, projectId);
      if (latestRun && ACTIVE_RUNS.has(latestRun.status)) {
        throw new StudioError("Finish or stop the active episode before creating another", 409, "episode_run_active");
      }
      const existing = await episodes.listOwned(actor.userId, projectId);
      if (!existing) throw new StudioError("Project not found", 404, "not_found");
      const bible = await bibles.findOwned(actor.userId, projectId);
      const snapshotVersion = bible?.approvedVersion ?? 0;
      if (snapshotVersion === 0) {
        throw new StudioError("Approve the Story Bible before creating episodes", 409, "bible_required");
      }
      const targetEpisodeNumber = nextEpisodeNumber(existing);
      const gate = await gateFor({
        clerkUserId: actor.userId,
        projectId,
        productionMode: project.productionMode,
        targetEpisodeNumber,
        bibleApprovedVersion: snapshotVersion,
        episodes: existing,
      });
      if (!gate.allowed) {
        throw new StudioError(gate.reason ?? "This episode is locked.", 409, gate.code);
      }
      if (!episodeSuggestionReference(project, bible ?? null)) {
        throw new StudioError("Develop a Story Bible or set a story idea before asking AI to propose an episode.", 409, "reference_required");
      }
      const prefix = `episodeSuggest:${projectId}`;
      const previous = await generation.jobs.listByKeyPrefix(prefix);
      // Duplicate prevention: an open request is returned instead of starting a
      // second generation for the same next episode.
      const open = previous.find((job) => OPEN.has(job.status));
      if (open) return { job: open };
      const queue = generation.queueFactory();
      if (!queue) throw new StudioError("The background job queue is not configured. Set REDIS_URL and start Redis.", 503, "queue_unavailable");
      let job;
      try {
        job = await generation.jobs.insert({
          clerkUserId: actor.userId,
          projectId,
          runId: null,
          sceneNumber: null,
          jobType: "episodeSuggest.generate",
          provider: "pending",
          model: "pending",
          input: { episodeNumber: targetEpisodeNumber },
          output: null,
          status: "queued",
          progress: { stage: "episodeSuggest.generate", message: stageMessage({ jobType: "episodeSuggest.generate", sceneNumber: null }) },
          attempts: 0,
          maxAttempts: MAX_ATTEMPTS,
          error: null,
          idempotencyKey: `${prefix}:${targetEpisodeNumber}:${previous.length + 1}`,
          bullJobId: null,
          startedAt: null,
          completedAt: null,
        });
      } catch (error) {
        const raced = (await generation.jobs.listByKeyPrefix(prefix)).find((item) => OPEN.has(item.status));
        if (raced) return { job: raced };
        const name = error instanceof Error ? error.name : "";
        if (name === "MongoServerError") {
          throw new StudioError(
            "An episode proposal is already starting. Reload and try again.",
            409,
            "generation_in_progress"
          );
        }
        throw error;
      }
      try {
        await queue.enqueue(job);
        job.bullJobId = job.id;
        await generation.jobs.save(job);
      } catch {
        job.status = "failed";
        job.error = { code: "queue_unavailable", message: "The job queue is unavailable.", retryable: false };
        job.completedAt = new Date().toISOString();
        await generation.jobs.save(job);
        throw new StudioError("The episode request could not be queued. Start Redis and try again.", 503, "queue_unavailable");
      }
      return { job };
    },
  };
}

export const episodeService = createEpisodeService(
  episodeRepository,
  projectRepository,
  productionRunRepository,
  storyBibleRepository,
);
