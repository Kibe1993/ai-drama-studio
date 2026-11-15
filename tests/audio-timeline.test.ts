import { describe, expect, it } from "vitest";
import { buildAudioTimeline } from "@/lib/services/audioTimelineService";
import type { AudioSegmentRecord } from "@/lib/validation/audioSegment";

function makeSegment(overrides: Partial<AudioSegmentRecord> = {}): AudioSegmentRecord {
  return {
    id: "seg1",
    clerkUserId: "user1",
    projectId: "proj1",
    episodeId: null,
    runId: "run1",
    storyId: "story1",
    sceneNumber: 1,
    sequence: 0,
    speakerType: "character",
    speakerName: "Amara",
    canonicalEntityId: null,
    voiceProfileId: null,
    voiceIdentifier: "af_heart",
    text: "Hello world.",
    kind: "dialogue",
    status: "completed",
    mediaAssetId: "asset1",
    durationSeconds: 2.5,
    error: null,
    attempts: 1,
    idempotencyKey: "key1",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("audio timeline service", () => {
  it("builds a timeline from completed segments", () => {
    const segments = [
      makeSegment({ id: "s1", sceneNumber: 1, sequence: 0, durationSeconds: 2.0, mediaAssetId: "a1" }),
      makeSegment({ id: "s2", sceneNumber: 1, sequence: 1, durationSeconds: 3.0, mediaAssetId: "a2" }),
      makeSegment({ id: "s3", sceneNumber: 2, sequence: 0, durationSeconds: 1.5, mediaAssetId: "a3" }),
    ];
    const timeline = buildAudioTimeline(segments);

    expect(timeline.entries).toHaveLength(3);
    expect(timeline.totalDurationSeconds).toBe(6.5);
    expect(timeline.completedSegments).toBe(3);
    expect(timeline.totalSegments).toBe(3);
  });

  it("computes sequential start and end times", () => {
    const segments = [
      makeSegment({ id: "s1", durationSeconds: 2.0, mediaAssetId: "a1" }),
      makeSegment({ id: "s2", sequence: 1, durationSeconds: 3.0, mediaAssetId: "a2" }),
    ];
    const timeline = buildAudioTimeline(segments);

    expect(timeline.entries[0].startSeconds).toBe(0);
    expect(timeline.entries[0].endSeconds).toBe(2.0);
    expect(timeline.entries[1].startSeconds).toBe(2.0);
    expect(timeline.entries[1].endSeconds).toBe(5.0);
  });

  it("skips incomplete segments", () => {
    const segments = [
      makeSegment({ id: "s1", status: "completed", durationSeconds: 2.0, mediaAssetId: "a1" }),
      makeSegment({ id: "s2", sequence: 1, status: "pending", durationSeconds: null, mediaAssetId: null }),
      makeSegment({ id: "s3", sequence: 2, status: "completed", durationSeconds: 1.0, mediaAssetId: "a3" }),
    ];
    const timeline = buildAudioTimeline(segments);

    expect(timeline.entries).toHaveLength(2);
    expect(timeline.completedSegments).toBe(2);
    expect(timeline.totalSegments).toBe(3);
  });

  it("skips segments without media asset", () => {
    const segments = [
      makeSegment({ id: "s1", status: "completed", durationSeconds: 2.0, mediaAssetId: null }),
    ];
    const timeline = buildAudioTimeline(segments);
    expect(timeline.entries).toHaveLength(0);
  });

  it("groups entries by scene", () => {
    const segments = [
      makeSegment({ id: "s1", sceneNumber: 1, sequence: 0, durationSeconds: 2.0, mediaAssetId: "a1" }),
      makeSegment({ id: "s2", sceneNumber: 1, sequence: 1, durationSeconds: 3.0, mediaAssetId: "a2" }),
      makeSegment({ id: "s3", sceneNumber: 2, sequence: 0, durationSeconds: 1.5, mediaAssetId: "a3" }),
    ];
    const timeline = buildAudioTimeline(segments);

    expect(timeline.scenes).toHaveLength(2);
    expect(timeline.scenes[0]).toEqual({
      sceneNumber: 1,
      startSeconds: 0,
      endSeconds: 5.0,
      segmentCount: 2,
    });
    expect(timeline.scenes[1]).toEqual({
      sceneNumber: 2,
      startSeconds: 5.0,
      endSeconds: 6.5,
      segmentCount: 1,
    });
  });

  it("sorts entries by scene then sequence", () => {
    const segments = [
      makeSegment({ id: "s1", sceneNumber: 2, sequence: 0, durationSeconds: 1.0, mediaAssetId: "a1" }),
      makeSegment({ id: "s2", sceneNumber: 1, sequence: 1, durationSeconds: 1.0, mediaAssetId: "a2" }),
      makeSegment({ id: "s3", sceneNumber: 1, sequence: 0, durationSeconds: 1.0, mediaAssetId: "a3" }),
    ];
    const timeline = buildAudioTimeline(segments);

    expect(timeline.entries[0].sceneNumber).toBe(1);
    expect(timeline.entries[0].sequence).toBe(0);
    expect(timeline.entries[1].sceneNumber).toBe(1);
    expect(timeline.entries[1].sequence).toBe(1);
    expect(timeline.entries[2].sceneNumber).toBe(2);
  });

  it("handles empty segments", () => {
    const timeline = buildAudioTimeline([]);
    expect(timeline.entries).toHaveLength(0);
    expect(timeline.totalDurationSeconds).toBe(0);
    expect(timeline.scenes).toHaveLength(0);
  });

  it("preserves segment metadata in timeline entries", () => {
    const segments = [
      makeSegment({
        id: "s1",
        speakerName: "Kael",
        text: "Then we fight.",
        voiceIdentifier: "am_adam",
        kind: "dialogue",
        durationSeconds: 1.5,
        mediaAssetId: "a1",
      }),
    ];
    const timeline = buildAudioTimeline(segments);
    expect(timeline.entries[0].speakerName).toBe("Kael");
    expect(timeline.entries[0].text).toBe("Then we fight.");
    expect(timeline.entries[0].voiceIdentifier).toBe("am_adam");
    expect(timeline.entries[0].mediaAssetId).toBe("a1");
  });
});