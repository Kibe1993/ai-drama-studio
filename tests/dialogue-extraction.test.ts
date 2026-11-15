import { describe, expect, it } from "vitest";
import {
  extractDialogueFromScreenplay,
  validateExtraction,
} from "@/lib/services/dialogueExtractionService";
import type { ScreenplayScene } from "@/lib/validation/story";

function makeScene(overrides: Partial<ScreenplayScene> = {}): ScreenplayScene {
  return {
    sceneNumber: 1,
    heading: "INT. ROOM - DAY",
    location: "Room",
    timeOfDay: "Day",
    charactersPresent: ["AMARA"],
    visualDescription: "A dimly lit room.",
    action: "Amara enters.",
    dialogue: [{ characterName: "Amara", line: "I won't let them take this." }],
    ...overrides,
  };
}

describe("dialogue extraction service", () => {
  it("extracts dialogue lines from a screenplay", () => {
    const screenplay = [
      makeScene({
        sceneNumber: 1,
        dialogue: [
          { characterName: "Amara", line: "I won't let them take this." },
          { characterName: "Kael", line: "Then we fight." },
        ],
      }),
      makeScene({
        sceneNumber: 2,
        charactersPresent: ["Amara", "Kael"],
        dialogue: [
          { characterName: "Kael", line: "Stay behind me." },
        ],
      }),
    ];

    const result = extractDialogueFromScreenplay(screenplay);
    expect(result.totalSegments).toBe(3);
    expect(result.totalScenes).toBe(2);
    expect(result.speakerNames).toEqual(["Amara", "Kael"]);
    expect(result.segments[0]).toEqual({
      sceneNumber: 1,
      sequence: 0,
      speakerType: "character",
      speakerName: "Amara",
      text: "I won't let them take this.",
      kind: "dialogue",
    });
    expect(result.segments[1]).toEqual({
      sceneNumber: 1,
      sequence: 1,
      speakerType: "character",
      speakerName: "Kael",
      text: "Then we fight.",
      kind: "dialogue",
    });
    expect(result.segments[2]).toEqual({
      sceneNumber: 2,
      sequence: 0,
      speakerType: "character",
      speakerName: "Kael",
      text: "Stay behind me.",
      kind: "dialogue",
    });
  });

  it("preserves original text without modification", () => {
    const line = "I won't  let   them take this.";
    const screenplay = [makeScene({ dialogue: [{ characterName: "Amara", line }] })];
    const result = extractDialogueFromScreenplay(screenplay);
    expect(result.segments[0].text).toBe(line.trim());
  });

  it("does not send visual descriptions or actions as dialogue", () => {
    const screenplay = [makeScene({
      visualDescription: "A dark stormy night with lightning.",
      action: "Thunder crashes outside.",
      dialogue: [{ characterName: "Amara", line: "Did you hear that?" }],
    })];
    const result = extractDialogueFromScreenplay(screenplay);
    expect(result.totalSegments).toBe(1);
    expect(result.segments[0].text).toBe("Did you hear that?");
  });

  it("handles scenes with no dialogue", () => {
    const screenplay = [makeScene({ dialogue: [] })];
    const result = extractDialogueFromScreenplay(screenplay);
    expect(result.totalSegments).toBe(0);
    expect(result.speakerNames).toEqual([]);
  });

  it("sorts speaker names alphabetically", () => {
    const screenplay = [makeScene({
      dialogue: [
        { characterName: "Zara", line: "Yes." },
        { characterName: "Amara", line: "No." },
        { characterName: "Kael", line: "Maybe." },
      ],
    })];
    const result = extractDialogueFromScreenplay(screenplay);
    expect(result.speakerNames).toEqual(["Amara", "Kael", "Zara"]);
  });

  it("validates extraction with segments", () => {
    const screenplay = [makeScene({
      dialogue: [{ characterName: "Amara", line: "Hello." }],
    })];
    const result = extractDialogueFromScreenplay(screenplay);
    expect(() => validateExtraction(result)).not.toThrow();
  });

  it("rejects empty extraction", () => {
    const result = extractDialogueFromScreenplay([makeScene({ dialogue: [] })]);
    expect(() => validateExtraction(result)).toThrow("no_dialogue_in_screenplay");
  });

  it("assigns sequential sequence numbers within each scene", () => {
    const screenplay = [makeScene({
      sceneNumber: 1,
      dialogue: [
        { characterName: "A", line: "1" },
        { characterName: "B", line: "2" },
        { characterName: "C", line: "3" },
      ],
    })];
    const result = extractDialogueFromScreenplay(screenplay);
    expect(result.segments.map((s) => s.sequence)).toEqual([0, 1, 2]);
  });

  it("resets sequence for each scene", () => {
    const screenplay = [
      makeScene({
        sceneNumber: 1,
        dialogue: [
          { characterName: "A", line: "1" },
          { characterName: "B", line: "2" },
        ],
      }),
      makeScene({
        sceneNumber: 2,
        dialogue: [
          { characterName: "C", line: "3" },
        ],
      }),
    ];
    const result = extractDialogueFromScreenplay(screenplay);
    expect(result.segments.map((s) => s.sequence)).toEqual([0, 1, 0]);
  });
});