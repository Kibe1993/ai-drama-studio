import "server-only";
import { StudioError } from "@/lib/http/errors";
import { canonProvenance } from "@/lib/domain/narrativeControl/staleness";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { timelineRepository } from "@/lib/repositories/timelineRepository";
import type { TimelineRecord, TimelineTrack, ValidationResult } from "@/lib/validation/timeline";

function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new StudioError("Resource not found", 404, "not_found");
  }
}

export type AssemblyInput = {
  episodeId: string;
  projectId: string;
  videoClips: { assetId: string; durationSeconds: number; sceneNumber: number; shotNumber: number }[];
  dialogueClips?: { assetId: string; durationSeconds: number; startSeconds: number }[];
  musicClips?: { assetId: string; durationSeconds: number; startSeconds: number; volume: number; optional?: boolean }[];
  sfxClips?: { assetId: string; durationSeconds: number; startSeconds: number }[];
  subtitleClips?: { assetId: string; durationSeconds: number; startSeconds: number }[];
  aspectRatio?: string;
  outputResolution?: string;
  frameRate?: number;
  episodeTargetDurationSeconds?: number;
  knownAssetIds?: Set<string>;
};

export function createTimelineAssemblyService() {
  return {
    async autoGenerate(actor: { userId: string }, input: AssemblyInput): Promise<TimelineRecord> {
      assertObjectId(input.episodeId);

      const videoTrack: TimelineTrack = {
        kind: "video",
        clips: [],
      };
      let cumulativeStart = 0;
      for (const clip of input.videoClips) {
        videoTrack.clips.push({
          assetId: clip.assetId,
          startSeconds: cumulativeStart,
          durationSeconds: clip.durationSeconds,
          audioOffsetSeconds: 0,
          transition: "",
          optional: false,
          title: "",
          sceneNumber: clip.sceneNumber,
          shotNumber: clip.shotNumber,
          trimStartSeconds: 0,
          trimEndSeconds: null,
          volume: 1,
        });
        cumulativeStart += clip.durationSeconds;
      }

      const tracks: TimelineTrack[] = [videoTrack];

      if (input.dialogueClips && input.dialogueClips.length > 0) {
        tracks.push({
          kind: "dialogue",
          clips: input.dialogueClips.map((c) => ({
            assetId: c.assetId,
            startSeconds: c.startSeconds,
            durationSeconds: c.durationSeconds,
            audioOffsetSeconds: 0,
            transition: "",
            optional: false,
            title: "",
            sceneNumber: null,
            shotNumber: null,
            trimStartSeconds: 0,
            trimEndSeconds: null,
            volume: 1,
          })),
        });
      }
      if (input.musicClips && input.musicClips.length > 0) {
        tracks.push({
          kind: "music",
          clips: input.musicClips.map((c) => ({
            assetId: c.assetId,
            startSeconds: c.startSeconds,
            durationSeconds: c.durationSeconds,
            audioOffsetSeconds: 0,
            transition: "",
            optional: c.optional ?? false,
            title: "",
            sceneNumber: null,
            shotNumber: null,
            trimStartSeconds: 0,
            trimEndSeconds: null,
            volume: c.volume,
          })),
        });
      }
      if (input.sfxClips && input.sfxClips.length > 0) {
        tracks.push({
          kind: "sfx",
          clips: input.sfxClips.map((c) => ({
            assetId: c.assetId,
            startSeconds: c.startSeconds,
            durationSeconds: c.durationSeconds,
            audioOffsetSeconds: 0,
            transition: "",
            optional: false,
            title: "",
            sceneNumber: null,
            shotNumber: null,
            trimStartSeconds: 0,
            trimEndSeconds: null,
            volume: 1,
          })),
        });
      }
      if (input.subtitleClips && input.subtitleClips.length > 0) {
        tracks.push({
          kind: "subtitle",
          clips: input.subtitleClips.map((c) => ({
            assetId: c.assetId,
            startSeconds: c.startSeconds,
            durationSeconds: c.durationSeconds,
            audioOffsetSeconds: 0,
            transition: "",
            optional: false,
            title: "",
            sceneNumber: null,
            shotNumber: null,
            trimStartSeconds: 0,
            trimEndSeconds: null,
            volume: 1,
          })),
        });
      }

      const knownAssets = input.knownAssetIds ?? new Set<string>();
      const validation = validateTimeline(tracks, input.episodeTargetDurationSeconds ?? null, knownAssets);

      const existing = await timelineRepository.findByEpisode(actor.userId, input.episodeId);
      if (existing) {
        await timelineRepository.markStale(actor.userId, existing.id);
      }
      const provenance = canonProvenance(
        await narrativeCanonRepository.latest(actor.userId, input.projectId).then((state) => state?.version ?? null),
      );

      return timelineRepository.create(actor.userId, {
        projectId: input.projectId,
        episodeId: input.episodeId,
        tracks,
        aspectRatio: input.aspectRatio ?? "16:9",
        outputResolution: input.outputResolution ?? "1920x1080",
        frameRate: input.frameRate ?? 30,
        episodeTargetDurationSeconds: input.episodeTargetDurationSeconds ?? null,
        status: "under_review",
        validation,
        idempotencyKey: `timeline:${input.projectId}:${input.episodeId}`,
        ...provenance,
      });
    },

    validate(tracks: TimelineTrack[], targetDurationSeconds: number | null, knownAssetIds: Set<string>): ValidationResult {
      return validateTimeline(tracks, targetDurationSeconds, knownAssetIds);
    },

    async preview(actor: { userId: string }, episodeId: string): Promise<TimelineRecord | null> {
      assertObjectId(episodeId);
      return timelineRepository.findByEpisode(actor.userId, episodeId);
    },

    async approve(actor: { userId: string }, timelineId: string): Promise<TimelineRecord> {
      assertObjectId(timelineId);
      const timeline = await timelineRepository.findOwned(actor.userId, timelineId);
      if (!timeline) throw new StudioError("Timeline not found", 404, "not_found");
      if (timeline.validation.missingAssets.length > 0 || timeline.validation.brokenReferences.length > 0) {
        throw new StudioError("Cannot approve timeline with blocking validation errors", 409, "validation_errors");
      }
      const approved = await timelineRepository.approve(actor.userId, timelineId);
      if (!approved) throw new StudioError("Timeline not found", 404, "not_found");
      return approved;
    },

    async findByEpisode(actor: { userId: string }, episodeId: string): Promise<TimelineRecord | null> {
      assertObjectId(episodeId);
      return timelineRepository.findByEpisode(actor.userId, episodeId);
    },
  };
}

function validateTimeline(
  tracks: TimelineTrack[],
  targetDurationSeconds: number | null,
  knownAssetIds: Set<string>
): ValidationResult {
  const missingAssets: string[] = [];
  const brokenReferences: string[] = [];
  const overlaps: Record<string, unknown>[] = [];
  const warnings: string[] = [];

  for (const track of tracks) {
    const sortedClips = [...track.clips].sort((a, b) => a.startSeconds - b.startSeconds);
    for (let i = 0; i < sortedClips.length; i++) {
      const clip = sortedClips[i];
      if (!knownAssetIds.has(clip.assetId) && !clip.optional) {
        missingAssets.push(clip.assetId);
      }
      if (knownAssetIds.size > 0 && !knownAssetIds.has(clip.assetId)) {
        brokenReferences.push(clip.assetId);
      }
      if (i > 0) {
        const prev = sortedClips[i - 1];
        const prevEnd = prev.startSeconds + prev.durationSeconds;
        if (clip.startSeconds < prevEnd) {
          overlaps.push({ track: track.kind, clip1: prev.assetId, clip2: clip.assetId, overlap: prevEnd - clip.startSeconds });
        }
      }
    }
  }

  let durationMismatch = false;
  if (targetDurationSeconds !== null && tracks.length > 0) {
    const videoTrack = tracks.find((t) => t.kind === "video");
    if (videoTrack && videoTrack.clips.length > 0) {
      const totalDuration = videoTrack.clips.reduce((sum, c) => sum + c.durationSeconds, 0);
      const diff = Math.abs(totalDuration - targetDurationSeconds);
      if (diff > targetDurationSeconds * 0.1) {
        durationMismatch = true;
        warnings.push(`Video total ${totalDuration.toFixed(1)}s differs from target ${targetDurationSeconds}s by ${diff.toFixed(1)}s`);
      }
    }
  }

  return { missingAssets, overlaps, brokenReferences, durationMismatch, warnings };
}

export type TimelineAssemblyService = ReturnType<typeof createTimelineAssemblyService>;