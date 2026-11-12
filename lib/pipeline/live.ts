import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { createBullQueue } from "@/lib/pipeline/bullQueue";
import { createLiveEngines } from "@/lib/pipeline/liveEngines";
import type { PipelineDeps } from "@/lib/pipeline/ports";
import { createStoryProvider } from "@/lib/providers/llm/registry";
import { createRedisConnection } from "@/lib/pipeline/redis";
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
  return {
    projects: projectRepository,
    runs: productionRunRepository,
    jobs: generationJobRepository,
    stories: storyRepository,
    queue: connection ? createBullQueue(connection) : unavailableQueue(),
    engines: createLiveEngines({
      llm: createStoryProvider(),
      stories: storyRepository,
      projects: projectRepository,
      onStoryStatus: async (job, message) => {
        const current = await generationJobRepository.findById(job.id);
        if (!current || current.status !== "processing") return;
        current.progress = { stage: current.jobType, message };
        await generationJobRepository.save(current);
      },
    }),
  };
}
