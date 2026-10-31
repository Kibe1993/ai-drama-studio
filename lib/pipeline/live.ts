import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";
import { createBullQueue } from "@/lib/pipeline/bullQueue";
import { createMockEngines } from "@/lib/pipeline/mockEngines";
import type { PipelineDeps } from "@/lib/pipeline/ports";
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
  const connection = createRedisConnection();
  return {
    projects: projectRepository,
    runs: productionRunRepository,
    jobs: generationJobRepository,
    queue: connection ? createBullQueue(connection) : unavailableQueue(),
    engines: createMockEngines(),
  };
}
