import "server-only";
import { StudioError } from "@/lib/http/errors";
import { timelineRepository } from "@/lib/repositories/timelineRepository";
import { renderJobRepository } from "@/lib/repositories/renderJobRepository";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { getPreset } from "@/lib/providers/media/ffmpeg/presets";
import { stageMessage } from "@/lib/pipeline/messages";
import type { RenderJobRecord } from "@/lib/validation/renderJob";

export type EnqueueFn = (job: { id: string; jobType: string; maxAttempts: number }) => Promise<void>;

function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new StudioError("Resource not found", 404, "not_found");
  }
}

export function createRenderService(enqueue?: EnqueueFn) {
  return {
    async triggerRender(
      actor: { userId: string },
      timelineId: string,
      presetId: string
    ): Promise<RenderJobRecord> {
      assertObjectId(timelineId);
      const preset = getPreset(presetId);
      if (!preset) throw new StudioError("Unknown render preset", 400, "invalid_preset");

      const timeline = await timelineRepository.findOwned(actor.userId, timelineId);
      if (!timeline) throw new StudioError("Timeline not found", 404, "not_found");
      if (timeline.status !== "approved") {
        throw new StudioError("Timeline must be approved before rendering", 409, "timeline_not_approved");
      }

      const inputAssetIds: string[] = [];
      for (const track of timeline.tracks) {
        for (const clip of track.clips) {
          if (!inputAssetIds.includes(clip.assetId)) {
            inputAssetIds.push(clip.assetId);
          }
        }
      }

      const idempotencyKey = `render:${timelineId}:${presetId}`;
      const renderJob = await renderJobRepository.create(actor.userId, {
        projectId: timeline.projectId,
        episodeId: timeline.episodeId,
        timelineId,
        presetId,
        inputAssetIds,
        outputAssetId: null,
        renderSettings: {
          width: preset.width,
          height: preset.height,
          frameRate: preset.frameRate,
          videoCodec: preset.videoCodec,
          audioCodec: preset.audioCodec,
        },
        ffmpegVersion: null,
        renderDurationSeconds: null,
        status: "queued",
        error: null,
        idempotencyKey,
        bullJobId: null,
        startedAt: null,
        completedAt: null,
      });

      const job = await generationJobRepository.insert({
        clerkUserId: actor.userId,
        projectId: timeline.projectId,
        runId: null,
        sceneNumber: null,
        jobType: "render.final",
        provider: "ffmpeg",
        model: preset.id,
        input: { renderJobId: renderJob.id, timelineId, presetId },
        output: null,
        status: "queued",
        progress: { stage: "render.final", message: stageMessage({ jobType: "render.final", sceneNumber: null }) },
        attempts: 0,
        maxAttempts: 1,
        error: null,
        idempotencyKey: `renderjob:${renderJob.id}`,
        bullJobId: null,
        startedAt: null,
        completedAt: null,
      });

      if (enqueue) {
        try {
          await enqueue(job);
          await generationJobRepository.save({ ...job, bullJobId: job.id });
        } catch {
          // Queue unavailable — job stays queued and will be reconciled
        }
      }

      return renderJob;
    },

    async recordCompletion(
      actor: { userId: string },
      renderJobId: string,
      output: { outputAssetId: string; ffmpegVersion: string; renderDurationSeconds: number }
    ): Promise<RenderJobRecord | null> {
      assertObjectId(renderJobId);
      const completed = await renderJobRepository.markCompleted(actor.userId, renderJobId, output);
      if (completed) {
        await episodeRepository.setRenderAsset(
          actor.userId,
          completed.projectId,
          completed.episodeId,
          output.outputAssetId
        );
      }
      return completed;
    },

    async cancel(actor: { userId: string }, renderJobId: string): Promise<RenderJobRecord | null> {
      assertObjectId(renderJobId);
      const job = await renderJobRepository.findOwned(actor.userId, renderJobId);
      if (!job) throw new StudioError("Render job not found", 404, "not_found");
      if (job.status === "completed") {
        throw new StudioError("Cannot cancel a completed render", 409, "already_completed");
      }
      return renderJobRepository.markCancelled(actor.userId, renderJobId);
    },

    async getStatus(actor: { userId: string }, renderJobId: string): Promise<RenderJobRecord | null> {
      assertObjectId(renderJobId);
      return renderJobRepository.findOwned(actor.userId, renderJobId);
    },

    async findByTimeline(actor: { userId: string }, timelineId: string): Promise<RenderJobRecord[]> {
      assertObjectId(timelineId);
      return renderJobRepository.findByTimeline(actor.userId, timelineId);
    },
  };
}

export type RenderService = ReturnType<typeof createRenderService>;