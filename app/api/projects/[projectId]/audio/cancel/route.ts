import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData, errorResponse } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { audioSegmentRepository } from "@/lib/repositories/audioSegmentRepository";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const cancelSchema = z.object({
  runId: objectId,
});

type Context = { params: Promise<{ projectId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const parsed = cancelSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the request");
    }
    const { runId } = parsed.data;

    const cancelledSegments = await audioSegmentRepository.cancelByRun(actor.userId, runId);

    const jobs = await generationJobRepository.listForRun(runId);
    const audioJobs = jobs.filter(
      (job) => (job.jobType === "audio.dialogue" || job.jobType === "audio.narration") &&
        (job.status === "queued" || job.status === "processing")
    );
    for (const job of audioJobs) {
      job.status = "cancelled";
      job.error = { code: "cancelled", message: "Cancelled by user", retryable: false };
      job.completedAt = new Date().toISOString();
      job.progress = { stage: job.jobType, message: "Cancelled" };
      await generationJobRepository.save(job);
    }

    log.info("api", "audio cancelled", {
      projectId,
      runId,
      cancelledSegments,
      cancelledJobs: audioJobs.length,
    });

    return jsonData({ cancelledSegments, cancelledJobs: audioJobs.length });
  });
}