import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { productionSceneRepository } from "@/lib/repositories/productionSceneRepository";
import { continuityRepository } from "@/lib/repositories/continuityRepository";
import { createBullQueue } from "@/lib/pipeline/bullQueue";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import { createStoryProvider } from "@/lib/providers/llm/registry";
import { createRedisConnection } from "@/lib/pipeline/redis";
import { createStoryBibleEngine } from "@/lib/pipeline/storyBibleEngine";
import type { JobQueue } from "@/lib/pipeline/types";

function unavailableQueue(): JobQueue {
  return {
    async enqueue() {
      throw new Error("queue_unavailable");
    },
  };
}

export function livePipelineDeps(): PipelineDeps {
  if (cachedDeps) return cachedDeps;
  cachedDeps = buildLivePipelineDeps();
  return cachedDeps;
}

let cachedDeps: PipelineDeps | null = null;

function buildLivePipelineDeps(): PipelineDeps {
  const connection = createRedisConnection();
  const llm = createStoryProvider();
  return {
    projects: projectRepository,
    runs: productionRunRepository,
    jobs: generationJobRepository,
    stories: storyRepository,
    episodes: episodeRepository,
    scenes: productionSceneRepository,
    continuity: continuityRepository,
    queue: connection ? createBullQueue(connection) : unavailableQueue(),
    storyBibleEngine: createStoryBibleEngine(llm, storyBibleRepository, async (job, message, output) => {
      const current = await generationJobRepository.findById(job.id);
      if (!current || current.status !== "processing") return;
      current.progress = { stage: current.jobType, message };
      if (output !== undefined) current.output = output;
      await generationJobRepository.save(current);
    }),
    engines: createLiveEngines({
      llm,
      stories: storyRepository,
      projects: projectRepository,
      storyBible: storyBibleRepository,
      continuity: continuityRepository,
      onStoryStatus: async (job, message) => {
        const current = await generationJobRepository.findById(job.id);
        if (!current || current.status !== "processing") return;
        current.progress = { stage: current.jobType, message };
        await generationJobRepository.save(current);
      },
    }),
  };
}
