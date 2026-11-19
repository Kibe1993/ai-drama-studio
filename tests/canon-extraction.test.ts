import { describe, it, expect } from "vitest";
import {
  screenplayToText,
  buildCanonExtractionPrompt,
  diffCanonSuggestions,
  applyCanonSuggestions,
  hasSuggestionContent,
  emptyCanonExtractionResponse,
} from "@/lib/domain/canonExtraction";
import type { CanonExtractionResponse, CanonSuggestion } from "@/lib/validation/canonExtraction";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import { makeScene, makeLedger, makeCharacterState } from "./continuity-integration/fixtures";

function makeExtractionResponse(overrides: Partial<CanonExtractionResponse> = {}): CanonExtractionResponse {
  return {
    events: [],
    characterKnowledge: [],
    characterBeliefs: [],
    characterMotivations: [],
    relationshipChanges: [],
    revealedSecrets: [],
    unresolvedThreads: [],
    locationStates: [],
    objectStates: [],
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<CanonSuggestion> = {}): CanonSuggestion {
  return {
    episodeNumber: 1,
    storyId: "story-1",
    createdAt: "2026-01-01T00:00:00Z",
    status: "accepted",
    ...makeExtractionResponse(),
    ...overrides,
  } as CanonSuggestion;
}

describe("canonExtraction domain functions", () => {
  describe("screenplayToText", () => {
    it("includes heading, visual description, action, and dialogue", () => {
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          heading: "INT. HOUSE - NIGHT",
          visualDescription: "A dark room.",
          action: "Alice enters.",
          dialogue: [
            { characterName: "Alice", line: "Is anyone here?" },
            { characterName: "Bob", line: "Over here." },
          ],
        }),
      ];

      const text = screenplayToText(screenplay);
      expect(text).toContain("INT. HOUSE - NIGHT");
      expect(text).toContain("A dark room.");
      expect(text).toContain("Alice enters.");
      expect(text).toContain("Alice: Is anyone here?");
      expect(text).toContain("Bob: Over here.");
    });

    it("separates scenes with a divider", () => {
      const screenplay: ScreenplayScene[] = [
        makeScene({ sceneNumber: 1, heading: "SCENE 1" }),
        makeScene({ sceneNumber: 2, heading: "SCENE 2" }),
      ];

      const text = screenplayToText(screenplay);
      expect(text).toContain("---");
      expect(text).toContain("SCENE 1");
      expect(text).toContain("SCENE 2");
    });
  });

  describe("buildCanonExtractionPrompt", () => {
    it("includes the screenplay text in the prompt", () => {
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          heading: "INT. HOUSE - NIGHT",
          action: "Alice discovers the document.",
        }),
      ];

      const { system, prompt } = buildCanonExtractionPrompt({
        screenplay,
        ledger: null,
        episodeNumber: 3,
        seriesTitle: "The Hidden Truth",
      });

      expect(prompt).toContain("Alice discovers the document.");
      expect(prompt).toContain("Episode: 3");
      expect(prompt).toContain("Series: The Hidden Truth");
      expect(system).toContain("canon extraction");
    });

    it("includes the current ledger state in the prompt", () => {
      const ledger: ContinuityLedger = makeLedger({
        characterStates: [
          makeCharacterState({
            name: "Alice",
            currentLocation: "The Old House",
            currentObjective: "Find the document.",
            knowledge: ["Bob is hiding something."],
          }),
        ],
        revealedSecrets: ["The document exists."],
      });

      const { prompt } = buildCanonExtractionPrompt({
        screenplay: [makeScene({ sceneNumber: 1 })],
        ledger,
        episodeNumber: 2,
        seriesTitle: "Test",
      });

      expect(prompt).toContain("Alice");
      expect(prompt).toContain("The Old House");
      expect(prompt).toContain("Find the document.");
      expect(prompt).toContain("Bob is hiding something.");
      expect(prompt).toContain("The document exists.");
    });

    it("shows empty ledger message when ledger is null", () => {
      const { prompt } = buildCanonExtractionPrompt({
        screenplay: [makeScene({ sceneNumber: 1 })],
        ledger: null,
        episodeNumber: 1,
        seriesTitle: "Test",
      });

      expect(prompt).toContain("no ledger yet");
    });
  });

  describe("diffCanonSuggestions", () => {
    it("returns the full response when ledger is null", () => {
      const response = makeExtractionResponse({
        revealedSecrets: ["The document is real."],
      });

      const diffed = diffCanonSuggestions(response, null);
      expect(diffed.revealedSecrets).toHaveLength(1);
    });

    it("filters out events already in the ledger", () => {
      const ledger: ContinuityLedger = makeLedger({
        events: [
          {
            episodeNumber: 1,
            event: "Alice found the document.",
            consequence: "The truth is out.",
            affectedCharacters: ["Alice"],
            revealedInformation: [],
          },
        ],
      });

      const response = makeExtractionResponse({
        events: [
          {
            event: "Alice found the document.",
            consequence: "Different consequence.",
            affectedCharacters: ["Alice"],
            revealedInformation: [],
          },
          {
            event: "Bob confessed.",
            consequence: "Alice is shocked.",
            affectedCharacters: ["Bob"],
            revealedInformation: [],
          },
        ],
      });

      const diffed = diffCanonSuggestions(response, ledger);
      expect(diffed.events).toHaveLength(1);
      expect(diffed.events[0]!.event).toBe("Bob confessed.");
    });

    it("filters out character knowledge already in the ledger", () => {
      const ledger: ContinuityLedger = makeLedger({
        characterStates: [
          makeCharacterState({
            name: "Alice",
            knowledge: ["Bob is hiding something."],
          }),
        ],
      });

      const response = makeExtractionResponse({
        characterKnowledge: [
          {
            characterName: "Alice",
            knowledge: ["Bob is hiding something.", "The document is in the house."],
          },
        ],
      });

      const diffed = diffCanonSuggestions(response, ledger);
      expect(diffed.characterKnowledge).toHaveLength(1);
      expect(diffed.characterKnowledge[0]!.knowledge).toHaveLength(1);
      expect(diffed.characterKnowledge[0]!.knowledge[0]).toBe("The document is in the house.");
    });

    it("filters out revealed secrets already in the ledger", () => {
      const ledger: ContinuityLedger = makeLedger({
        revealedSecrets: ["The document exists."],
      });

      const response = makeExtractionResponse({
        revealedSecrets: ["The document exists.", "Bob is the culprit."],
      });

      const diffed = diffCanonSuggestions(response, ledger);
      expect(diffed.revealedSecrets).toHaveLength(1);
      expect(diffed.revealedSecrets[0]).toBe("Bob is the culprit.");
    });

    it("filters out unresolved threads already in the ledger", () => {
      const ledger: ContinuityLedger = makeLedger({
        unresolvedThreads: [
          { thread: "Who is the culprit?", introducedInEpisode: 1, status: "open" },
        ],
      });

      const response = makeExtractionResponse({
        unresolvedThreads: [
          { thread: "Who is the culprit?", introducedInEpisode: 1, status: "developing" },
          { thread: "Where is the document?", introducedInEpisode: 2, status: "open" },
        ],
      });

      const diffed = diffCanonSuggestions(response, ledger);
      expect(diffed.unresolvedThreads).toHaveLength(1);
      expect(diffed.unresolvedThreads[0]!.thread).toBe("Where is the document?");
    });

    it("normalizes whitespace and case when comparing", () => {
      const ledger: ContinuityLedger = makeLedger({
        revealedSecrets: ["The   DOCUMENT   exists."],
      });

      const response = makeExtractionResponse({
        revealedSecrets: ["the document exists."],
      });

      const diffed = diffCanonSuggestions(response, ledger);
      expect(diffed.revealedSecrets).toHaveLength(0);
    });

    it("removes character knowledge entries that become empty after diffing", () => {
      const ledger: ContinuityLedger = makeLedger({
        characterStates: [
          makeCharacterState({
            name: "Alice",
            knowledge: ["Bob is hiding something."],
          }),
        ],
      });

      const response = makeExtractionResponse({
        characterKnowledge: [
          {
            characterName: "Alice",
            knowledge: ["Bob is hiding something."],
          },
        ],
      });

      const diffed = diffCanonSuggestions(response, ledger);
      expect(diffed.characterKnowledge).toHaveLength(0);
    });
  });

  describe("applyCanonSuggestions", () => {
    it("adds new events to the ledger", () => {
      const ledger: ContinuityLedger = makeLedger({
        events: [
          {
            episodeNumber: 1,
            event: "Alice arrived.",
            consequence: "The story begins.",
            affectedCharacters: ["Alice"],
            revealedInformation: [],
          },
        ],
      });

      const suggestion = makeSuggestion({
        episodeNumber: 2,
        events: [
          {
            event: "Bob confessed.",
            consequence: "Alice is shocked.",
            affectedCharacters: ["Bob"],
            revealedInformation: ["Bob is the culprit."],
          },
        ],
      });

      const result = applyCanonSuggestions(ledger, suggestion, 2);
      expect(result.events).toHaveLength(2);
      expect(result.events[1]!.event).toBe("Bob confessed.");
      expect(result.events[1]!.episodeNumber).toBe(2);
    });

    it("appends character knowledge to existing character state", () => {
      const ledger: ContinuityLedger = makeLedger({
        characterStates: [
          makeCharacterState({
            name: "Alice",
            knowledge: ["Bob is hiding something."],
          }),
        ],
      });

      const suggestion = makeSuggestion({
        characterKnowledge: [
          {
            characterName: "Alice",
            knowledge: ["The document is in the house."],
          },
        ],
      });

      const result = applyCanonSuggestions(ledger, suggestion, 2);
      const alice = result.characterStates.find((s) => s.name === "Alice");
      expect(alice?.knowledge).toContain("Bob is hiding something.");
      expect(alice?.knowledge).toContain("The document is in the house.");
    });

    it("appends character beliefs to existing character state", () => {
      const ledger: ContinuityLedger = makeLedger({
        characterStates: [
          makeCharacterState({
            name: "Alice",
            beliefs: ["The truth must come out."],
          }),
        ],
      });

      const suggestion = makeSuggestion({
        characterBeliefs: [
          {
            characterName: "Alice",
            beliefs: ["Bob can be redeemed."],
          },
        ],
      });

      const result = applyCanonSuggestions(ledger, suggestion, 2);
      const alice = result.characterStates.find((s) => s.name === "Alice");
      expect(alice?.beliefs).toContain("The truth must come out.");
      expect(alice?.beliefs).toContain("Bob can be redeemed.");
    });

    it("replaces relationships for a character with suggestion relationships", () => {
      const ledger: ContinuityLedger = makeLedger({
        characterStates: [
          makeCharacterState({
            name: "Alice",
            relationships: [
              { characterName: "Bob", relationship: "old friend", tensionOrChange: "Trust is strong." },
            ],
          }),
        ],
      });

      const suggestion = makeSuggestion({
        relationshipChanges: [
          {
            characterName: "Alice",
            relationships: [
              { characterName: "Bob", relationship: "old friend", tensionOrChange: "Trust is broken." },
            ],
          },
        ],
      });

      const result = applyCanonSuggestions(ledger, suggestion, 2);
      const alice = result.characterStates.find((s) => s.name === "Alice");
      const bobRel = alice?.relationships.find((r) => r.characterName === "Bob");
      expect(bobRel?.tensionOrChange).toBe("Trust is broken.");
    });

    it("adds new revealed secrets", () => {
      const ledger: ContinuityLedger = makeLedger({
        revealedSecrets: ["The document exists."],
      });

      const suggestion = makeSuggestion({
        revealedSecrets: ["Bob is the culprit."],
      });

      const result = applyCanonSuggestions(ledger, suggestion, 2);
      expect(result.revealedSecrets).toContain("The document exists.");
      expect(result.revealedSecrets).toContain("Bob is the culprit.");
    });

    it("merges unresolved threads by thread text", () => {
      const ledger: ContinuityLedger = makeLedger({
        unresolvedThreads: [
          { thread: "Who is the culprit?", introducedInEpisode: 1, status: "open" },
        ],
      });

      const suggestion = makeSuggestion({
        unresolvedThreads: [
          { thread: "Who is the culprit?", introducedInEpisode: 1, status: "resolved" },
        ],
      });

      const result = applyCanonSuggestions(ledger, suggestion, 2);
      expect(result.unresolvedThreads).toHaveLength(1);
      expect(result.unresolvedThreads[0]!.status).toBe("resolved");
    });

    it("updates location states by name", () => {
      const ledger: ContinuityLedger = makeLedger({
        locationStates: [
          { name: "The Old House", currentState: "Boarded up.", lastSeenEpisode: 1 },
        ],
      });

      const suggestion = makeSuggestion({
        locationStates: [
          { name: "The Old House", currentState: "Door forced open.", lastSeenEpisode: 2 },
        ],
      });

      const result = applyCanonSuggestions(ledger, suggestion, 2);
      expect(result.locationStates).toHaveLength(1);
      expect(result.locationStates[0]!.currentState).toBe("Door forced open.");
    });

    it("does not mutate the input ledger", () => {
      const ledger: ContinuityLedger = makeLedger({
        revealedSecrets: ["Original secret."],
      });
      const originalSecrets = [...ledger.revealedSecrets];

      const suggestion = makeSuggestion({
        revealedSecrets: ["New secret."],
      });

      applyCanonSuggestions(ledger, suggestion, 2);
      expect(ledger.revealedSecrets).toEqual(originalSecrets);
    });
  });

  describe("hasSuggestionContent", () => {
    it("returns false for an empty response", () => {
      expect(hasSuggestionContent(emptyCanonExtractionResponse())).toBe(false);
    });

    it("returns true when events are present", () => {
      const response = makeExtractionResponse({
        events: [
          {
            event: "Something happened.",
            consequence: "Something resulted.",
            affectedCharacters: [],
            revealedInformation: [],
          },
        ],
      });
      expect(hasSuggestionContent(response)).toBe(true);
    });

    it("returns true when character knowledge is present", () => {
      const response = makeExtractionResponse({
        characterKnowledge: [{ characterName: "Alice", knowledge: ["A fact."] }],
      });
      expect(hasSuggestionContent(response)).toBe(true);
    });
  });

  describe("emptyCanonExtractionResponse", () => {
    it("returns a response with all arrays empty", () => {
      const empty = emptyCanonExtractionResponse();
      expect(empty.events).toHaveLength(0);
      expect(empty.characterKnowledge).toHaveLength(0);
      expect(empty.characterBeliefs).toHaveLength(0);
      expect(empty.characterMotivations).toHaveLength(0);
      expect(empty.relationshipChanges).toHaveLength(0);
      expect(empty.revealedSecrets).toHaveLength(0);
      expect(empty.unresolvedThreads).toHaveLength(0);
      expect(empty.locationStates).toHaveLength(0);
      expect(empty.objectStates).toHaveLength(0);
    });
  });
});