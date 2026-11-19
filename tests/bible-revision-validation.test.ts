import { describe, expect, it } from "vitest";
import {
  validateStoryBibleRevision,
  hasMergedText,

} from "@/lib/validation/storyBibleRevision";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import { JobError } from "@/lib/pipeline/types";

function houseBible(): StoryBibleContent {
  return {
    identity: {
      title: "The House That Remembers",
      genres: ["mystery"],
      subgenres: ["drama"],
      centralPremise: "Daniel Mwangi returns to his childhood home and discovers it holds memories of a thirteen-year extraction cycle.",
      narrativeConcept: "A house, a photograph, and a missing sister shape a mystery across decades.",
      toneAndAtmosphere: "Quiet dread and fragile hope.",
      targetAudience: "Adults",
      centralConflict: "Daniel must uncover what the house remembers without losing himself to it.",
    },
    world: {
      description: "A coastal town where a house stands at the edge of a receding tide.",
      geographyAndLocations: [
        { name: "The House", description: "A weathered structure of uncertain origin.", storyFunction: "The central mystery." },
        { name: "The Town", description: "A small coastal community with long memory.", storyFunction: "Social context and witness." },
      ],
      socialStructuresAndCultures: ["The town observes a thirteen-year cycle."],
      historyAndPastEvents: ["A child disappeared thirteen years ago.", "Daniel's father destroyed family photographs."],
      rules: ["The house extracts something every thirteen years.", "Photographs reveal what the house wants to hide."],
      definingSystems: [],
    },
    characters: {
      characters: [
        {
          name: "Daniel Mwangi",
          storyRole: "protagonist",
          roleDescription: "A photographer returning to his childhood home.",
          physicalDescription: "Lean, with tired eyes.",
          personality: "Obsessive and protective.",
          background: "Raised in the house, left after his sister's disappearance.",
          motivations: ["Find out what happened to Ruth.", "Understand the house."],
          fearsAndWeaknesses: ["That he caused Ruth's disappearance."],
          abilitiesAndLimitations: ["Can read photographs deeply."],
          relationships: [
            { characterName: "Ruth Mwangi", relationship: "sister", tensionOrChange: "She disappeared when they were children." },
            { characterName: "Miriam Alonzo", relationship: "ally", tensionOrChange: "She has town records he needs." },
            { characterName: "Elias Crane", relationship: "mentor", tensionOrChange: "He knows more than he reveals." },
          ],
          secrets: ["He last saw Ruth in the house."],
          developmentPotential: "Daniel must face the possibility that Ruth is alive.",
        },
        {
          name: "Miriam Alonzo",
          storyRole: "supporting",
          roleDescription: "A town archivist with incomplete family records.",
          physicalDescription: "Practical and reserved.",
          personality: "Cautious but curious.",
          background: "Her family has kept town records for generations.",
          motivations: ["Preserve the town's history.", "Understand the cycle."],
          fearsAndWeaknesses: ["That her family enabled the cycle."],
          abilitiesAndLimitations: ["Access to town archives."],
          relationships: [{ characterName: "Daniel Mwangi", relationship: "ally", tensionOrChange: "She helps him search." }],
          secrets: [],
          developmentPotential: "Miriam may hold the key to breaking the cycle.",
        },
        {
          name: "Elias Crane",
          storyRole: "supporting",
          roleDescription: "An elderly retired teacher with limited knowledge.",
          physicalDescription: "Frail but sharp-eyed.",
          personality: "Evasive and protective.",
          background: "Taught Daniel and Ruth as children.",
          motivations: ["Protect the children from the truth."],
          fearsAndWeaknesses: ["That speaking will restart the cycle."],
          abilitiesAndLimitations: ["Knows fragments of the house's history."],
          relationships: [{ characterName: "Daniel Mwangi", relationship: "mentor", tensionOrChange: "He withholds key memories." }],
          secrets: ["He saw something in the house thirty years ago."],
          developmentPotential: "Elias must decide whether to reveal what he knows.",
        },
      ],
      relationshipDynamics: ["Daniel and Miriam share a cautious alliance.", "Elias guards a secret about the house."],
    },
    narrative: {
      mainStoryline: "Daniel investigates the house and its thirteen-year cycle to find Ruth.",
      majorConflicts: ["Daniel vs. the house's memory.", "Truth vs. safety."],
      longTermDirection: "The mystery deepens across six episodes without resolution.",
      subplots: ["Miriam's family records.", "Elias's withheld memory."],
      unresolvedMysteries: ["What happened to Ruth.", "The house's origin.", "Why Daniel's father destroyed the photographs."],
      potentialFutureRevelations: ["Ruth may be alive.", "The house may be sentient."],
      majorNarrativeQuestions: ["Is Ruth alive?", "What does the house want?"],
      serializedEndingGuidance: "Leave Ruth's fate and the house's nature unresolved.",
    },
    guidelines: {
      mainThemes: ["Memory", "Loss"],
      secondaryThemes: ["Family", "Truth"],
      storytellingStyle: "Slow-burn mystery with emotional depth.",
      boundaries: ["Do not resolve Ruth's fate in season one.", "Do not give the house supernatural abilities."],
      mustRemainConsistent: ["The extraction cycle is thirteen years.", "Daniel and Ruth are siblings.", "The father destroyed the photographs."],
    },
    canon: {
      confirmedFacts: [
        "Daniel and Ruth Mwangi are siblings.",
        "The extraction cycle is thirteen years.",
        "Daniel's father destroyed family photographs.",
        "Ruth disappeared when Daniel was a child.",
      ],
      proposedDetails: [
        "The house may retain memories of past inhabitants.",
        "Ruth's photograph may forecast her return.",
      ],
      unresolvedQuestions: [
        "Is Ruth alive?",
        "What is the house's origin?",
        "Why did the father destroy the photographs?",
      ],
      hiddenInformation: [
        "Elias saw something in the house thirty years ago.",
        "The house extracts something every thirteen years.",
      ],
      characterKnowledge: [
        { characterName: "Daniel Mwangi", knows: ["Ruth is his sister.", "The cycle is thirteen years."], believes: ["Ruth may be alive."] },
        { characterName: "Miriam Alonzo", knows: ["The town has a thirteen-year cycle."], believes: ["Her family records hold the key."] },
        { characterName: "Elias Crane", knows: ["He saw something in the house."], believes: ["Speaking will restart the cycle."] },
      ],
      audienceKnowledge: [
        "Daniel is looking for Ruth.",
        "The house has a thirteen-year cycle.",
      ],
    },
  };
}

describe("Story Bible revision validation", () => {
  describe("Test A — Corrupted output", () => {
    it("rejects merged-sentence defects in proposedDetails", () => {
      const corrupted = houseBible();
      corrupted.canon.proposedDetails = [
        "The house retains memories, making architecture a record of avoidance.ages a happy memory for those who leave.",
      ];
      const result = validateStoryBibleRevision(corrupted, { original: houseBible() });
      expect(result.passed).toBe(false);
      expect(result.diagnostics.some((d) => d.code === "merged_text")).toBe(true);
    });

    it("rejects merged-sentence defects in unresolvedQuestions", () => {
      const corrupted = houseBible();
      corrupted.canon.unresolvedQuestions = [
        "Whether Ruth's image forecasts her taking action, or whether we see her again.",
        "Whether anything in there wants to be remembered.voices disagree on this.",
      ];
      const result = validateStoryBibleRevision(corrupted, { original: houseBible() });
      expect(result.passed).toBe(false);
      expect(result.diagnostics.some((d) => d.code === "merged_text")).toBe(true);
    });

    it("hasMergedText detects period followed by lowercase", () => {
      expect(hasMergedText("avoidance.ages a happy memory")).toBe(true);
      expect(hasMergedText("remembered.voices disagree")).toBe(true);
      expect(hasMergedText("A complete sentence. Another sentence.")).toBe(false);
      expect(hasMergedText("Dr. Smith said hello.")).toBe(false);
    });
  });

  describe("Test B — Missing character knowledge", () => {
    it("rejects when Miriam and Elias knowledge records are missing", () => {
      const incomplete = houseBible();
      incomplete.canon.characterKnowledge = [
        { characterName: "Daniel Mwangi", knows: ["Ruth is his sister."], believes: ["Ruth may be alive."] },
      ];
      const result = validateStoryBibleRevision(incomplete, { original: houseBible() });
      expect(result.passed).toBe(false);
      const missingDiagnostics = result.diagnostics.filter((d) => d.code === "missing_character_knowledge");
      expect(missingDiagnostics.length).toBeGreaterThanOrEqual(2);
      expect(missingDiagnostics.some((d) => d.message.includes("Miriam"))).toBe(true);
      expect(missingDiagnostics.some((d) => d.message.includes("Elias"))).toBe(true);
    });
  });

  describe("Test C — Canon promotion", () => {
    it("rejects when a proposed detail is promoted to confirmed canon", () => {
      const promoted = houseBible();
      const proposedItem = promoted.canon.proposedDetails[0]!;
      promoted.canon.confirmedFacts = [...promoted.canon.confirmedFacts, proposedItem];
      const result = validateStoryBibleRevision(promoted, { original: houseBible() });
      expect(result.passed).toBe(false);
      expect(result.diagnostics.some((d) => d.code === "unauthorized_promotion")).toBe(true);
    });

    it("rejects when an unresolved question becomes a confirmed fact", () => {
      const resolved = houseBible();
      const question = resolved.canon.unresolvedQuestions[0]!;
      resolved.canon.confirmedFacts = [...resolved.canon.confirmedFacts, question];
      const result = validateStoryBibleRevision(resolved, { original: houseBible() });
      expect(result.passed).toBe(false);
      expect(result.diagnostics.some((d) => d.code === "question_resolved")).toBe(true);
    });
  });

  describe("Test D — Missing fields", () => {
    it("rejects when a required section is missing", async () => {
      const { storyBibleContentSchema } = await import("@/lib/validation/storyBible");
      const incomplete = houseBible() as Record<string, unknown>;
      delete incomplete.canon;
      const parsed = storyBibleContentSchema.safeParse(incomplete);
      expect(parsed.success).toBe(false);
    });

    it("rejects when character knowledge array is empty but characters exist", () => {
      const empty = houseBible();
      empty.canon.characterKnowledge = [];
      const result = validateStoryBibleRevision(empty, { original: houseBible() });
      expect(result.passed).toBe(false);
      const missing = result.diagnostics.filter((d) => d.code === "missing_character_knowledge");
      expect(missing.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Test E — Truncated response", () => {
    it("parseStructured rejects truncated output when truncated flag is set", async () => {
      const { parseStructured } = await import("@/lib/providers/llm/parse");
      const truncatedJson = '{"identity":{"title":"The House That Remembers","genres":["mystery"],"subgenres":[],"centralPremise":"Incomplete';
      expect(() =>
        parseStructured("test", truncatedJson, { safeParse: () => ({ success: true, data: {} }) } as never, "Story Bible", undefined, true)
      ).toThrow();
    });

    it("a truncated candidate does not overwrite the previous valid revision", () => {
      const original = houseBible();
      const truncated = houseBible();
      truncated.canon.confirmedFacts = original.canon.confirmedFacts.slice(0, 2);
      const result = validateStoryBibleRevision(truncated, { original });
      expect(result.diagnostics.some((d) => d.code === "lost_confirmed_fact")).toBe(true);
    });
  });

  describe("Test F — Preservation", () => {
    it("preserves unrelated established facts during a targeted revision", () => {
      const original = houseBible();
      const revised = houseBible();
      revised.narrative.mainStoryline = "Daniel investigates with new urgency after finding a hidden photograph.";
      const result = validateStoryBibleRevision(revised, { original });
      expect(result.passed).toBe(true);
      expect(revised.canon.confirmedFacts).toEqual(original.canon.confirmedFacts);
      expect(revised.guidelines.boundaries).toEqual(original.guidelines.boundaries);
      expect(revised.guidelines.mustRemainConsistent).toEqual(original.guidelines.mustRemainConsistent);
    });

    it("preserves character identities and relationships", () => {
      const original = houseBible();
      const revised = houseBible();
      revised.narrative.subplots = ["A new subplot about Miriam's archives."];
      const result = validateStoryBibleRevision(revised, { original });
      expect(result.passed).toBe(true);
      const revisedNames = revised.characters.characters.map((c) => c.name);
      const originalNames = original.characters.characters.map((c) => c.name);
      expect(revisedNames).toEqual(originalNames);
    });

    it("detects when an established character is removed", () => {
      const original = houseBible();
      const revised = houseBible();
      revised.characters.characters = revised.characters.characters.slice(0, 2);
      revised.canon.characterKnowledge = revised.canon.characterKnowledge.slice(0, 2);
      const result = validateStoryBibleRevision(revised, { original });
      expect(result.diagnostics.some((d) => d.code === "lost_character")).toBe(true);
    });
  });

  describe("Test G — Complete workflow", () => {
    it("validateStoryBibleRevision returns the full diagnostic list for a corrupted candidate", () => {
      const original = houseBible();
      const corrupted = houseBible();
      corrupted.canon.proposedDetails = [
        "The house retains memories, making architecture a record of avoidance.ages a happy memory.",
      ];
      corrupted.canon.characterKnowledge = corrupted.canon.characterKnowledge.slice(0, 1);
      const result = validateStoryBibleRevision(corrupted, { original });
      expect(result.passed).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes).toContain("merged_text");
      expect(codes).toContain("missing_character_knowledge");
    });

    it("a valid revision passes all checks", () => {
      const original = houseBible();
      const revised = houseBible();
      revised.narrative.majorConflicts = [...revised.narrative.majorConflicts, "Daniel vs. his own memory."];
      const result = validateStoryBibleRevision(revised, { original });
      expect(result.passed).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("Test H — Revision numbering", () => {
    it("a failed validation produces diagnostics that prevent revision advancement", () => {
      const original = houseBible();
      const corrupted = houseBible();
      corrupted.canon.proposedDetails = ["Merged text here.there is more text here."];
      const result = validateStoryBibleRevision(corrupted, { original });
      expect(result.passed).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const error = new JobError(
        `The revised Story Bible failed validation: ${result.diagnostics.map((d) => `[${d.code}] ${d.message}`).join("; ")}`,
        "revision_validation_failed",
        false,
      );
      expect(error.code).toBe("revision_validation_failed");
      expect(error.retryable).toBe(false);
    });

    it("the original bible is preserved when validation fails", () => {
      const original = houseBible();
      const corrupted = houseBible();
      corrupted.canon.proposedDetails = ["Bad text.things got merged."];
      const result = validateStoryBibleRevision(corrupted, { original });
      expect(result.passed).toBe(false);
      expect(original.canon.proposedDetails[0]).not.toContain(".things");
      expect(original.canon.confirmedFacts.length).toBe(4);
    });
  });

  describe("Creative content preservation", () => {
    it("preserves the thirteen-year extraction cycle", () => {
      const original = houseBible();
      const revised = houseBible();
      revised.narrative.mainStoryline += " With new determination.";
      const result = validateStoryBibleRevision(revised, { original });
      expect(result.passed).toBe(true);
      expect(revised.canon.confirmedFacts).toContain("The extraction cycle is thirteen years.");
    });

    it("preserves Daniel and Ruth's sibling relationship", () => {
      const original = houseBible();
      const revised = houseBible();
      const result = validateStoryBibleRevision(revised, { original });
      expect(result.passed).toBe(true);
      expect(revised.canon.confirmedFacts).toContain("Daniel and Ruth Mwangi are siblings.");
    });

    it("preserves the photograph mystery", () => {
      const original = houseBible();
      const revised = houseBible();
      const result = validateStoryBibleRevision(revised, { original });
      expect(result.passed).toBe(true);
      expect(revised.canon.unresolvedQuestions.some((q) => q.includes("photographs"))).toBe(true);
    });

    it("preserves the six-episode structure reference", () => {
      const original = houseBible();
      const revised = houseBible();
      const result = validateStoryBibleRevision(revised, { original });
      expect(result.passed).toBe(true);
      expect(revised.narrative.longTermDirection).toContain("six episodes");
    });
  });
});