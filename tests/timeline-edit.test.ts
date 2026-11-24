import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/repositories/timelineRepository", () => ({
  timelineRepository: {
    findByEpisode: vi.fn(),
    findOwned: vi.fn(),
    create: vi.fn(),
    updateTracks: vi.fn(),
    updateSettings: vi.fn(),
    updateValidation: vi.fn(),
    approve: vi.fn(),
    markStale: vi.fn(),
    setStatus: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/mediaAssetRepository", () => ({
  mediaAssetRepository: {
    listProject: vi.fn(),
    findOwned: vi.fn(),
  },
}));

vi.mock("@/lib/repositories/episodeRepository", () => ({
  episodeRepository: {
    findOwned: vi.fn(),
  },
}));

import { timelineRepository } from "@/lib/repositories/timelineRepository";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { createTimelineEditService } from "@/lib/services/timelineEditService";
import type { TimelineTrack, TimelineClip } from "@/lib/validation/timeline";

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    assetId: "a1",
    startSeconds: 0,
    durationSeconds: 5,
    audioOffsetSeconds: 0,
    transition: "",
    optional: false,
    title: "",
    sceneNumber: null,
    shotNumber: null,
    trimStartSeconds: 0,
    trimEndSeconds: null,
    volume: 1,
    ...overrides,
  };
}

function makeTimeline(overrides: Record<string, unknown> = {}) {
  return {
    id: "a".repeat(24),
    clerkUserId: "u1",
    projectId: "b".repeat(24),
    episodeId: "c".repeat(24),
    tracks: [] as TimelineTrack[],
    aspectRatio: "16:9",
    outputResolution: "1920x1080",
    frameRate: 30,
    episodeTargetDurationSeconds: null,
    status: "draft" as const,
    validation: { missingAssets: [], overlaps: [], brokenReferences: [], durationMismatch: false, warnings: [] },
    idempotencyKey: "timeline:p1:e1",
    sourceCanonVersion: null,
    canonStale: false,
    canonStaleReason: "",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("timeline edit service", () => {
  const service = createTimelineEditService();
  const actor = { userId: "u1" };
  const PID = "b".repeat(24);
  const EID = "c".repeat(24);
  const TID = "a".repeat(24);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validate", () => {
    it("passes a clean timeline", () => {
      const tracks: TimelineTrack[] = [{
        kind: "video",
        clips: [
          makeClip({ assetId: "a1", startSeconds: 0, durationSeconds: 5 }),
          makeClip({ assetId: "a2", startSeconds: 5, durationSeconds: 3 }),
        ],
      }];
      const result = service.validate(tracks, 8, new Set(["a1", "a2"]));
      expect(result.missingAssets).toHaveLength(0);
      expect(result.overlaps).toHaveLength(0);
      expect(result.durationMismatch).toBe(false);
    });

    it("detects overlapping clips", () => {
      const tracks: TimelineTrack[] = [{
        kind: "video",
        clips: [
          makeClip({ assetId: "a1", startSeconds: 0, durationSeconds: 5 }),
          makeClip({ assetId: "a2", startSeconds: 3, durationSeconds: 3 }),
        ],
      }];
      const result = service.validate(tracks, null, new Set(["a1", "a2"]));
      expect(result.overlaps).toHaveLength(1);
    });

    it("detects missing assets", () => {
      const tracks: TimelineTrack[] = [{
        kind: "video",
        clips: [makeClip({ assetId: "unknown", startSeconds: 0, durationSeconds: 5 })],
      }];
      const result = service.validate(tracks, null, new Set(["a1"]));
      expect(result.missingAssets).toContain("unknown");
    });

    it("does not flag optional clips as missing", () => {
      const tracks: TimelineTrack[] = [{
        kind: "music",
        clips: [makeClip({ assetId: "opt", startSeconds: 0, durationSeconds: 5, optional: true })],
      }];
      const result = service.validate(tracks, null, new Set());
      expect(result.missingAssets).not.toContain("opt");
    });

    it("detects duration mismatch", () => {
      const tracks: TimelineTrack[] = [{
        kind: "video",
        clips: [makeClip({ assetId: "a1", startSeconds: 0, durationSeconds: 5 })],
      }];
      const result = service.validate(tracks, 20, new Set(["a1"]));
      expect(result.durationMismatch).toBe(true);
    });
  });

  describe("getEditableTimeline", () => {
    it("returns timeline and available assets", async () => {
      vi.mocked(timelineRepository.findByEpisode).mockResolvedValue(makeTimeline() as never);
      vi.mocked(mediaAssetRepository.listProject).mockResolvedValue([
        { id: "v1", type: "scene_video", fileName: "scene1.mp4", durationSeconds: 10, storageKey: "v1" } as never,
        { id: "d1", type: "dialogue_audio", fileName: "dialog1.wav", durationSeconds: 5, storageKey: "d1" } as never,
        { id: "m1", type: "music", fileName: "bg.mp3", durationSeconds: 30, storageKey: "m1" } as never,
      ] as never);

      const result = await service.getEditableTimeline(actor, PID, EID);
      expect(result.timeline).not.toBeNull();
      expect(result.availableAssets.video).toHaveLength(1);
      expect(result.availableAssets.dialogue).toHaveLength(1);
      expect(result.availableAssets.music).toHaveLength(1);
      expect(result.availableAssets.sfx).toHaveLength(0);
    });

    it("returns null timeline when none exists", async () => {
      vi.mocked(timelineRepository.findByEpisode).mockResolvedValue(null);
      vi.mocked(mediaAssetRepository.listProject).mockResolvedValue(null);

      const result = await service.getEditableTimeline(actor, PID, EID);
      expect(result.timeline).toBeNull();
      expect(result.availableAssets.video).toHaveLength(0);
    });
  });

  describe("createEmpty", () => {
    it("creates an empty timeline for an episode", async () => {
      vi.mocked(episodeRepository.findOwned).mockResolvedValue({ id: EID, projectId: PID } as never);
      vi.mocked(timelineRepository.findByEpisode).mockResolvedValue(null);
      vi.mocked(timelineRepository.create).mockResolvedValue(makeTimeline() as never);

      const result = await service.createEmpty(actor, PID, EID);
      expect(timelineRepository.create).toHaveBeenCalledOnce();
      expect(result.status).toBe("draft");
    });

    it("marks existing timeline as stale", async () => {
      vi.mocked(episodeRepository.findOwned).mockResolvedValue({ id: EID, projectId: PID } as never);
      vi.mocked(timelineRepository.findByEpisode).mockResolvedValue(makeTimeline({ id: "d".repeat(24) }) as never);
      vi.mocked(timelineRepository.markStale).mockResolvedValue(null);
      vi.mocked(timelineRepository.create).mockResolvedValue(makeTimeline() as never);

      await service.createEmpty(actor, PID, EID);
      expect(timelineRepository.markStale).toHaveBeenCalledWith("u1", "d".repeat(24));
    });
  });

  describe("update", () => {
    it("updates tracks and re-validates", async () => {
      const existing = makeTimeline({ status: "draft" });
      const updated = makeTimeline({ status: "under_review" });
      vi.mocked(timelineRepository.findOwned).mockResolvedValueOnce(existing as never);
      vi.mocked(timelineRepository.updateTracks).mockResolvedValue(updated as never);
      vi.mocked(timelineRepository.updateValidation).mockResolvedValue(updated as never);
      vi.mocked(timelineRepository.findOwned).mockResolvedValueOnce(updated as never);

      const tracks: TimelineTrack[] = [{
        kind: "video",
        clips: [makeClip({ assetId: "a1", startSeconds: 0, durationSeconds: 5 })],
      }];

      const result = await service.update(actor, TID, { tracks }, new Set(["a1"]));
      expect(timelineRepository.updateTracks).toHaveBeenCalledOnce();
      expect(timelineRepository.updateValidation).toHaveBeenCalledOnce();
      expect(result.status).toBe("under_review");
    });

    it("rejects update to approved timeline", async () => {
      vi.mocked(timelineRepository.findOwned).mockResolvedValue(makeTimeline({ status: "approved" }) as never);

      await expect(
        service.update(actor, TID, { tracks: [] }, new Set())
      ).rejects.toThrow("Cannot edit an approved timeline");
    });

    it("updates settings without touching tracks", async () => {
      vi.mocked(timelineRepository.findOwned).mockResolvedValue(makeTimeline() as never);
      vi.mocked(timelineRepository.updateSettings).mockResolvedValue(
        makeTimeline({ aspectRatio: "9:16" }) as never
      );

      const result = await service.update(actor, TID, { aspectRatio: "9:16" }, new Set());
      expect(timelineRepository.updateSettings).toHaveBeenCalledOnce();
      expect(timelineRepository.updateTracks).not.toHaveBeenCalled();
      expect(result.aspectRatio).toBe("9:16");
    });
  });

  describe("approve", () => {
    it("approves a valid non-empty timeline", async () => {
      vi.mocked(timelineRepository.findOwned).mockResolvedValue(makeTimeline({
        tracks: [{ kind: "video", clips: [makeClip()] }],
        status: "under_review",
      }) as never);
      vi.mocked(timelineRepository.approve).mockResolvedValue(makeTimeline({ status: "approved" }) as never);

      const result = await service.approve(actor, TID);
      expect(timelineRepository.approve).toHaveBeenCalledOnce();
      expect(result.status).toBe("approved");
    });

    it("rejects approval of empty timeline", async () => {
      vi.mocked(timelineRepository.findOwned).mockResolvedValue(makeTimeline({ tracks: [] }) as never);

      await expect(service.approve(actor, TID)).rejects.toThrow("Cannot approve an empty timeline");
    });

    it("rejects approval with missing assets", async () => {
      vi.mocked(timelineRepository.findOwned).mockResolvedValue(makeTimeline({
        tracks: [{ kind: "video", clips: [makeClip({ assetId: "missing" })] }],
        validation: { missingAssets: ["missing"], overlaps: [], brokenReferences: [], durationMismatch: false, warnings: [] },
      }) as never);

      await expect(service.approve(actor, TID)).rejects.toThrow("Cannot approve timeline with blocking validation errors");
    });
  });
});