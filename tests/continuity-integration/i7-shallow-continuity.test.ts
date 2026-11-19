import { describe, it, expect } from "vitest";
import { validateEpisodeScreenplay } from "@/lib/domain/screenplayValidation";
import { makeScene, makeLedger, makeCharacterState, makeStoryBible } from "./fixtures";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";

function validate(screenplay: ScreenplayScene[], ledger: ContinuityLedger | null) {
  return validateEpisodeScreenplay({
    episodeNumber: 2,
    seriesTitle: "Test Series",
    story: {
      title: "Episode 2",
      synopsis: "The story continues as Alice investigates the mystery at the old house with surprising developments.",
      screenplay,
    },
    targetDurationSeconds: 180,
    bible: makeStoryBible(),
    seasonPlan: null,
    episodePlan: null,
    ledger,
    previousEpisodes: [],
  });
}

function hasFindingByCode(findings: ReturnType<typeof validate>["findings"], code: string): boolean {
  return findings.some((f) => f.code === code);
}

describe("I-7: Stage H continuity checks are shallow", () => {
  describe("character-location consistency", () => {
    it("warns when a character appears at a location that does not match the ledger", () => {
      const ledger = makeLedger({
        characterStates: [
          makeCharacterState({ name: "Alice", currentLocation: "Town Square" }),
        ],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          location: "The Old House",
          charactersPresent: ["Alice"],
          action: "Alice stands alone.",
          visualDescription: "A dim interior.",
          dialogue: [{ characterName: "Alice", line: "This place feels wrong." }],
        }),
        makeScene({
          sceneNumber: 2,
          location: "The Old House",
          charactersPresent: ["Alice"],
          action: "Alice searches the room.",
          visualDescription: "Dust motes in the light.",
          dialogue: [{ characterName: "Alice", line: "There must be something here." }],
        }),
        makeScene({
          sceneNumber: 3,
          location: "The Old House",
          charactersPresent: ["Alice"],
          action: "Alice finds a clue.",
          visualDescription: "A hidden compartment opens.",
          dialogue: [{ characterName: "Alice", line: "I knew it." }],
        }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "character_location_mismatch")).toBe(true);
    });

    it("does not warn when the character is at the ledger location", () => {
      const ledger = makeLedger({
        characterStates: [
          makeCharacterState({ name: "Alice", currentLocation: "Town Square" }),
        ],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({ sceneNumber: 1, location: "Town Square", charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 2, location: "Town Square", charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 3, location: "Town Square", charactersPresent: ["Alice"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "character_location_mismatch")).toBe(false);
    });
  });

  describe("resolved-thread reopened", () => {
    it("warns when a resolved thread is reopened with question language", () => {
      const ledger = makeLedger({
        unresolvedThreads: [
          { thread: "Who is the secret informant?", introducedInEpisode: 1, status: "resolved" },
        ],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          charactersPresent: ["Alice"],
          dialogue: [{ characterName: "Alice", line: "But who is the secret informant really?" }],
        }),
        makeScene({ sceneNumber: 2, charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 3, charactersPresent: ["Alice"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "resolved_thread_reopened")).toBe(true);
    });

    it("does not warn when a resolved thread is referenced as settled", () => {
      const ledger = makeLedger({
        unresolvedThreads: [
          { thread: "The artifact was recovered intact", introducedInEpisode: 1, status: "resolved" },
        ],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          charactersPresent: ["Alice"],
          dialogue: [{ characterName: "Alice", line: "As we already know, the artifact was recovered intact." }],
        }),
        makeScene({ sceneNumber: 2, charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 3, charactersPresent: ["Alice"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "resolved_thread_reopened")).toBe(false);
    });
  });

  describe("location-state consistency", () => {
    it("warns when a destroyed location is shown as active", () => {
      const ledger = makeLedger({
        locationStates: [
          { name: "The Old House", currentState: "burned and destroyed", lastSeenEpisode: 1 },
        ],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          location: "The Old House",
          charactersPresent: ["Alice"],
          visualDescription: "The house is bustling and bright, full of life.",
        }),
        makeScene({ sceneNumber: 2, location: "The Old House", charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 3, location: "The Old House", charactersPresent: ["Alice"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "location_state_contradiction")).toBe(true);
    });

    it("does not warn when the location state is not terminal", () => {
      const ledger = makeLedger({
        locationStates: [
          { name: "The Old House", currentState: "renovated and open", lastSeenEpisode: 1 },
        ],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          location: "The Old House",
          charactersPresent: ["Alice"],
          visualDescription: "The house is bustling and bright.",
        }),
        makeScene({ sceneNumber: 2, location: "The Old House", charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 3, location: "The Old House", charactersPresent: ["Alice"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "location_state_contradiction")).toBe(false);
    });
  });

  describe("object-ownership consistency", () => {
    it("warns when a non-owner uses an object without the owner present", () => {
      const ledger = makeLedger({
        objectStates: [
          { name: "the letter", ownership: "Alice", condition: "intact", lastSeenEpisode: 1 },
        ],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          charactersPresent: ["Bob"],
          dialogue: [{ characterName: "Bob", line: "I will read the letter now." }],
        }),
        makeScene({ sceneNumber: 2, charactersPresent: ["Bob"] }),
        makeScene({ sceneNumber: 3, charactersPresent: ["Bob"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "object_ownership_mismatch")).toBe(true);
    });

    it("does not warn when the owner is present", () => {
      const ledger = makeLedger({
        objectStates: [
          { name: "the letter", ownership: "Alice", condition: "intact", lastSeenEpisode: 1 },
        ],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          charactersPresent: ["Alice", "Bob"],
          dialogue: [{ characterName: "Bob", line: "I see the letter." }],
        }),
        makeScene({ sceneNumber: 2, charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 3, charactersPresent: ["Alice"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "object_ownership_mismatch")).toBe(false);
    });
  });

  describe("revealed-secret re-revelation", () => {
    it("warns when an already-revealed secret is presented as new", () => {
      const ledger = makeLedger({
        revealedSecrets: ["Bob knows the dark secret"],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          charactersPresent: ["Alice"],
          dialogue: [{ characterName: "Alice", line: "The truth is Bob knows the dark secret all along." }],
        }),
        makeScene({ sceneNumber: 2, charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 3, charactersPresent: ["Alice"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "secret_re_revealed")).toBe(true);
    });

    it("does not warn when a revealed secret is referenced without revelation language", () => {
      const ledger = makeLedger({
        revealedSecrets: ["Bob knows the dark secret"],
      });
      const screenplay: ScreenplayScene[] = [
        makeScene({
          sceneNumber: 1,
          charactersPresent: ["Alice"],
          dialogue: [{ characterName: "Alice", line: "We already know Bob knows the dark secret." }],
        }),
        makeScene({ sceneNumber: 2, charactersPresent: ["Alice"] }),
        makeScene({ sceneNumber: 3, charactersPresent: ["Alice"] }),
      ];
      const result = validate(screenplay, ledger);
      expect(hasFindingByCode(result.findings, "secret_re_revealed")).toBe(false);
    });
  });

  describe("aggregate continuity checks", () => {
    it("produces no continuity findings when the ledger is empty", () => {
      const screenplay: ScreenplayScene[] = [
        makeScene({ sceneNumber: 1 }),
        makeScene({ sceneNumber: 2 }),
        makeScene({ sceneNumber: 3 }),
      ];
      const result = validate(screenplay, null);
      const continuityCodes = result.findings
        .filter((f) => f.category === "continuity" && f.code)
        .map((f) => f.code);
      expect(continuityCodes).not.toContain("character_location_mismatch");
      expect(continuityCodes).not.toContain("resolved_thread_reopened");
      expect(continuityCodes).not.toContain("location_state_contradiction");
      expect(continuityCodes).not.toContain("object_ownership_mismatch");
      expect(continuityCodes).not.toContain("secret_re_revealed");
    });
  });
});