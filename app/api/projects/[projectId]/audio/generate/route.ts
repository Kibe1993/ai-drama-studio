import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData, errorResponse } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { audioSegmentRepository } from "@/lib/repositories/audioSegmentRepository";
import { KokoroAudioProvider } from "@/lib/providers/media/audio/kokoro";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createTtsOrchestrationService } from "@/lib/services/ttsOrchestrationService";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { stageMessage } from "@/lib/pipeline/messages";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const generateSchema = z.object({
  runId: objectId,
  storyId: objectId,
  episodeId: objectId.nullable().optional(),
});

type Context = { params: Promise<{ projectId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const parsed = generateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the request");
    }
    const { runId, storyId, episodeId } = parsed.data;

    const run = await productionRunRepository.findOwned(actor.userId, runId);
    if (!run || run.projectId !== projectId) {
      return errorResponse(404, "not_found", "Production run not found");
    }

    const story = await storyRepository.findOwned(actor.userId, storyId);
    if (!story || story.projectId !== projectId || story.status !== "approved") {
      return errorResponse(409, "story_required", "An approved story is required");
    }

    const existing = await audioSegmentRepository.listByRun(actor.userId, runId);
    if (existing.length > 0) {
      const progress = await audioSegmentRepository.countByRun(actor.userId, runId);
      return jsonData({ segments: existing, progress, reused: true });
    }

    const audioProvider = new KokoroAudioProvider();
    const storage = createStorageProvider();
    const ttsService = createTtsOrchestrationService({ audioProvider, storage });

    const { segments } = await ttsService.prepareAudioGeneration(actor, {
      projectId,
      runId,
      storyId,
      episodeId: episodeId ?? null,
      screenplay: story.screenplay,
    });

    const deps = livePipelineDeps();
    let enqueued = 0;
    for (const segment of segments) {
      const jobType = segment.kind === "dialogue" ? "audio.dialogue" : "audio.narration";
      const idempotencyKey = `audio-job:${segment.id}`;
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
          episodeId: episodeId ?? null,
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
        log.error("api", "audio job enqueue failed", {
          segmentId: segment.id,
          detail: error instanceof Error ? error.message : "enqueue failed",
        });
      }
    }

    const progress = await audioSegmentRepository.countByRun(actor.userId, runId);
    log.info("api", "audio generation started", {
      projectId,
      runId,
      segments: segments.length,
      enqueued,
    });

    return jsonData({ segments, progress, enqueued }, 201);
  });
}