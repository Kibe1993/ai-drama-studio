import "server-only";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { AudioSegmentKind, AudioSpeakerType } from "@/lib/validation/audioSegment";

export type ExtractedSegment = {
  sceneNumber: number;
  sequence: number;
  speakerType: AudioSpeakerType;
  speakerName: string;
  text: string;
  kind: AudioSegmentKind;
};

export type DialogueExtractionResult = {
  segments: ExtractedSegment[];
  speakerNames: string[];
  totalScenes: number;
  totalSegments: number;
};

export function extractDialogueFromScreenplay(screenplay: ScreenplayScene[]): DialogueExtractionResult {
  const segments: ExtractedSegment[] = [];
  const speakerSet = new Set<string>();

  for (const scene of screenplay) {
    let sequence = 0;
    for (const line of scene.dialogue) {
      const trimmedName = line.characterName.trim();
      const trimmedLine = line.line.trim();
      if (!trimmedName || !trimmedLine) continue;

      segments.push({
        sceneNumber: scene.sceneNumber,
        sequence,
        speakerType: "character",
        speakerName: trimmedName,
        text: trimmedLine,
        kind: "dialogue",
      });
      speakerSet.add(trimmedName);
      sequence += 1;
    }
  }

  return {
    segments,
    speakerNames: [...speakerSet].sort(),
    totalScenes: screenplay.length,
    totalSegments: segments.length,
  };
}

export function validateExtraction(result: DialogueExtractionResult): void {
  if (result.totalSegments === 0) {
    throw new Error("no_dialogue_in_screenplay");
  }
  const seen = new Set<string>();
  for (const segment of result.segments) {
    const key = `${segment.sceneNumber}:${segment.sequence}`;
    if (seen.has(key)) {
      throw new Error(`duplicate_segment_at_scene_${segment.sceneNumber}_sequence_${segment.sequence}`);
    }
    seen.add(key);
  }
}