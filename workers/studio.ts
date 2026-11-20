import { log } from "@/lib/log";
import { loadEnvConfig } from "@next/env";
import { UnrecoverableError, Worker } from "bullmq";
import { connectDB } from "@/lib/db/connect";
import { livePipelineDeps, liveCanonExtractionDispatcher } from "@/lib/pipeline/live";
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

const CANON_DISPATCHER_INTERVAL_MS = 30_000;
const CANON_DISPATCHER_BATCH_LIMIT = 20;

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

  const workers: Worker[] = [];
  const ollamaPrimary = process.env.LLM_PROVIDER?.trim() === "ollama";
  for (const name of QUEUE_NAMES) {
    const concurrency =
      name === "studio-render" || name === "studio-video" ? 1 :
      name === "studio-llm" && ollamaPrimary ? 1 : 2;
    workers.push(new Worker(name, handler, { connection, concurrency }));
    log.info("worker", "listening", { queue: name, concurrency });
  }

  const dispatcher = liveCanonExtractionDispatcher();
  let dispatcherRunning = false;
  const dispatcherTick = async () => {
    if (dispatcherRunning) return;
    dispatcherRunning = true;
    try {
      const result = await dispatcher.runGlobal({
        limit: CANON_DISPATCHER_BATCH_LIMIT,
      });
      if (result.enqueued > 0 || result.dispatched > 0) {
        log.info("worker", "canon dispatcher tick", {
          enqueued: result.enqueued,
          dispatched: result.dispatched,
          succeeded: result.succeeded,
          failed: result.failed,
        });
      }
    } catch (error) {
      log.error("worker", "canon dispatcher tick failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      dispatcherRunning = false;
    }
  };

  const dispatcherTimer = setInterval(dispatcherTick, CANON_DISPATCHER_INTERVAL_MS);
  log.info("worker", "canon dispatcher scheduled", {
    intervalMs: CANON_DISPATCHER_INTERVAL_MS,
    batchLimit: CANON_DISPATCHER_BATCH_LIMIT,
  });

  const shutdown = async (signal: string) => {
    log.info("worker", "shutting down", { signal });
    clearInterval(dispatcherTimer);
    await Promise.allSettled(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  log.error("worker", failureMessage(error));
  process.exit(1);
});
