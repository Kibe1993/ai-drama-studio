import "server-only";
import { createHash } from "node:crypto";
import { StudioError } from "@/lib/http/errors";
import { log } from "@/lib/log";
import type { ScreenplayScene } from "@/lib/validation/story";
import { audioSegmentRepository } from "@/lib/repositories/audioSegmentRepository";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { canonProvenance } from "@/lib/domain/narrativeControl/staleness";
import { voiceProfileRepository } from "@/lib/repositories/voiceProfileRepository";
import { canonicalEntityRepository } from "@/lib/repositories/canonicalEntityRepository";
import type { AudioSegmentRecord } from "@/lib/validation/audioSegment";
import { extractDialogueFromScreenplay, validateExtraction } from "@/lib/services/dialogueExtractionService";
import { assignVoices, type ExistingVoiceProfile } from "@/lib/services/voiceAssignmentService";
import type { AudioProvider, AudioGenerationRequest } from "@/lib/providers/media/audio/types";
import type { StorageProvider } from "@/lib/providers/storage/types";
import { createMediaAssetService } from "@/lib/services/mediaAssetService";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";

function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new StudioError("Resource not found", 404, "not_found");
  }
}

function wavDurationSeconds(bytes: Uint8Array): number {
  if (bytes.byteLength < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  if (sampleRate === 0 || byteRate === 0) return 0;
  const dataChunkOffset = 36;
  if (dataChunkOffset + 4 > bytes.byteLength) return 0;
  const dataSize = view.getUint32(dataChunkOffset, true);
  if (dataSize === 0 || byteRate === 0) return 0;
  return dataSize / byteRate;
}

export type TtsOrchestrationDeps = {
  audioProvider: AudioProvider;
  storage: StorageProvider;
};

export function createTtsOrchestrationService(deps: TtsOrchestrationDeps) {
  const mediaAssetService = createMediaAssetService(deps.storage, mediaAssetRepository);

  return {
    async prepareAudioGeneration(
      actor: { userId: string },
      input: {
        projectId: string;
        runId: string;
        storyId: string;
        episodeId: string | null;
        screenplay: ScreenplayScene[];
      }
    ): Promise<{ segments: AudioSegmentRecord[]; speakerNames: string[] }> {
      assertObjectId(input.projectId);
      assertObjectId(input.runId);
      assertObjectId(input.storyId);
      if (input.episodeId) assertObjectId(input.episodeId);

      const extraction = extractDialogueFromScreenplay(input.screenplay);
      validateExtraction(extraction);

      const entities = await canonicalEntityRepository.listByProject(
        actor.userId,
        input.projectId,
        "character"
      );
      const voiceProfiles = await voiceProfileRepository.listByProject(actor.userId, input.projectId);
      const existingProfiles: ExistingVoiceProfile[] = [];
      for (const entity of entities) {
        const profile = voiceProfiles.find((p) => p.canonicalEntityId === entity.id);
        if (profile && profile.voiceIdentifier) {
          existingProfiles.push({
            canonicalEntityId: entity.id,
            voiceIdentifier: profile.voiceIdentifier,
            language: profile.language,
            speakerName: entity.name,
          });
        }
      }

      const assignments = assignVoices(extraction.speakerNames, input.projectId, existingProfiles);
      const entityByName = new Map<string, string>();
      for (const entity of entities) {
        entityByName.set(entity.name.toLowerCase(), entity.id);
      }

      const provenance = canonProvenance(
        await narrativeCanonRepository.latest(actor.userId, input.projectId).then((state) => state?.version ?? null),
      );
      const segmentInputs = extraction.segments.map((seg) => {
        const assignment = assignments.get(seg.speakerName);
        if (!assignment) {
          throw new StudioError(`No voice assignment for ${seg.speakerName}`, 422, "voice_assignment_missing");
        }
        const canonicalEntityId = entityByName.get(seg.speakerName.toLowerCase()) ?? null;
        const idempotencyKey = `audio:${input.runId}:${seg.sceneNumber}:${seg.sequence}:${createHash("sha256").update(seg.text).digest("hex").slice(0, 16)}`;
        return {
          projectId: input.projectId,
          episodeId: input.episodeId,
          runId: input.runId,
          storyId: input.storyId,
          sceneNumber: seg.sceneNumber,
          sequence: seg.sequence,
          speakerType: seg.speakerType,
          speakerName: seg.speakerName,
          canonicalEntityId,
          voiceProfileId: null,
          voiceIdentifier: assignment.voiceIdentifier,
          text: seg.text,
          kind: seg.kind,
          status: "pending" as const,
          mediaAssetId: null,
          durationSeconds: null,
          error: null,
          attempts: 0,
          idempotencyKey,
          ...provenance,
        };
      });

      const segments = await audioSegmentRepository.createMany(actor.userId, segmentInputs);
      log.info("audio", "segments prepared", {
        projectId: input.projectId,
        runId: input.runId,
        count: segments.length,
        speakers: extraction.speakerNames.length,
      });

      return { segments, speakerNames: extraction.speakerNames };
    },

    async generateSegmentAudio(
      actor: { userId: string },
      segmentId: string,
      input: { projectId: string; episodeId: string | null; sceneId: string | null }
    ): Promise<AudioSegmentRecord> {
      assertObjectId(segmentId);
      log.info("audio", "audio.handler.started", { segmentId, projectId: input.projectId });

      const segment = await audioSegmentRepository.findById(actor.userId, segmentId);
      if (!segment) {
        throw new StudioError("Audio segment not found", 404, "not_found");
      }
      log.info("audio", "audio.segment.loaded", {
        segmentId,
        sceneNumber: segment.sceneNumber,
        sequence: segment.sequence,
        speakerName: segment.speakerName,
        kind: segment.kind,
        textLength: segment.text.length,
        status: segment.status,
      });
      if (segment.status === "completed") {
        return segment;
      }

      const claimed = await audioSegmentRepository.markProcessing(actor.userId, segmentId);
      if (!claimed) {
        throw new StudioError("Segment is already being processed", 409, "segment_locked");
      }

      log.info("audio", "audio.provider.selected", {
        segmentId,
        provider: "kokoro",
        voiceIdentifier: segment.voiceIdentifier,
        kind: segment.kind,
      });

      try {
        const request: AudioGenerationRequest = {
          kind: segment.kind,
          text: segment.text,
          voiceProfile: {
            id: segment.voiceProfileId ?? "none",
            provider: "kokoro",
            voiceIdentifier: segment.voiceIdentifier,
            language: "en",
          },
          settings: { language: "en" },
          idempotencyKey: segment.idempotencyKey,
        };

        const result = await deps.audioProvider.generate(request);
        if (result.mock) {
          throw new StudioError("Mock audio is not accepted for real generation", 422, "mock_audio_rejected");
        }

        const durationSeconds = wavDurationSeconds(result.bytes);
        if (durationSeconds <= 0) {
          throw new StudioError("Generated audio has no duration", 422, "invalid_audio_duration");
        }

        log.info("audio", "audio.output.validated", {
          segmentId,
          byteLength: result.bytes.byteLength,
          durationSeconds,
          mimeType: result.mimeType,
        });

        log.info("audio", "audio.storage.started", { segmentId, byteLength: result.bytes.byteLength, durationSeconds });

        const asset = await mediaAssetService.storeVerified(actor.userId, {
          projectId: input.projectId,
          episodeId: input.episodeId,
          sceneId: input.sceneId,
          type: segment.kind === "dialogue" ? "dialogue_audio" : "narration_audio",
          provider: "kokoro",
          model: "kokoro-82m",
          idempotencyKey: segment.idempotencyKey,
          mimeType: "audio/wav",
          fileName: `segment-${segment.sceneNumber}-${segment.sequence}.wav`,
          durationSeconds,
          metadata: {
            segmentId: segment.id,
            speakerName: segment.speakerName,
            voiceIdentifier: segment.voiceIdentifier,
            kind: segment.kind,
          },
        }, result.bytes);

        log.info("audio", "audio.storage.completed", { segmentId, assetId: asset.id, durationSeconds });

        const updated = await audioSegmentRepository.markCompleted(actor.userId, segmentId, {
          mediaAssetId: asset.id,
          durationSeconds,
        });
        if (!updated) {
          throw new StudioError("Failed to mark segment complete", 500, "segment_update_failed");
        }
        log.info("audio", "audio.segment.completed", {
          segmentId,
          sceneNumber: segment.sceneNumber,
          sequence: segment.sequence,
          durationSeconds,
          assetId: asset.id,
        });
        return updated;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await audioSegmentRepository.markFailed(actor.userId, segmentId, message);
        log.error("audio", "audio.segment.failed", {
          segmentId,
          sceneNumber: segment.sceneNumber,
          sequence: segment.sequence,
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: message.slice(0, 300),
          errorStack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
        });
        throw error;
      }
    },

    async listSegments(
      actor: { userId: string },
      runId: string
    ): Promise<AudioSegmentRecord[]> {
      assertObjectId(runId);
      return audioSegmentRepository.listByRun(actor.userId, runId);
    },

    async getProgress(
      actor: { userId: string },
      runId: string
    ): Promise<{
      total: number;
      pending: number;
      processing: number;
      completed: number;
      failed: number;
    }> {
      assertObjectId(runId);
      return audioSegmentRepository.countByRun(actor.userId, runId);
    },

    async retryFailed(
      actor: { userId: string },
      runId: string
    ): Promise<AudioSegmentRecord[]> {
      assertObjectId(runId);
      const failed = await audioSegmentRepository.listByRunAndStatus(actor.userId, runId, "failed");
      const AudioSegment = (await import("@/lib/models/audioSegment")).audioSegmentModel;
      const { connectDB } = await import("@/lib/db/connect");
      const model = AudioSegment(await connectDB());
      for (const segment of failed) {
        await model.updateOne(
          { clerkUserId: actor.userId, _id: segment.id },
          { status: "pending", error: null }
        );
      }
      log.info("audio", "failed segments retried", { runId, count: failed.length });
      return failed;
    },
  };
}

export type TtsOrchestrationService = ReturnType<typeof createTtsOrchestrationService>;