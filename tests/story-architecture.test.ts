import { describe, expect, it } from "vitest";
import {
  assertDiagnosis,
  assertArchitecture,

  deriveSeasonFocus,
  diagnosisToArchitectureGuidance,
  architectureToBibleGuidance,
} from "@/lib/domain/storyArchitecture";
import type { StoryDiagnosis, StoryArchitecture } from "@/lib/validation/storyArchitecture";

function makeDiagnosis(): StoryDiagnosis {
  return {
    strengths: ["Strong central mystery"],
    weaknesses: ["Pacing issues in the middle"],
    structuralIssues: [],
    characterIssues: ["Antagonist motivation unclear"],
    thematicIssues: [],
    recommendations: ["Clarify the antagonist's motivation"],
    overallAssessment: "A solid concept with a clear central mystery that needs antagonist development.",
    readinessScore: 65,
  };
}

function makeArchitecture(): StoryArchitecture {
  return {
    centralConflict: {
      description: "Amara vs the killer",
      type: "man_vs_man",
      stakes: "Justice for the king",
      escalationPath: "From suspicion to confrontation",
    },
    characterArcs: [
      {
        characterName: "Amara",
        arcType: "growth",
        startState: "Naive and fearful",
        endState: "Decisive and brave",
        keyTurningPoints: ["Episode 1: The letter", "Episode 3: The betrayal"],
      },
    ],
    plotStructure: {
      structure: "serialized",
      setup: "Amara receives a letter",
      incitingIncident: "The king is murdered",
      risingAction: "Amara investigates",
      climax: "Amara confronts the killer",
      resolution: "Justice is served",
    },
    thematicFramework: {
      primaryTheme: "Justice requires sacrifice",
      secondaryThemes: ["Truth vs safety"],
      recurringMotifs: ["Letters", "Shadows"],
      symbolism: ["The crown represents power"],
    },
    episodeBlueprint: {
      structure: "serialized",
      totalEpisodes: 6,
      arcAdvancingEpisodes: [1, 3, 6],
      standaloneEpisodes: [2, 4, 5],
      cliffhangerStrategy: "Each arc episode ends with a revelation",
    },
    pacingStrategy: {
      description: "Slow build with accelerating tension",
      tensionCurve: "Low to high across the season",
      keySetPieces: ["The confrontation in episode 6"],
    },
  };
}

describe("Story Architecture", () => {
  describe("assertDiagnosis", () => {
    it("passes for a valid diagnosis", () => {
      expect(() => assertDiagnosis(makeDiagnosis())).not.toThrow();
    });

    it("fails when there are no strengths or weaknesses", () => {
      const diagnosis = makeDiagnosis();
      diagnosis.strengths = [];
      diagnosis.weaknesses = [];
      expect(() => assertDiagnosis(diagnosis)).toThrow(/at least one strength or weakness/);
    });

    it("fails when the overall assessment is too brief", () => {
      const diagnosis = makeDiagnosis();
      diagnosis.overallAssessment = "OK";
      expect(() => assertDiagnosis(diagnosis)).toThrow(/too brief/);
    });
  });

  describe("assertArchitecture", () => {
    it("passes for a valid architecture", () => {
      expect(() => assertArchitecture(makeArchitecture())).not.toThrow();
    });

    it("fails when there are no character arcs", () => {
      const architecture = makeArchitecture();
      architecture.characterArcs = [];
      expect(() => assertArchitecture(architecture)).toThrow(/at least one character arc/);
    });

    it("fails when character arcs repeat a name", () => {
      const architecture = makeArchitecture();
      architecture.characterArcs = [
        { characterName: "Amara", arcType: "growth", startState: "", endState: "", keyTurningPoints: [] },
        { characterName: "Amara", arcType: "fall", startState: "", endState: "", keyTurningPoints: [] },
      ];
      expect(() => assertArchitecture(architecture)).toThrow(/repeat a character name/);
    });
  });

  describe("assertEpisodeBlueprint", () => {
    it("fails when an episode is both arc-advancing and standalone", () => {
      const architecture = makeArchitecture();
      architecture.episodeBlueprint.arcAdvancingEpisodes = [1, 2];
      architecture.episodeBlueprint.standaloneEpisodes = [2, 3];
      expect(() => assertArchitecture(architecture)).toThrow(/both arc-advancing and standalone/);
    });

    it("fails when an episode number is out of range", () => {
      const architecture = makeArchitecture();
      architecture.episodeBlueprint.arcAdvancingEpisodes = [99];
      expect(() => assertArchitecture(architecture)).toThrow(/out of range/);
    });
  });

  describe("deriveSeasonFocus", () => {
    it("identifies arc-advancing episodes", () => {
      const architecture = makeArchitecture();
      const focus = deriveSeasonFocus(architecture, 1);
      expect(focus.isArcAdvancing).toBe(true);
    });

    it("identifies standalone episodes", () => {
      const architecture = makeArchitecture();
      const focus = deriveSeasonFocus(architecture, 2);
      expect(focus.isArcAdvancing).toBe(false);
    });

    it("finds the character arc focus for an episode", () => {
      const architecture = makeArchitecture();
      const focus = deriveSeasonFocus(architecture, 1);
      expect(focus.arcFocus?.characterName).toBe("Amara");
    });
  });

  describe("diagnosisToArchitectureGuidance", () => {
    it("includes strengths, weaknesses, and recommendations", () => {
      const guidance = diagnosisToArchitectureGuidance(makeDiagnosis());
      expect(guidance).toContain("Strengths to preserve");
      expect(guidance).toContain("Weaknesses to address");
      expect(guidance).toContain("Recommendations to follow");
      expect(guidance).toContain("Readiness score: 65/100");
    });
  });

  describe("architectureToBibleGuidance", () => {
    it("includes central conflict, plot structure, and character arcs", () => {
      const guidance = architectureToBibleGuidance(makeArchitecture());
      expect(guidance).toContain("Central conflict: Amara vs the killer");
      expect(guidance).toContain("Plot structure: serialized");
      expect(guidance).toContain("Character arc — Amara");
      expect(guidance).toContain("Episode blueprint: serialized, 6 episodes");
    });
  });
});