import "server-only";
import { StudioError } from "@/lib/http/errors";
import { timelineRepository } from "@/lib/repositories/timelineRepository";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import type { TimelineRecord, TimelineTrack, ValidationResult, TimelineUpdate } from "@/lib/validation/timeline";
import type { MediaAssetRecord } from "@/lib/validation/mediaAsset";

function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new StudioError("Resource not found", 404, "not_found");
  }
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

export type AvailableAssets = {
  video: MediaAssetRecord[];
  dialogue: MediaAssetRecord[];
  narration: MediaAssetRecord[];
  music: MediaAssetRecord[];
  sfx: MediaAssetRecord[];
  subtitle: MediaAssetRecord[];
};

export type EditableTimeline = {
  timeline: TimelineRecord | null;
  availableAssets: AvailableAssets;
};

function classifyAsset(asset: MediaAssetRecord): keyof AvailableAssets | null {
  switch (asset.type) {
    case "scene_video": return "video";
    case "dialogue_audio": return "dialogue";
    case "narration_audio": return "narration";
    case "music": return "music";
    case "sound_effect": return "sfx";
    case "subtitle": return "subtitle";
    default: return null;
  }
}

export function createTimelineEditService() {
  return {
    async getEditableTimeline(
      actor: { userId: string },
      projectId: string,
      episodeId: string
    ): Promise<EditableTimeline> {
      assertObjectId(projectId);
      assertObjectId(episodeId);

      const timeline = await timelineRepository.findByEpisode(actor.userId, episodeId);

      const assets = await mediaAssetRepository.listProject(actor.userId, projectId);
      const availableAssets: AvailableAssets = {
        video: [], dialogue: [], narration: [], music: [], sfx: [], subtitle: [],
      };
      if (assets) {
        for (const asset of assets) {

          const bucket = classifyAsset(asset);
          if (bucket) availableAssets[bucket].push(asset);
        }
      }

      return { timeline, availableAssets };
    },

    async createEmpty(
      actor: { userId: string },
      projectId: string,
      episodeId: string
    ): Promise<TimelineRecord> {
      assertObjectId(projectId);
      assertObjectId(episodeId);

      const episode = await episodeRepository.findOwned(actor.userId, projectId, episodeId);
      if (!episode) throw new StudioError("Episode not found", 404, "not_found");

      const existing = await timelineRepository.findByEpisode(actor.userId, episodeId);
      if (existing) {
        await timelineRepository.markStale(actor.userId, existing.id);
      }

      return timelineRepository.create(actor.userId, {
        projectId,
        episodeId,
        tracks: [],
        aspectRatio: "16:9",
        outputResolution: "1920x1080",
        frameRate: 30,
        episodeTargetDurationSeconds: null,
        status: "draft",
        validation: { missingAssets: [], overlaps: [], brokenReferences: [], durationMismatch: false, warnings: [] },
        idempotencyKey: `timeline:${projectId}:${episodeId}`,
      });
    },

    async update(
      actor: { userId: string },
      timelineId: string,
      update: TimelineUpdate,
      knownAssetIds: Set<string>
    ): Promise<TimelineRecord> {
      assertObjectId(timelineId);

      const timeline = await timelineRepository.findOwned(actor.userId, timelineId);
      if (!timeline) throw new StudioError("Timeline not found", 404, "not_found");
      if (timeline.status === "approved") {
        throw new StudioError("Cannot edit an approved timeline", 409, "timeline_approved");
      }

      if (update.tracks) {
        const validation = validateTimeline(
          update.tracks,
          update.episodeTargetDurationSeconds ?? timeline.episodeTargetDurationSeconds ?? null,
          knownAssetIds
        );
        const updated = await timelineRepository.updateTracks(actor.userId, timelineId, update.tracks);
        if (!updated) throw new StudioError("Timeline not found", 404, "not_found");
        await timelineRepository.updateValidation(actor.userId, timelineId, validation);
        const withValidation = await timelineRepository.findOwned(actor.userId, timelineId);
        return withValidation ?? updated;
      }

      if (update.aspectRatio || update.outputResolution || update.frameRate || update.episodeTargetDurationSeconds !== undefined) {
        const settings: Record<string, unknown> = {};
        if (update.aspectRatio !== undefined) settings.aspectRatio = update.aspectRatio;
        if (update.outputResolution !== undefined) settings.outputResolution = update.outputResolution;
        if (update.frameRate !== undefined) settings.frameRate = update.frameRate;
        if (update.episodeTargetDurationSeconds !== undefined) settings.episodeTargetDurationSeconds = update.episodeTargetDurationSeconds;
        const updated = await timelineRepository.updateSettings(actor.userId, timelineId, settings);
        if (!updated) throw new StudioError("Timeline not found", 404, "not_found");
        return updated;
      }

      return timeline;
    },

    async approve(actor: { userId: string }, timelineId: string): Promise<TimelineRecord> {
      assertObjectId(timelineId);
      const timeline = await timelineRepository.findOwned(actor.userId, timelineId);
      if (!timeline) throw new StudioError("Timeline not found", 404, "not_found");
      if (timeline.validation.missingAssets.length > 0 || timeline.validation.brokenReferences.length > 0) {
        throw new StudioError("Cannot approve timeline with blocking validation errors", 409, "validation_errors");
      }
      if (timeline.tracks.length === 0) {
        throw new StudioError("Cannot approve an empty timeline", 409, "empty_timeline");
      }
      const approved = await timelineRepository.approve(actor.userId, timelineId);
      if (!approved) throw new StudioError("Timeline not found", 404, "not_found");
      return approved;
    },

    validate(
      tracks: TimelineTrack[],
      targetDurationSeconds: number | null,
      knownAssetIds: Set<string>
    ): ValidationResult {
      return validateTimeline(tracks, targetDurationSeconds, knownAssetIds);
    },
  };
}

export type TimelineEditService = ReturnType<typeof createTimelineEditService>;