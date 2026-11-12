import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { isObjectId } from "@/lib/repositories/ownership";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { StudioError } from "@/lib/http/errors";
import type { EpisodeInput } from "@/lib/validation/episode";

type EpisodePort = Pick<typeof episodeRepository, "listOwned" | "create">;
type ProjectPort = Pick<typeof projectRepository, "findOwned">;
type RunPort = Pick<typeof productionRunRepository, "findLatest">;
type BiblePort = Pick<typeof storyBibleRepository, "findOwned">;
const ACTIVE_RUNS = new Set(["pending", "running", "waiting_for_approval"]);

export function createEpisodeService(episodes: EpisodePort, projects: ProjectPort, runs: RunPort, bibles: BiblePort) {
  function validateProjectId(projectId: string) {
    if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
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
      if (existing.length > 0 && project.productionMode === "serialized" && snapshotVersion === 0) {
        throw new StudioError("Approve a Story Bible snapshot before creating the next serialized episode", 409, "canon_required");
      }
      const episode = await episodes.create(actor.userId, projectId, input, snapshotVersion);
      if (!episode) throw new StudioError("Project not found", 404, "not_found");
      return episode;
    },
  };
}

export const episodeService = createEpisodeService(episodeRepository, projectRepository, productionRunRepository, storyBibleRepository);
