import { Queue, type ConnectionOptions } from "bullmq";
import { queueNameFor } from "@/lib/pipeline/redis";
import type { JobQueue, JobRecord } from "@/lib/pipeline/types";

export function createBullQueue(connection: ConnectionOptions): JobQueue {
  const queues = new Map<string, Queue>();
  return {
    async enqueue(job: Pick<JobRecord, "id" | "jobType" | "maxAttempts">) {
      const name = queueNameFor(job.jobType);
      let queue = queues.get(name);
      if (!queue) {
        queue = new Queue(name, { connection });
        queues.set(name, queue);
      }
      await queue.add(
        job.jobType,
        { generationJobId: job.id },
        {
          jobId: job.id,
          attempts: job.maxAttempts,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 200,
          removeOnFail: 200,
        }
      );
    },
  };
}
