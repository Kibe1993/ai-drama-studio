import { describe, it, expect } from "vitest";
import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import { validateSeasonPlanRich } from "@/lib/domain/planValidation";
import { validateSeasonPlan } from "@/lib/domain/seasonPlanValidation";
import { buildValidationReport } from "@/lib/services/seasonPlanValidationService";
import {
  isRepairIsolated,
  selectFindingsForRepair,
  createRepairAttempt,
  shouldAttemptRepair,
} from "@/lib/domain/planValidation/repairEngine";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";

function makeBible(): StoryBibleContent {
  return {
    identity: {
      title: "The Man Who Remembered Tomorrow",
      genres: ["Drama", "Sci-Fi"],
      subgenres: ["Psychological"],
      centralPremise: "A man remembers future events and must navigate the consequences.",
      narrativeConcept: "Daniel's ability to remember tomorrow creates a recursive loop of grief and acceptance.",
      toneAndAtmosphere: "Melancholic, contemplative, surreal",
      targetAudience: "Adults who enjoy literary science fiction",
      centralConflict: "Daniel must accept his mortality while his memories of the future haunt him.",
    },
    world: {
      description: "A contemporary world where Daniel experiences memories of future events.",
      geographyAndLocations: [
        { name: "Daniel's Apartment", description: "A small apartment where Daniel lives alone.", storyFunction: "Daniel's home base" },
        { name: "The Hospital", description: "Where Daniel receives treatment.", storyFunction: "Medical setting" },
      ],
      socialStructuresAndCultures: ["Modern urban society"],
      historyAndPastEvents: ["Daniel had a wife named Lily who is his daughter in this story"],
      rules: ["Daniel's memories of the future are real but fragmented", "The future cannot be changed, only accepted"],
      definingSystems: [],
    },
    characters: {
      characters: [
        {
          name: "Daniel",
          storyRole: "protagonist",
          roleDescription: "A man who remembers future events",
          physicalDescription: "Middle-aged, tired eyes",
          personality: "Contemplative, grieving, determined",
          background: "Lost his wife and struggles with his ability",
          motivations: ["To understand his ability", "To protect Lily"],
          fearsAndWeaknesses: ["Losing Lily", "Going mad"],
          abilitiesAndLimitations: ["Remembers future events", "Cannot change the future"],
          relationships: [
            { characterName: "Lily", relationship: "Daniel is Lily's father", tensionOrChange: "Protective father-daughter bond" },
          ],
          secrets: ["The full extent of his future memories"],
          developmentPotential: "Daniel must learn to accept his fate",
        },
        {
          name: "Lily",
          storyRole: "supporting",
          roleDescription: "Daniel's daughter",
          physicalDescription: "Young woman",
          personality: "Caring, curious",
          background: "Daniel's daughter who cares for him",
          motivations: ["To help her father"],
          fearsAndWeaknesses: ["Losing her father"],
          abilitiesAndLimitations: [],
          relationships: [
            { characterName: "Daniel", relationship: "Lily is Daniel's daughter", tensionOrChange: "Father-daughter bond" },
          ],
          secrets: [],
          developmentPotential: "Lily must learn to let go",
        },
      ],
      relationshipDynamics: ["Daniel and Lily share a deep father-daughter bond"],
    },
    narrative: {
      mainStoryline: "Daniel remembers his own death and must come to terms with it.",
      majorConflicts: ["Daniel vs. his memories", "Daniel vs. acceptance"],
      longTermDirection: "Daniel eventually accepts his funeral and finds peace.",
      subplots: ["Lily's struggle to understand her father"],
      unresolvedMysteries: ["The origin of Daniel's ability"],
      potentialFutureRevelations: ["The meaning of the final light"],
      majorNarrativeQuestions: ["Will Daniel accept his fate?"],
      serializedEndingGuidance: "Daniel accepts his funeral in the finale.",
    },
    guidelines: {
      mainThemes: ["Acceptance", "Grief", "Memory"],
      secondaryThemes: ["Family", "Mortality"],
      storytellingStyle: "Contemplative, non-linear",
      boundaries: ["Daniel cannot change the future", "The memories are real, not hallucinations"],
      mustRemainConsistent: ["Daniel is Lily's father", "Daniel's memories are real"],
    },
    canon: {
      confirmedFacts: ["Daniel is Lily's father", "Daniel remembers future events"],
      proposedDetails: [],
      unresolvedQuestions: ["The origin of Daniel's ability"],
      hiddenInformation: ["The full meaning of the final light"],
      characterKnowledge: [
        { characterName: "Daniel", knows: ["He will die", "Lily is his daughter"], believes: ["The future cannot be changed"] },
        { characterName: "Lily", knows: ["Daniel is her father"], believes: ["Daniel is unwell"] },
      ],
      audienceKnowledge: ["Daniel remembers the future"],
    },
  };
}

function makeEpisode(num: number, overrides?: Partial<SeasonPlan["episodeProgression"][0]>): SeasonPlan["episodeProgression"][0] {
  return {
    episodeNumber: num,
    workingTitle: `Episode ${num}`,
    narrativePurpose: `Advance the story in episode ${num}`,
    startingSituation: `The situation at the start of episode ${num}`,
    mainObjective: `The objective for episode ${num}`,
    centralConflict: `The conflict in episode ${num}`,
    majorStoryBeats: [`Beat 1 of episode ${num}`, `Beat 2 of episode ${num}`],
    informationRevealed: [],
    characterDevelopment: `Daniel and Lily develop in episode ${num}`,
    importantEvents: [`Event in episode ${num}`],
    consequences: [`Consequence of episode ${num}`],
    storyContribution: `This episode advances the season by ${num}`,
    endingOrCliffhanger: `The ending of episode ${num}`,
    unresolvedThreads: [],
    continuityRequirements: `Must maintain continuity from episode ${num - 1}`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
    ...overrides,
  };
}

function makePlan(episodes: SeasonPlan["episodeProgression"]): SeasonPlan {
  return {
    seasonObjective: "Daniel must accept his mortality and his funeral.",
    centralConflictOrMystery: "Daniel remembers his own death and struggles to accept it.",
    mainCharacterObjectives: "Daniel seeks peace; Lily seeks understanding.",
    overallCharacterDevelopment: "Daniel goes from denial to acceptance; Lily goes from confusion to understanding.",
    majorStoryDevelopments: ["Daniel's memories intensify", "Lily discovers the truth"],
    beginningDirection: "Establish Daniel's ability and his relationship with Lily.",
    middleDirection: "Complicate Daniel's journey as memories become more vivid.",
    endingDirection: "Daniel accepts his funeral and finds peace.",
    episodeProgression: episodes,
    importantRevelations: ["The meaning of Daniel's memories"],
    relationshipChanges: [],
    consequencesCarriedBetween: ["Daniel's growing acceptance"],
    setupAndPayoff: ["Daniel's denial sets up his eventual acceptance"],
    unresolvedQuestions: ["The origin of Daniel's ability"],
    intendedSeasonConclusion: "Daniel accepts his funeral in the final episode.",
  };
}

describe("Season Plan Validation Engine — Regression Tests", () => {
  describe("Regression Test 1: Premature climax", () => {
    it("detects when Episode 1 prematurely executes the season's intended conclusion", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1, {
          endingOrCliffhanger: "Daniel accepts his funeral and is engulfed by bright light, completing his journey.",
          centralConflict: "Daniel accepts his funeral and finds peace.",
          importantEvents: ["Daniel accepts his funeral"],
        }),
        makeEpisode(2),
        makeEpisode(3),
        makeEpisode(4),
        makeEpisode(5),
        makeEpisode(6, {
          endingOrCliffhanger: "Daniel accepts his funeral and is engulfed by bright light.",
          centralConflict: "Daniel accepts his funeral and finds peace.",
          importantEvents: ["Daniel accepts his funeral"],
        }),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const prematureFindings = result.findings.filter(
        (f) => f.category === "premature_climax" && f.episodeNumber === 1
      );
      expect(prematureFindings.length).toBeGreaterThan(0);
      expect(prematureFindings.some((f) => f.severity === "blocking" || f.severity === "high")).toBe(true);
    });
  });

  describe("Regression Test 2: Character relationship contradiction", () => {
    it("detects when Lily is described as Daniel's son instead of daughter", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1),
        makeEpisode(2),
        makeEpisode(3),
        makeEpisode(4, {
          relationshipChanges: [
            { from: "Lily", to: "Daniel", change: "Lily is Daniel's son" },
          ],
        }),
        makeEpisode(5),
        makeEpisode(6),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const relFindings = result.findings.filter(
        (f) => f.category === "relationship_integrity" && f.episodeNumber === 4
      );
      expect(relFindings.length).toBeGreaterThan(0);
      expect(relFindings.some((f) => f.severity === "blocking")).toBe(true);
      expect(relFindings.some((f) => f.canonIssueType === "RELATIONSHIP_CONTRADICTION")).toBe(true);
    });
  });

  describe("Regression Test 3: Opening event inconsistency", () => {
    it("detects when Episode 1 describes a different opening event than the season overview", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1, {
          startingSituation: "Daniel prevents a train derailment using his future memories.",
          importantEvents: ["Daniel prevents a train derailment"],
          majorStoryBeats: ["Daniel sees a train derailment in his memories and prevents it"],
        }),
        makeEpisode(2, {
          startingSituation: "Following the deadly car crash, Daniel struggles with his memories.",
        }),
        makeEpisode(3),
        makeEpisode(4),
        makeEpisode(5),
        makeEpisode(6),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const continuityFindings = result.findings.filter(
        (f) => f.category === "temporal_continuity" && f.episodeNumber === 2
      );
      expect(continuityFindings.length).toBeGreaterThan(0);
    });
  });

  describe("Regression Test 4: Unexplained character knowledge", () => {
    it("detects when a character knows information before it is revealed", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1),
        makeEpisode(2, {
          characterDevelopment: "Lily knows the identity of the stranger and confronts Daniel about it.",
          majorStoryBeats: ["Lily reveals she knows the stranger is Daniel's doctor"],
        }),
        makeEpisode(3, {
          informationRevealed: ["The stranger is Daniel's doctor"],
          majorStoryBeats: ["The stranger's identity as Daniel's doctor is revealed"],
        }),
        makeEpisode(4),
        makeEpisode(5),
        makeEpisode(6),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const knowledgeFindings = result.findings.filter(
        (f) => f.category === "knowledge_chronology"
      );
      expect(knowledgeFindings.length).toBeGreaterThan(0);
    });
  });

  describe("Regression Test 5: Unexplained object appearance", () => {
    it("detects when an important object is used without prior introduction", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1),
        makeEpisode(2),
        makeEpisode(3),
        makeEpisode(4),
        makeEpisode(5, {
          objectChanges: [
            { name: "Daniel's journal", ownership: "Daniel", condition: "Daniel reads from his journal" },
          ],
          majorStoryBeats: ["Daniel uses his journal to decode his memories"],
        }),
        makeEpisode(6),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const objectFindings = result.findings.filter(
        (f) => f.category === "unknown_entity_reference" && f.episodeNumber === 5
      );
      expect(objectFindings.length).toBeGreaterThan(0);
    });
  });

  describe("Regression Test 6: Unresolved major story thread", () => {
    it("flags a major mystery that is never resolved or deliberately carried forward", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1, {
          majorStoryBeats: ["A mysterious old woman gives Daniel a cryptic message about his future"],
          unresolvedThreads: [],
        }),
        makeEpisode(2),
        makeEpisode(3),
        makeEpisode(4),
        makeEpisode(5),
        makeEpisode(6),
      ]);
      plan.setupAndPayoff = [];
      plan.unresolvedQuestions = [];

      const result = validateSeasonPlanRich(plan, bible);
      const threadFindings = result.findings.filter(
        (f) => f.category === "setup_payoff"
      );
      expect(threadFindings.length).toBeGreaterThan(0);
    });
  });

  describe("Regression Test 7: Legitimate nonlinear storytelling", () => {
    it("does not flag a deliberate flashback as a chronology contradiction", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1),
        makeEpisode(2, {
          startingSituation: "In a flashback to years ago, Daniel first meets Lily as a child.",
          narrativePurpose: "Through a flashback memory, we see Daniel's early relationship with Lily.",
          majorStoryBeats: ["Flashback: Daniel holds baby Lily for the first time"],
        }),
        makeEpisode(3),
        makeEpisode(4),
        makeEpisode(5),
        makeEpisode(6),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const temporalFindings = result.findings.filter(
        (f) => f.category === "temporal_continuity" && f.episodeNumber === 2 &&
          f.message.toLowerCase().includes("flashback")
      );
      expect(temporalFindings.length).toBe(0);
    });
  });

  describe("Regression Test 8: Intentional ambiguity", () => {
    it("does not force a definitive explanation for deliberately unresolved questions", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1),
        makeEpisode(2),
        makeEpisode(3),
        makeEpisode(4),
        makeEpisode(5),
        makeEpisode(6, {
          endingOrCliffhanger: "Lily's alternate reality remains unexplained, deliberately left open for the audience.",
          unresolvedThreads: ["Lily's alternate reality is deliberately left unexplained"],
        }),
      ]);
      plan.unresolvedQuestions = ["Lily's alternate reality is deliberately left unexplained"];

      const result = validateSeasonPlanRich(plan, bible);
      const unresolvedFindings = result.findings.filter(
        (f) => f.category === "setup_payoff" &&
          f.message.toLowerCase().includes("alternate reality")
      );
      expect(unresolvedFindings.length).toBe(0);
    });
  });

  describe("Regression Test 9: Character development", () => {
    it("accepts a character transition supported by a clear sequence of events", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1, {
          characterArcChanges: [{ name: "Lily", change: "Lily is skeptical of Daniel's abilities" }],
          relationshipChanges: [{ from: "Lily", to: "Daniel", change: "Lily distrusts Daniel's claims" }],
        }),
        makeEpisode(2, {
          majorStoryBeats: ["Daniel demonstrates his ability by predicting an event", "Lily witnesses the prediction come true"],
        }),
        makeEpisode(3, {
          majorStoryBeats: ["Lily confronts Daniel and demands the truth", "Daniel reveals everything"],
          characterArcChanges: [{ name: "Lily", change: "Lily begins to trust Daniel" }],
          relationshipChanges: [{ from: "Lily", to: "Daniel", change: "Lily becomes Daniel's ally after learning the truth" }],
        }),
        makeEpisode(4),
        makeEpisode(5),
        makeEpisode(6),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const transitionFindings = result.findings.filter(
        (f) => f.category === "character_state" && f.episodeNumber === 3 &&
          f.message.toLowerCase().includes("without a clear cause")
      );
      expect(transitionFindings.length).toBe(0);
    });
  });

  describe("Regression Test 10: Repair isolation", () => {
    it("repairs only the affected episode without rewriting others", () => {
      const plan = makePlan([
        makeEpisode(1),
        makeEpisode(2),
        makeEpisode(3, {
          centralConflict: "Daniel accepts his funeral and finds peace.",
          endingOrCliffhanger: "Daniel accepts his funeral and is engulfed by bright light.",
        }),
        makeEpisode(4),
        makeEpisode(5),
        makeEpisode(6),
      ]);

      const repairedEpisode3 = makeEpisode(3, {
        centralConflict: "Daniel struggles with a new challenge in episode 3.",
        endingOrCliffhanger: "Daniel faces a setback but continues his journey.",
      });
      const repairedPlan: SeasonPlan = {
        ...plan,
        episodeProgression: plan.episodeProgression.map((ep) =>
          ep.episodeNumber === 3 ? repairedEpisode3 : ep
        ),
      };

      const isolated = isRepairIsolated(plan, repairedPlan, 3);
      expect(isolated).toBe(true);
    });
  });
});

describe("Season Plan Validation Engine — Additional Tests", () => {
  describe("Duplicate episode identifiers", () => {
    it("detects duplicate episode numbers", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1),
        makeEpisode(2),
        makeEpisode(2),
        makeEpisode(3),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const dupFindings = result.findings.filter(
        (f) => f.category === "episode_indexing" && f.message.toLowerCase().includes("duplicat")
      );
      expect(dupFindings.length).toBeGreaterThan(0);
      expect(dupFindings.some((f) => f.severity === "blocking")).toBe(true);
    });
  });

  describe("Missing mandatory fields", () => {
    it("detects when an episode is missing a required field", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1, { narrativePurpose: "x" }),
        makeEpisode(2),
        makeEpisode(3),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const missingFindings = result.findings.filter(
        (f) => f.category === "structural" && f.episodeNumber === 1
      );
      expect(missingFindings.length).toBeGreaterThan(0);
      expect(missingFindings.some((f) => f.severity === "blocking")).toBe(true);
    });
  });

  describe("Invalid references", () => {
    it("detects references to characters not in the Story Bible", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1, {
          characterArcChanges: [{ name: "Unknown Character", change: "Some change" }],
        }),
        makeEpisode(2),
        makeEpisode(3),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const refFindings = result.findings.filter(
        (f) => f.category === "unknown_entity_reference" && f.episodeNumber === 1
      );
      expect(refFindings.length).toBeGreaterThan(0);
    });
  });

  describe("Dead characters reappearing without explanation", () => {
    it("detects when a dead character appears in a later episode without explanation", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1, {
          characterArcChanges: [{ name: "Daniel", change: "Daniel dies in a car accident" }],
        }),
        makeEpisode(2, {
          characterDevelopment: "Daniel meets Lily at the hospital and they talk.",
          startingSituation: "Daniel is at the hospital recovering.",
        }),
        makeEpisode(3),
      ]);

      const result = validateSeasonPlanRich(plan, bible);
      const deadFindings = result.findings.filter(
        (f) => f.category === "character_state" || f.category === "unexplained_status_change"
      );
      expect(deadFindings.length).toBeGreaterThan(0);
      expect(deadFindings.some((f) => f.severity === "high")).toBe(true);
    });
  });

  describe("Missing intended season conclusion", () => {
    it("detects when the intended season conclusion is missing", () => {
      const bible = makeBible();
      const plan: SeasonPlan = {
        ...makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3)]),
        intendedSeasonConclusion: "x",
      };

      const result = validateSeasonPlanRich(plan, bible);
      const conclusionFindings = result.findings.filter(
        (f) => f.category === "climax_resolution" || f.category === "narrative_structure"
      );
      expect(conclusionFindings.some((f) => f.severity === "blocking")).toBe(true);
    });
  });

  describe("Validation report", () => {
    it("builds a complete validation report", () => {
      const bible = makeBible();
      const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3)]);
      const result = validateSeasonPlanRich(plan, bible);
      const report = buildValidationReport(result);

      expect(report).toHaveProperty("overallResult");
      expect(report).toHaveProperty("approvalEligible");
      expect(report).toHaveProperty("totalFindings");
      expect(report).toHaveProperty("blockingCount");
      expect(report).toHaveProperty("highCount");
      expect(report).toHaveProperty("mediumCount");
      expect(report).toHaveProperty("lowCount");
      expect(report).toHaveProperty("affectedEpisodes");
      expect(report).toHaveProperty("aiReasoningAvailable");
      expect(report).toHaveProperty("repairStatus");
      expect(report.totalFindings).toBe(result.findings.length);
      expect(report.approvalEligible).toBe(result.passed);
    });
  });

  describe("Repair engine", () => {
    it("selects only blocking and high findings for repair", () => {
      const findings: RichValidationFinding[] = [
        { findingId: "f1", category: "structural", severity: "blocking", message: "blocking issue", evidence: [], requiresHumanReview: false, source: "deterministic" },
        { findingId: "f2", category: "character_state", severity: "high", message: "high issue", evidence: [], requiresHumanReview: false, source: "deterministic" },
        { findingId: "f3", category: "repetition", severity: "medium", message: "medium issue", evidence: [], requiresHumanReview: false, source: "deterministic" },
        { findingId: "f4", category: "narrative_structure", severity: "low", message: "low issue", evidence: [], requiresHumanReview: false, source: "deterministic" },
      ];
      const repairable = selectFindingsForRepair(findings);
      expect(repairable.length).toBe(2);
      expect(repairable.every((f) => f.severity === "blocking" || f.severity === "high")).toBe(true);
    });

    it("respects maximum repair attempts", () => {
      const finding: RichValidationFinding = {
        findingId: "f1", category: "structural", severity: "blocking",
        message: "test", evidence: [], requiresHumanReview: false, source: "deterministic",
      };
      expect(shouldAttemptRepair(finding, 0)).toBe(true);
      expect(shouldAttemptRepair(finding, 3)).toBe(false);
    });

    it("does not repair low-severity findings", () => {
      const finding: RichValidationFinding = {
        findingId: "f1", category: "narrative_structure", severity: "low",
        message: "test", evidence: [], requiresHumanReview: false, source: "deterministic",
      };
      expect(shouldAttemptRepair(finding, 0)).toBe(false);
    });

    it("creates a repair attempt record", () => {
      const finding: RichValidationFinding = {
        findingId: "f1", category: "structural", severity: "blocking",
        message: "test", evidence: [], requiresHumanReview: false, source: "deterministic",
        episodeNumber: 3,
      };
      const attempt = createRepairAttempt(1, finding, "success", "Fixed episode 3", "groq", "model");
      expect(attempt.attempt).toBe(1);
      expect(attempt.findingId).toBe("f1");
      expect(attempt.episodeNumber).toBe(3);
      expect(attempt.status).toBe("success");
    });
  });

  describe("Version invalidation", () => {
    it("validation result includes bible and plan version", () => {
      const bible = makeBible();
      const plan = makePlan([makeEpisode(1), makeEpisode(2)]);
      const result = validateSeasonPlanRich(plan, bible, { bibleVersion: 3, planVersion: 5 });
      expect(result.bibleVersion).toBe(3);
      expect(result.planVersion).toBe(5);
    });

    it("validation result is not passed when blocking findings exist", () => {
      const bible = makeBible();
      const plan = makePlan([
        makeEpisode(1),
        makeEpisode(1),
      ]);
      const result = validateSeasonPlanRich(plan, bible);
      expect(result.passed).toBe(false);
      expect(result.overallSeverity).toBe("blocking");
    });
  });

  describe("Backward compatibility", () => {
    it("legacy validateSeasonPlan still works through the new engine", () => {

      const bible = makeBible();
      const plan = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3)]);
      const findings = validateSeasonPlan(plan, bible);
      expect(findings).toHaveProperty("passed");
      expect(findings).toHaveProperty("findings");
      expect(findings).toHaveProperty("validatedAt");
      expect(Array.isArray(findings.findings)).toBe(true);
    });
  });
});