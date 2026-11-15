import "server-only";
import type { AudioSegmentRecord } from "@/lib/validation/audioSegment";

export type AudioTimelineEntry = {
  segmentId: string;
  sceneNumber: number;
  sequence: number;
  speakerType: AudioSegmentRecord["speakerType"];
  speakerName: string;
  text: string;
  kind: AudioSegmentRecord["kind"];
  voiceIdentifier: string;
  mediaAssetId: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

export type AudioTimeline = {
  entries: AudioTimelineEntry[];
  totalDurationSeconds: number;
  totalSegments: number;
  completedSegments: number;
  scenes: { sceneNumber: number; startSeconds: number; endSeconds: number; segmentCount: number }[];
};

export function buildAudioTimeline(segments: AudioSegmentRecord[]): AudioTimeline {
  const completed = segments
    .filter((s) => s.status === "completed" && s.mediaAssetId && s.durationSeconds)
    .sort((a, b) => a.sceneNumber - b.sceneNumber || a.sequence - b.sequence);

  const entries: AudioTimelineEntry[] = [];
  let currentTime = 0;
  const sceneMap = new Map<number, { startSeconds: number; endSeconds: number; segmentCount: number }>();

  for (const segment of completed) {
    const duration = segment.durationSeconds!;
    const entry: AudioTimelineEntry = {
      segmentId: segment.id,
      sceneNumber: segment.sceneNumber,
      sequence: segment.sequence,
      speakerType: segment.speakerType,
      speakerName: segment.speakerName,
      text: segment.text,
      kind: segment.kind,
      voiceIdentifier: segment.voiceIdentifier,
      mediaAssetId: segment.mediaAssetId!,
      startSeconds: currentTime,
      endSeconds: currentTime + duration,
      durationSeconds: duration,
    };
    entries.push(entry);

    const scene = sceneMap.get(segment.sceneNumber);
    if (scene) {
      scene.endSeconds = entry.endSeconds;
      scene.segmentCount += 1;
    } else {
      sceneMap.set(segment.sceneNumber, {
        startSeconds: currentTime,
        endSeconds: entry.endSeconds,
        segmentCount: 1,
      });
    }

    currentTime += duration;
  }

  const scenes = [...sceneMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sceneNumber, info]) => ({ sceneNumber, ...info }));

  return {
    entries,
    totalDurationSeconds: currentTime,
    totalSegments: segments.length,
    completedSegments: completed.length,
    scenes,
  };
}