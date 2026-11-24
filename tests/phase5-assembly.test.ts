import { describe, expect, it } from "vitest";
import { createTimelineAssemblyService } from "@/lib/services/timelineAssemblyService";
import type { TimelineTrack } from "@/lib/validation/timeline";

describe("timeline assembly service", () => {
  const service = createTimelineAssemblyService();

  const makeVideoTrack = (clips: { assetId: string; start: number; dur: number }[]): TimelineTrack => ({
    kind: "video",
    clips: clips.map((c) => ({
      assetId: c.assetId,
      startSeconds: c.start,
      durationSeconds: c.dur,
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

  it("validates a clean timeline with no issues", () => {
    const knownAssets = new Set(["a1", "a2", "a3"]);
    const tracks: TimelineTrack[] = [
      makeVideoTrack([
        { assetId: "a1", start: 0, dur: 5 },
        { assetId: "a2", start: 5, dur: 4 },
        { assetId: "a3", start: 9, dur: 3 },
      ]),
    ];
    const result = service.validate(tracks, 12, knownAssets);
    expect(result.missingAssets).toHaveLength(0);
    expect(result.brokenReferences).toHaveLength(0);
    expect(result.overlaps).toHaveLength(0);
    expect(result.durationMismatch).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("detects missing assets not in the known set", () => {
    const knownAssets = new Set(["a1"]);
    const tracks: TimelineTrack[] = [
      makeVideoTrack([
        { assetId: "a1", start: 0, dur: 5 },
        { assetId: "missing", start: 5, dur: 3 },
      ]),
    ];
    const result = service.validate(tracks, 8, knownAssets);
    expect(result.missingAssets).toContain("missing");
    expect(result.brokenReferences).toContain("missing");
  });

  it("detects overlapping clips within a track", () => {
    const knownAssets = new Set(["a1", "a2"]);
    const tracks: TimelineTrack[] = [
      makeVideoTrack([
        { assetId: "a1", start: 0, dur: 5 },
        { assetId: "a2", start: 3, dur: 4 },
      ]),
    ];
    const result = service.validate(tracks, 9, knownAssets);
    expect(result.overlaps).toHaveLength(1);
  });

  it("detects duration mismatch when video total differs from target by more than 10%", () => {
    const knownAssets = new Set(["a1"]);
    const tracks: TimelineTrack[] = [
      makeVideoTrack([{ assetId: "a1", start: 0, dur: 5 }]),
    ];
    const result = service.validate(tracks, 20, knownAssets);
    expect(result.durationMismatch).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("prefers actual clip durations over estimates — no mismatch when actual matches target", () => {
    const knownAssets = new Set(["a1", "a2"]);
    const tracks: TimelineTrack[] = [
      makeVideoTrack([
        { assetId: "a1", start: 0, dur: 7.5 },
        { assetId: "a2", start: 7.5, dur: 4.5 },
      ]),
    ];
    const result = service.validate(tracks, 12, knownAssets);
    expect(result.durationMismatch).toBe(false);
  });

  it("does not flag optional clips as missing assets", () => {
    const knownAssets = new Set(["a1"]);
    const tracks: TimelineTrack[] = [
      makeVideoTrack([{ assetId: "a1", start: 0, dur: 5 }]),
      {
        kind: "music",
        clips: [{
          assetId: "optional-music",
          startSeconds: 0,
          durationSeconds: 5,
          audioOffsetSeconds: 0,
          transition: "",
          optional: true,
          title: "",
          sceneNumber: null,
          shotNumber: null,
          trimStartSeconds: 0,
          trimEndSeconds: null,
          volume: 1,
        }],
      },
    ];
    const result = service.validate(tracks, 5, knownAssets);
    expect(result.missingAssets).not.toContain("optional-music");
  });

  it("validates multiple track types together", () => {
    const knownAssets = new Set(["v1", "d1", "m1", "s1", "sub1"]);
    const tracks: TimelineTrack[] = [
      makeVideoTrack([{ assetId: "v1", start: 0, dur: 10 }]),
      {
        kind: "dialogue",
        clips: [{ assetId: "d1", startSeconds: 0, durationSeconds: 10, audioOffsetSeconds: 0, transition: "", optional: false, title: "", sceneNumber: null, shotNumber: null, trimStartSeconds: 0, trimEndSeconds: null, volume: 1 }],
      },
      {
        kind: "music",
        clips: [{ assetId: "m1", startSeconds: 0, durationSeconds: 10, audioOffsetSeconds: 0, transition: "", optional: false, title: "", sceneNumber: null, shotNumber: null, trimStartSeconds: 0, trimEndSeconds: null, volume: 1 }],
      },
      {
        kind: "sfx",
        clips: [{ assetId: "s1", startSeconds: 2, durationSeconds: 1, audioOffsetSeconds: 0, transition: "", optional: false, title: "", sceneNumber: null, shotNumber: null, trimStartSeconds: 0, trimEndSeconds: null, volume: 1 }],
      },
      {
        kind: "subtitle",
        clips: [{ assetId: "sub1", startSeconds: 0, durationSeconds: 10, audioOffsetSeconds: 0, transition: "", optional: false, title: "", sceneNumber: null, shotNumber: null, trimStartSeconds: 0, trimEndSeconds: null, volume: 1 }],
      },
    ];
    const result = service.validate(tracks, 10, knownAssets);
    expect(result.missingAssets).toHaveLength(0);
    expect(result.overlaps).toHaveLength(0);
    expect(result.durationMismatch).toBe(false);
  });
});