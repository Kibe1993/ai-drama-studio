import { describe, it, expect } from "vitest";
import {
  characterLocationFindings,
  resolvedThreadFindings,
  locationStateFindings,
  objectOwnershipFindings,
  revealedSecretFindings,
  continuityCheckFindings,
} from "@/lib/domain/continuityChecks";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";

function scene(overrides: Partial<ScreenplayScene> & { sceneNumber: number }): ScreenplayScene {
  return {
    heading: "INT. ROOM - DAY",
    location: "Room",
    timeOfDay: "DAY",
    charactersPresent: ["Alice"],
    visualDescription: "A quiet room with soft light.",
    action: "Alice enters and looks around.",
    dialogue: [{ characterName: "Alice", line: "What is going on here?" }],
    ...overrides,
  };
}

function ledger(overrides: Partial<ContinuityLedger> = {}): ContinuityLedger {
  return {
    events: [],
    characterStates: [],
    locationStates: [],
    objectStates: [],
    revealedSecrets: [],
    unresolvedThreads: [],
    consequences: [],
    timelineNotes: "",
    ...overrides,
  };
}

describe("characterLocationFindings", () => {
  it("returns no findings when the character is at the ledger location", () => {
    const findings = characterLocationFindings(
      [{ name: "Alice", currentLocation: "Town Square", currentObjective: "x", knowledge: [], beliefs: [], motivations: [], emotionalState: "ok", physicalState: "", relationships: [] }],
      [scene({ sceneNumber: 1, location: "Town Square", charactersPresent: ["Alice"] })],
    );
    expect(findings).toHaveLength(0);
  });

  it("warns when the character appears at a different location with no transition", () => {
    const findings = characterLocationFindings(
      [{ name: "Alice", currentLocation: "Town Square", currentObjective: "x", knowledge: [], beliefs: [], motivations: [], emotionalState: "ok", physicalState: "", relationships: [] }],
      [scene({ sceneNumber: 1, location: "The Old House", charactersPresent: ["Alice"], action: "Alice waits." })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("character_location_mismatch");
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.sceneNumber).toBe(1);
  });

  it("does not warn when the screenplay text mentions the ledger location (transition shown)", () => {
    const findings = characterLocationFindings(
      [{ name: "Alice", currentLocation: "Town Square", currentObjective: "x", knowledge: [], beliefs: [], motivations: [], emotionalState: "ok", physicalState: "", relationships: [] }],
      [scene({ sceneNumber: 1, location: "The Old House", charactersPresent: ["Alice"], action: "Alice arrives from Town Square." })],
    );
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when the character does not appear in any scene", () => {
    const findings = characterLocationFindings(
      [{ name: "Bob", currentLocation: "Town Square", currentObjective: "x", knowledge: [], beliefs: [], motivations: [], emotionalState: "ok", physicalState: "", relationships: [] }],
      [scene({ sceneNumber: 1, location: "Town Square", charactersPresent: ["Alice"] })],
    );
    expect(findings).toHaveLength(0);
  });

  it("matches partial location names", () => {
    const findings = characterLocationFindings(
      [{ name: "Alice", currentLocation: "Town Square", currentObjective: "x", knowledge: [], beliefs: [], motivations: [], emotionalState: "ok", physicalState: "", relationships: [] }],
      [scene({ sceneNumber: 1, location: "town square marketplace", charactersPresent: ["Alice"] })],
    );
    expect(findings).toHaveLength(0);
  });
});

describe("resolvedThreadFindings", () => {
  it("returns no findings when there are no resolved threads", () => {
    const findings = resolvedThreadFindings(
      [{ thread: "Who killed the king?", introducedInEpisode: 1, status: "open" }],
      [scene({ sceneNumber: 1, dialogue: [{ characterName: "Alice", line: "Who killed the king?" }] })],
    );
    expect(findings).toHaveLength(0);
  });

  it("warns when a resolved thread is mentioned with question language", () => {
    const findings = resolvedThreadFindings(
      [{ thread: "Who killed the king?", introducedInEpisode: 1, status: "resolved" }],
      [scene({ sceneNumber: 1, dialogue: [{ characterName: "Alice", line: "But who really killed the king?" }] })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("resolved_thread_reopened");
    expect(findings[0]!.severity).toBe("warning");
  });

  it("does not warn when a resolved thread is mentioned as settled", () => {
    const findings = resolvedThreadFindings(
      [{ thread: "The king was murdered by the queen", introducedInEpisode: 1, status: "resolved" }],
      [scene({ sceneNumber: 1, dialogue: [{ characterName: "Alice", line: "As we established, the king was murdered by the queen." }] })],
    );
    expect(findings).toHaveLength(0);
  });
});

describe("locationStateFindings", () => {
  it("warns when a terminal location state contradicts an active visual description", () => {
    const findings = locationStateFindings(
      [{ name: "The Old House", currentState: "burned and abandoned", lastSeenEpisode: 1 }],
      [scene({ sceneNumber: 1, location: "The Old House", visualDescription: "The house is bustling and bright, full of people." })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("location_state_contradiction");
    expect(findings[0]!.severity).toBe("warning");
  });

  it("does not warn when the location state is not terminal", () => {
    const findings = locationStateFindings(
      [{ name: "The Old House", currentState: "renovated and open", lastSeenEpisode: 1 }],
      [scene({ sceneNumber: 1, location: "The Old House", visualDescription: "The house is bustling and bright." })],
    );
    expect(findings).toHaveLength(0);
  });

  it("does not warn when the visual description is not active", () => {
    const findings = locationStateFindings(
      [{ name: "The Old House", currentState: "burned and abandoned", lastSeenEpisode: 1 }],
      [scene({ sceneNumber: 1, location: "The Old House", visualDescription: "Charred ruins stand silent." })],
    );
    expect(findings).toHaveLength(0);
  });

  it("does not warn when the scene is at a different location", () => {
    const findings = locationStateFindings(
      [{ name: "The Old House", currentState: "burned and abandoned", lastSeenEpisode: 1 }],
      [scene({ sceneNumber: 1, location: "Town Square", visualDescription: "The square is bustling and bright." })],
    );
    expect(findings).toHaveLength(0);
  });
});

describe("objectOwnershipFindings", () => {
  it("warns when a non-owner references an object without the owner present", () => {
    const findings = objectOwnershipFindings(
      [{ name: "the letter", ownership: "Alice", condition: "intact", lastSeenEpisode: 1 }],
      [scene({ sceneNumber: 1, charactersPresent: ["Bob"], dialogue: [{ characterName: "Bob", line: "I found the letter on the table." }] })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("object_ownership_mismatch");
    expect(findings[0]!.severity).toBe("warning");
  });

  it("does not warn when the owner is present in the scene", () => {
    const findings = objectOwnershipFindings(
      [{ name: "the letter", ownership: "Alice", condition: "intact", lastSeenEpisode: 1 }],
      [scene({ sceneNumber: 1, charactersPresent: ["Alice", "Bob"], dialogue: [{ characterName: "Bob", line: "I see the letter." }] })],
    );
    expect(findings).toHaveLength(0);
  });

  it("does not warn when the owner themselves references the object", () => {
    const findings = objectOwnershipFindings(
      [{ name: "the letter", ownership: "Alice", condition: "intact", lastSeenEpisode: 1 }],
      [scene({ sceneNumber: 1, charactersPresent: ["Alice"], dialogue: [{ characterName: "Alice", line: "I have the letter." }] })],
    );
    expect(findings).toHaveLength(0);
  });

  it("does not warn when the object is not mentioned in dialogue", () => {
    const findings = objectOwnershipFindings(
      [{ name: "the letter", ownership: "Alice", condition: "intact", lastSeenEpisode: 1 }],
      [scene({ sceneNumber: 1, charactersPresent: ["Bob"], dialogue: [{ characterName: "Bob", line: "What a lovely day." }] })],
    );
    expect(findings).toHaveLength(0);
  });
});

describe("revealedSecretFindings", () => {
  it("warns when an already-revealed secret is presented as a new revelation", () => {
    const findings = revealedSecretFindings(
      ["Bob is the killer"],
      [scene({ sceneNumber: 1, dialogue: [{ characterName: "Alice", line: "The truth is Bob is the killer all along." }] })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("secret_re_revealed");
    expect(findings[0]!.severity).toBe("warning");
  });

  it("does not warn when a revealed secret is referenced without revelation language", () => {
    const findings = revealedSecretFindings(
      ["Bob is the killer"],
      [scene({ sceneNumber: 1, dialogue: [{ characterName: "Alice", line: "We already know Bob is the killer." }] })],
    );
    expect(findings).toHaveLength(0);
  });

  it("does not warn when there are no revealed secrets", () => {
    const findings = revealedSecretFindings(
      [],
      [scene({ sceneNumber: 1, dialogue: [{ characterName: "Alice", line: "The truth is shocking." }] })],
    );
    expect(findings).toHaveLength(0);
  });
});

describe("continuityCheckFindings", () => {
  it("aggregates findings from all sub-checks", () => {
    const l = ledger({
      characterStates: [
        { name: "Alice", currentLocation: "Town Square", currentObjective: "x", knowledge: [], beliefs: [], motivations: [], emotionalState: "ok", physicalState: "", relationships: [] },
      ],
      objectStates: [
        { name: "the letter", ownership: "Alice", condition: "intact", lastSeenEpisode: 1 },
      ],
    });
    const findings = continuityCheckFindings(l, [
      scene({ sceneNumber: 1, location: "The Old House", charactersPresent: ["Alice"], action: "Alice arrives.", dialogue: [] }),
      scene({ sceneNumber: 2, location: "The Old House", charactersPresent: ["Bob"], dialogue: [{ characterName: "Bob", line: "I have the letter." }] }),
    ]);
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("character_location_mismatch");
    expect(codes).toContain("object_ownership_mismatch");
  });

  it("returns no findings for an empty ledger", () => {
    const findings = continuityCheckFindings(ledger(), [scene({ sceneNumber: 1 })]);
    expect(findings).toHaveLength(0);
  });
});