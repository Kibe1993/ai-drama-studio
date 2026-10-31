import { UnrecoverableError, Worker } from "bullmq";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { reconcileOpenJobs, processGenerationJob } from "@/lib/pipeline/processJob";
import { QUEUE_NAMES, createRedisConnection } from "@/lib/pipeline/redis";
import { JobError } from "@/lib/pipeline/types";

const connection = createRedisConnection();
if (!connection) {
  console.error("REDIS_URL is not set. The worker is not running.");
  process.exit(1);
}

const deps = livePipelineDeps();

await reconcileOpenJobs(deps);

const handler = async (bullJob: { data: { generationJobId?: string } }) => {
  const id = bullJob.data.generationJobId;
  if (!id) throw new UnrecoverableError("Missing generation job id");
  try {
    await processGenerationJob(deps, id);
  } catch (error) {
    if (error instanceof JobError && error.retryable) throw error;
    const message = error instanceof Error ? error.message : "The stage failed";
    throw new UnrecoverableError(message);
  }
};

for (const name of QUEUE_NAMES) {
  const concurrency = name === "studio-render" || name === "studio-video" ? 1 : 2;
  new Worker(name, handler, { connection, concurrency });
}

console.log("Drama Studio worker is listening.");
