import { log } from "@/lib/log";
import { loadEnvConfig } from "@next/env";
import { UnrecoverableError, Worker } from "bullmq";
import { connectDB } from "@/lib/db/connect";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { logLlmSetup } from "@/lib/providers/llm/registry";
import {
  reconcileOpenJobs,
  processGenerationJob,
} from "@/lib/pipeline/processJob";
import { QUEUE_NAMES, createRedisConnection } from "@/lib/pipeline/redis";
import { JobError } from "@/lib/pipeline/types";

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The worker failed to start";
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

  const connection = createRedisConnection();
  if (!connection) {
    throw new Error("REDIS_URL is not set. The worker is not running.");
  }

  try {
    await connection.ping();
    log.info("worker", "redis connected");
  } catch (error) {
    throw new Error(`Redis is unavailable. ${failureMessage(error)}`);
  }

  await connectDB();
  log.info("worker", "mongodb connected");
  logLlmSetup();

  const deps = livePipelineDeps();
  const reconciled = await reconcileOpenJobs(deps);
  log.info("worker", "reconciled open jobs", { count: reconciled });

  const handler = async (bullJob: { data: { generationJobId?: string }; name?: string }) => {
    const id = bullJob.data.generationJobId;
    log.info("worker", "bull job received", { queueJob: bullJob.name ?? "", generationJobId: id ?? "" });
    if (!id) throw new UnrecoverableError("Missing generation job id");
    try {
      await processGenerationJob(deps, id);
    } catch (error) {
      if (error instanceof JobError && error.retryable) throw error;
      const message =
        error instanceof Error ? error.message : "The stage failed";
      throw new UnrecoverableError(message);
    }
  };

  for (const name of QUEUE_NAMES) {
    const concurrency =
      name === "studio-render" || name === "studio-video" ? 1 : 2;
    new Worker(name, handler, { connection, concurrency });
    log.info("worker", "listening", { queue: name, concurrency });
  }
}

main().catch((error: unknown) => {
  log.error("worker", failureMessage(error));
  process.exit(1);
});
