import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData, errorResponse } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { audioSegmentRepository } from "@/lib/repositories/audioSegmentRepository";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { stageMessage } from "@/lib/pipeline/messages";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const retrySchema = z.object({
  runId: objectId,
});

type Context = { params: Promise<{ projectId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const parsed = retrySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the request");
    }
    const { runId } = parsed.data;

    const failed = await audioSegmentRepository.listByRunAndStatus(actor.userId, runId, "failed");
    if (failed.length === 0) {
      return jsonData({ retried: [], enqueued: 0 });
    }

    const AudioSegment = (await import("@/lib/models/audioSegment")).audioSegmentModel;
    const { connectDB } = await import("@/lib/db/connect");
    const model = AudioSegment(await connectDB());
    for (const segment of failed) {
      await model.updateOne(
        { clerkUserId: actor.userId, _id: segment.id },
        { status: "pending", error: null }
      );
    }

    const deps = livePipelineDeps();
    let enqueued = 0;
    for (const segment of failed) {
      const jobType = segment.kind === "dialogue" ? "audio.dialogue" : "audio.narration";
      const idempotencyKey = `audio-retry:${segment.id}:${Date.now()}`;
      const job = await generationJobRepository.insert({
        clerkUserId: actor.userId,
        projectId,
        runId,
        sceneNumber: segment.sceneNumber,
        jobType,
        provider: "kokoro",
        model: "kokoro-82m",
        input: {
          segmentId: segment.id,
          projectId,
          episodeId: segment.episodeId ?? null,
          sceneId: null,
        },
        output: null,
        status: "queued",
        progress: { stage: jobType, message: stageMessage({ jobType, sceneNumber: segment.sceneNumber }) },
        attempts: 0,
        maxAttempts: 3,
        error: null,
        idempotencyKey,
        bullJobId: null,
        startedAt: null,
        completedAt: null,
      });
      try {
        await deps.queue.enqueue(job);
        job.bullJobId = job.id;
        await generationJobRepository.save(job);
        enqueued += 1;
      } catch (error) {
        log.error("api", "audio retry enqueue failed", {
          segmentId: segment.id,
          detail: error instanceof Error ? error.message : "enqueue failed",
        });
      }
    }

    log.info("api", "audio retry", { projectId, runId, failed: failed.length, enqueued });
    return jsonData({ retried: failed, enqueued });
  });
}