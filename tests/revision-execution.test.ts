import { describe, it, expect, beforeEach } from "vitest";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { resetFindingIdCounter } from "@/lib/validation/seasonPlanValidation";
import type { RevisionAction, RevisionPlan } from "@/lib/validation/revisionPlan";
import { diagnoseFindings } from "@/lib/domain/planValidation/findingDiagnoser";
import { planRevisions, resetActionCounter } from "@/lib/domain/planValidation/revisionPlanner";
import {
  revisionInstructions,
  type EpisodeRevisionPrompt,
} from "@/lib/providers/llm/episodeRevision";
import {
  checkRevisionSafety,
  checkPlanIsolation,
  type SafetyCheckResult,
} from "@/lib/domain/planValidation/revisionSafetyChecker";
import {
  executeRevisions,
  createMockLLMCaller,
  type RevisionLLMCaller,
  type RevisionExecutionResult,
} from "@/lib/domain/planValidation/revisionExecutor";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBible(): StoryBibleContent {
  return {
    identity: {
      title: "The Phantom Protocol",
      genres: ["Thriller"],
      subgenres: [],
      centralPremise: "A detective uncovers a conspiracy.",
      narrativeConcept: "Mara Voss investigates disappearances.",
      toneAndAtmosphere: "Tense",
      targetAudience: "Adults",
      centralConflict: "Mara must expose the conspiracy.",
    },
    world: {
      description: "A modern city with a hidden facility.",
      geographyAndLocations: [
        { name: "Voss's Office", description: "Mara's office.", storyFunction: "Base" },
        { name: "The Facility", description: "Secret lab.", storyFunction: "Antagonist domain" },
      ],
      socialStructuresAndCultures: ["Modern society"],
      historyAndPastEvents: ["Mara's past"],
      rules: ["The phantom appears only to Mara"],
      definingSystems: [],
    },
    characters: {
      characters: [
        {
          name: "Mara Voss",
          storyRole: "protagonist",
          roleDescription: "Detective",
          physicalDescription: "Sharp-eyed",
          personality: "Determined",
          background: "Former police detective",
          motivations: ["Expose the truth"],
          fearsAndWeaknesses: ["Losing her sanity"],
          abilitiesAndLimitations: ["Investigation skills"],
          relationships: [{ characterName: "Dr. Miriam Vale", relationship: "Adversary", tensionOrChange: "Distrust" }],
          secrets: ["Her past"],
          developmentPotential: "Confront her past",
        },
        {
          name: "Dr. Miriam Vale",
          storyRole: "antagonist",
          roleDescription: "Researcher",
          physicalDescription: "Composed",
          personality: "Brilliant",
          background: "Lead researcher",
          motivations: ["Protect research"],
          fearsAndWeaknesses: ["Exposure"],
          abilitiesAndLimitations: ["Science"],
          relationships: [{ characterName: "Mara Voss", relationship: "Ally", tensionOrChange: "Distrust" }],
          secrets: ["Experiments"],
          developmentPotential: "Choose ethics",
        },
      ],
      relationshipDynamics: ["Tense alliance"],
    },
    narrative: {
      mainStoryline: "Mara investigates the facility.",
      majorConflicts: ["Mara vs. conspiracy"],
      longTermDirection: "Mara exposes the facility.",
      subplots: ["Vale's struggle"],
      unresolvedMysteries: ["The phantom"],
      potentialFutureRevelations: ["Phantom origin"],
      majorNarrativeQuestions: ["Will Mara succeed?"],
      serializedEndingGuidance: "Mara confronts the phantom.",
    },
    guidelines: {
      mainThemes: ["Truth"],
      secondaryThemes: ["Ethics"],
      storytellingStyle: "Thriller",
      boundaries: ["Phantom is real"],
      mustRemainConsistent: ["Mara is a detective"],
    },
    canon: {
      confirmedFacts: ["Mara is a detective"],
      proposedDetails: [],
      unresolvedQuestions: ["The phantom"],
      hiddenInformation: ["Experiments"],
      characterKnowledge: [
        { characterName: "Mara Voss", knows: ["People disappearing"], believes: ["Phantom connected"] },
        { characterName: "Dr. Miriam Vale", knows: ["Experiments cause visions"], believes: ["Research justified"] },
      ],
      audienceKnowledge: ["People disappearing"],
    },
  };
}

function makeEpisode(num: number, overrides?: Partial<EpisodePlanItem>): EpisodePlanItem {
  return {
    episodeNumber: num,
    workingTitle: `Episode ${num}`,
    narrativePurpose: `Advance the story in episode ${num}`,
    startingSituation: `Start of episode ${num}`,
    mainObjective: `Objective for episode ${num}`,
    centralConflict: `Conflict in episode ${num}`,
    majorStoryBeats: [`Beat 1 of ep ${num}`, `Beat 2 of ep ${num}`],
    informationRevealed: [],
    characterDevelopment: `Development in ep ${num}`,
    importantEvents: [`Event in ep ${num}`],
    consequences: [`Consequence of ep ${num}`],
    storyContribution: `Advances season by ${num}`,
    endingOrCliffhanger: `Ending of ep ${num}`,
    unresolvedThreads: [],
    continuityRequirements: `Continuity from ep ${num - 1}`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
    ...overrides,
  };
}

function makePlan(episodes: EpisodePlanItem[]): SeasonPlan {
  return {
    seasonObjective: "Mara exposes the facility.",
    centralConflictOrMystery: "What is the phantom?",
    mainCharacterObjectives: "Mara seeks truth.",
    overallCharacterDevelopment: "Mara grows.",
    majorStoryDevelopments: ["Phantom appears"],
    beginningDirection: "Establish investigation.",
    middleDirection: "Narrow in on facility.",
    endingDirection: "Confront phantom.",
    episodeProgression: episodes,
    importantRevelations: ["Phantom is side effect"],
    relationshipChanges: ["Alliance forms"],
    consequencesCarriedBetween: ["Growing understanding"],
    setupAndPayoff: ["Phantom setup"],
    unresolvedQuestions: ["Experiments extent"],
    intendedSeasonConclusion: "Mara exposes facility.",
  };
}

function makeFinding(overrides: Partial<RichValidationFinding> & Pick<RichValidationFinding, "findingId" | "category" | "severity" | "message">): RichValidationFinding {
  return { source: "deterministic", requiresHumanReview: false, ...overrides };
}

function makeRevisionPlan(actions: RevisionAction[]): RevisionPlan {
  return {
    planId: "test-plan-1",
    round: 1,
    maxRounds: 3,
    actions,
    skipped: [],
    requiresHumanApproval: false,
    canAutoApply: true,
    totalActions: actions.length,
    createdAt: new Date().toISOString(),
  };
}

function makeRevisionAction(overrides: Partial<RevisionAction> & Pick<RevisionAction, "groupId" | "type" | "domain">): RevisionAction {
  return {
    actionId: "act-0001",
    findingIds: ["f-001"],
    classification: "genuine_continuity_error",
    priority: 1,
    affectedEpisodes: [1],
    description: "Test revision action",
    correctionGuidance: "Fix the continuity error",
    safetyConstraints: ["smallest_possible_change", "no_canon_modification", "preserve_dialogue", "preserve_scene_order", "preserve_motivations", "preserve_deliberate_mysteries", "no_full_rewrite"],
    requiresHumanApproval: false,
    target: { episodeNumber: 1 },
    ...overrides,
  };
}

const fullPlan = () => makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);
const bible = () => makeBible();

// ---------------------------------------------------------------------------
// Prompt Builder Tests
// ---------------------------------------------------------------------------

describe("Revision Prompt Builder", () => {
  it("produces a system prompt and user prompt", () => {
    const action = makeRevisionAction({ groupId: "g1", type: "episode_revision", domain: "character_continuity" });
    const prompt: EpisodeRevisionPrompt = {
      seriesTitle: "Test Series",
      action,
      currentEpisode: makeEpisode(1),
      seasonPlanObjective: "Test objective",
      bible: null,
      previousEpisode: null,
      nextEpisode: makeEpisode(2),
    };
    const result = revisionInstructions(prompt);
    expect(result.system).toContain("narrative continuity editor");
    expect(result.prompt).toContain("Test Series");
    expect(result.prompt).toContain("Test objective");
    expect(result.prompt).toContain("Episode 1");
  });

  it("includes safety rules in the prompt", () => {
    const action = makeRevisionAction({
      groupId: "g2",
      type: "episode_revision",
      domain: "character_continuity",
      safetyConstraints: ["smallest_possible_change", "no_full_rewrite", "preserve_dialogue"],
    });
    const prompt: EpisodeRevisionPrompt = {
      seriesTitle: "Test",
      action,
      currentEpisode: makeEpisode(1),
      seasonPlanObjective: "Objective",
      bible: null,
      previousEpisode: null,
      nextEpisode: null,
    };
    const result = revisionInstructions(prompt);
    expect(result.prompt).toContain("Safety Rules");
    expect(result.prompt).toContain("smallest possible change");
    expect(result.prompt).toContain("Do not rewrite the entire episode");
    expect(result.prompt).toContain("Preserve existing dialogue");
  });

  it("includes bible summary when bible is provided", () => {
    const action = makeRevisionAction({ groupId: "g3", type: "episode_revision", domain: "character_continuity" });
    const prompt: EpisodeRevisionPrompt = {
      seriesTitle: "Test",
      action,
      currentEpisode: makeEpisode(1),
      seasonPlanObjective: "Objective",
      bible: bible(),
      previousEpisode: null,
      nextEpisode: null,
    };
    const result = revisionInstructions(prompt);
    expect(result.prompt).toContain("Story Bible");
    expect(result.prompt).toContain("Mara Voss");
    expect(result.prompt).toContain("Dr. Miriam Vale");
  });

  it("includes previous and next episode context when available", () => {
    const action = makeRevisionAction({ groupId: "g4", type: "episode_revision", domain: "character_continuity" });
    const prompt: EpisodeRevisionPrompt = {
      seriesTitle: "Test",
      action,
      currentEpisode: makeEpisode(3),
      seasonPlanObjective: "Objective",
      bible: null,
      previousEpisode: makeEpisode(2),
      nextEpisode: makeEpisode(4),
    };
    const result = revisionInstructions(prompt);
    expect(result.prompt).toContain("Previous episode (2)");
    expect(result.prompt).toContain("Next episode (4)");
  });

  it("includes correction guidance in the prompt", () => {
    const action = makeRevisionAction({
      groupId: "g5",
      type: "canon_correction",
      domain: "story_bible_inconsistencies",
      correctionGuidance: "Root cause: canon mismatch\nRecommended correction: fix the reference",
    });
    const prompt: EpisodeRevisionPrompt = {
      seriesTitle: "Test",
      action,
      currentEpisode: makeEpisode(1),
      seasonPlanObjective: "Objective",
      bible: null,
      previousEpisode: null,
      nextEpisode: null,
    };
    const result = revisionInstructions(prompt);
    expect(result.prompt).toContain("Correction Guidance");
    expect(result.prompt).toContain("Root cause: canon mismatch");
    expect(result.prompt).toContain("Recommended correction: fix the reference");
  });
});

// ---------------------------------------------------------------------------
// Safety Checker Tests
// ---------------------------------------------------------------------------

describe("Revision Safety Checker", () => {
  describe("checkRevisionSafety", () => {
    it("passes when the revision is minimal and preserves required fields", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = {
        ...original,
        centralConflict: "Revised conflict that fixes the continuity error",
      };
      const action = makeRevisionAction({ groupId: "s1", type: "episode_revision", domain: "character_continuity" });
      const result = checkRevisionSafety(original, revised, action, null);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("fails when the episode number is changed", () => {
      const original = makeEpisode(1);
      const revised = makeEpisode(2);
      const action = makeRevisionAction({ groupId: "s2", type: "episode_revision", domain: "character_continuity" });
      const result = checkRevisionSafety(original, revised, action, null);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("Episode number changed"))).toBe(true);
    });

    it("fails when the working title is changed", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = { ...original, workingTitle: "Completely Different Title" };
      const action = makeRevisionAction({ groupId: "s3", type: "episode_revision", domain: "character_continuity" });
      const result = checkRevisionSafety(original, revised, action, null);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("Working title changed"))).toBe(true);
    });

    it("fails when too many fields are changed (not smallest possible change)", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = {
        ...original,
        narrativePurpose: "Different purpose",
        startingSituation: "Different situation",
        mainObjective: "Different objective",
        centralConflict: "Different conflict",
        characterDevelopment: "Different development",
        storyContribution: "Different contribution",
        endingOrCliffhanger: "Different ending",
        continuityRequirements: "Different requirements",
      };
      const action = makeRevisionAction({ groupId: "s4", type: "episode_revision", domain: "character_continuity" });
      const result = checkRevisionSafety(original, revised, action, null);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.constraint === "smallest_possible_change")).toBe(true);
    });

    it("fails when the revision is a full rewrite", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = {
        ...original,
        majorStoryBeats: ["Completely new beat 1", "Completely new beat 2"],
        informationRevealed: ["New info"],
        importantEvents: ["New event"],
        consequences: ["New consequence"],
        characterDevelopment: "New development",
        startingSituation: "New situation",
        mainObjective: "New objective",
        centralConflict: "New conflict",
        endingOrCliffhanger: "New ending",
      };
      const action = makeRevisionAction({ groupId: "s5", type: "episode_revision", domain: "character_continuity" });
      const result = checkRevisionSafety(original, revised, action, null);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.constraint === "no_full_rewrite")).toBe(true);
    });

    it("fails when a character is removed", () => {
      const original = makeEpisode(1, {
        characterArcChanges: [{ name: "Mara Voss", change: "Becomes determined" }],
      });
      const revised = makeEpisode(1, {
        characterArcChanges: [],
      });
      const action = makeRevisionAction({
        groupId: "s6",
        type: "episode_revision",
        domain: "character_continuity",
        safetyConstraints: ["no_character_removal"],
      });
      const result = checkRevisionSafety(original, revised, action, null);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.constraint === "no_character_removal")).toBe(true);
    });

    it("fails when scene order (beat count) is changed", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = {
        ...original,
        majorStoryBeats: ["Only one beat"],
      };
      const action = makeRevisionAction({
        groupId: "s7",
        type: "episode_revision",
        domain: "character_continuity",
        safetyConstraints: ["preserve_scene_order"],
      });
      const result = checkRevisionSafety(original, revised, action, null);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.constraint === "preserve_scene_order")).toBe(true);
    });

    it("fails when a new character not in canon is introduced", () => {
      const original = makeEpisode(1);
      const revised = makeEpisode(1, {
        characterArcChanges: [{ name: "Mystery New Character", change: "Appears" }],
      });
      const action = makeRevisionAction({
        groupId: "s8",
        type: "episode_revision",
        domain: "character_continuity",
        safetyConstraints: ["no_canon_modification"],
      });
      const result = checkRevisionSafety(original, revised, action, bible());
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.constraint === "no_canon_modification")).toBe(true);
    });
  });

  describe("checkPlanIsolation", () => {
    it("passes when only the target episode is changed", () => {
      const original = fullPlan();
      const revisedEp = makeEpisode(3, { centralConflict: "Revised conflict" });
      const revisedPlan = makePlan(original.episodeProgression.map((ep) =>
        ep.episodeNumber === 3 ? revisedEp : ep,
      ));
      const result = checkPlanIsolation(original, revisedPlan, 3);
      expect(result.passed).toBe(true);
    });

    it("fails when a non-target episode is changed", () => {
      const original = fullPlan();
      const revisedPlan = makePlan(original.episodeProgression.map((ep) =>
        ep.episodeNumber === 2 ? { ...ep, centralConflict: "Changed" } : ep,
      ));
      const result = checkPlanIsolation(original, revisedPlan, 3);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("Episode 2 was modified"))).toBe(true);
    });

    it("fails when the season objective is changed", () => {
      const original = fullPlan();
      const revisedPlan: SeasonPlan = { ...original, seasonObjective: "Different objective" };
      const result = checkPlanIsolation(original, revisedPlan, 1);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.constraint === "no_premise_change")).toBe(true);
    });

    it("fails when an episode is removed", () => {
      const original = fullPlan();
      const revisedPlan = makePlan(original.episodeProgression.filter((ep) => ep.episodeNumber !== 2));
      const result = checkPlanIsolation(original, revisedPlan, 1);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.message.includes("Episode 2 was removed"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Revision Executor Tests
// ---------------------------------------------------------------------------

describe("Revision Executor", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("applies a safe revision to the plan", async () => {
    const plan = fullPlan();
    const action = makeRevisionAction({
      groupId: "e1",
      type: "episode_revision",
      domain: "character_continuity",
      target: { episodeNumber: 2 },
      affectedEpisodes: [2],
    });
    const revisionPlan = makeRevisionPlan([action]);

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      centralConflict: "Revised conflict that fixes the error",
    }));

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: bible(),
      seriesTitle: "Test",
      llm,
    });

    expect(result.successCount).toBe(1);
    expect(result.rejectedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.results[0]!.status).toBe("success");
    expect(result.revisedPlan.episodeProgression[1]!.centralConflict).toBe("Revised conflict that fixes the error");
    expect(result.allActionsApplied).toBe(true);
  });

  it("rejects an unsafe revision", async () => {
    const plan = fullPlan();
    const action = makeRevisionAction({
      groupId: "e2",
      type: "episode_revision",
      domain: "character_continuity",
      target: { episodeNumber: 1 },
      affectedEpisodes: [1],
    });
    const revisionPlan = makeRevisionPlan([action]);

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      episodeNumber: prompt.currentEpisode.episodeNumber + 1,
    }));

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.successCount).toBe(0);
    expect(result.rejectedCount).toBe(1);
    expect(result.results[0]!.status).toBe("rejected_unsafe");
  });

  it("skips actions that require human approval", async () => {
    const plan = fullPlan();
    const action = makeRevisionAction({
      groupId: "e3",
      type: "canon_addition",
      domain: "character_identity_aliases",
      requiresHumanApproval: true,
      target: { episodeNumber: 1 },
      affectedEpisodes: [1],
    });
    const revisionPlan = makeRevisionPlan([action]);

    const llm = createMockLLMCaller((prompt) => prompt.currentEpisode);

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.skippedCount).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.results[0]!.status).toBe("skipped");
  });

  it("skips preserve_intentional actions", async () => {
    const plan = fullPlan();
    const action = makeRevisionAction({
      groupId: "e4",
      type: "preserve_intentional",
      domain: "unresolved_plot_threads",
      classification: "intentional_creative_decision",
      target: { episodeNumber: 1 },
      affectedEpisodes: [1],
    });
    const revisionPlan = makeRevisionPlan([action]);

    const llm = createMockLLMCaller((prompt) => prompt.currentEpisode);

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.skippedCount).toBe(1);
  });

  it("records a failed action when the LLM throws", async () => {
    const plan = fullPlan();
    const action = makeRevisionAction({
      groupId: "e5",
      type: "episode_revision",
      domain: "character_continuity",
      target: { episodeNumber: 1 },
      affectedEpisodes: [1],
    });
    const revisionPlan = makeRevisionPlan([action]);

    const llm: RevisionLLMCaller = {
      async reviseEpisode() {
        throw new Error("LLM service unavailable");
      },
    };

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.failedCount).toBe(1);
    expect(result.results[0]!.status).toBe("failed");
    expect(result.results[0]!.message).toContain("LLM service unavailable");
    expect(result.stoppedEarly).toBe(true);
  });

  it("continues on failure when stopOnFailure is false", async () => {
    const plan = fullPlan();
    const actions = [
      makeRevisionAction({
        groupId: "e6a",
        type: "episode_revision",
        domain: "character_continuity",
        target: { episodeNumber: 1 },
        affectedEpisodes: [1],
      }),
      makeRevisionAction({
        groupId: "e6b",
        type: "episode_revision",
        domain: "narrative_progression",
        target: { episodeNumber: 2 },
        affectedEpisodes: [2],
      }),
    ];
    const revisionPlan = makeRevisionPlan(actions);

    let callCount = 0;
    const llm: RevisionLLMCaller = {
      async reviseEpisode(prompt) {
        callCount += 1;
        if (callCount === 1) throw new Error("First call fails");
        return { episode: prompt.currentEpisode, provider: "mock", model: "mock" };
      },
    };

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
      stopOnFailure: false,
    });

    expect(result.failedCount).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.stoppedEarly).toBe(false);
  });

  it("applies multiple safe revisions in priority order", async () => {
    const plan = fullPlan();
    const actions = [
      makeRevisionAction({
        groupId: "e7a",
        type: "episode_revision",
        domain: "character_continuity",
        priority: 2,
        target: { episodeNumber: 2 },
        affectedEpisodes: [2],
      }),
      makeRevisionAction({
        groupId: "e7b",
        type: "episode_revision",
        domain: "character_identity_aliases",
        priority: 1,
        target: { episodeNumber: 1 },
        affectedEpisodes: [1],
      }),
    ];
    const revisionPlan = makeRevisionPlan(actions);

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      centralConflict: `Revised: ${prompt.action.groupId}`,
    }));

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.successCount).toBe(2);
    expect(result.revisedPlan.episodeProgression[0]!.centralConflict).toBe("Revised: e7b");
    expect(result.revisedPlan.episodeProgression[1]!.centralConflict).toBe("Revised: e7a");
  });

  it("handles empty action list", async () => {
    const plan = fullPlan();
    const revisionPlan = makeRevisionPlan([]);

    const llm = createMockLLMCaller((prompt) => prompt.currentEpisode);

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.successCount).toBe(0);
    expect(result.allActionsApplied).toBe(true);
    expect(result.revisedPlan).toBe(plan);
  });

  it("skips actions when target episode is not found", async () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2)]);
    const action = makeRevisionAction({
      groupId: "e8",
      type: "episode_revision",
      domain: "character_continuity",
      target: { episodeNumber: 99 },
      affectedEpisodes: [99],
    });
    const revisionPlan = makeRevisionPlan([action]);

    const llm = createMockLLMCaller((prompt) => prompt.currentEpisode);

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.skippedCount).toBe(1);
    expect(result.results[0]!.message).toContain("target episode not found");
  });

  it("records provider and model from the LLM response", async () => {
    const plan = fullPlan();
    const action = makeRevisionAction({
      groupId: "e9",
      type: "episode_revision",
      domain: "character_continuity",
      target: { episodeNumber: 1 },
      affectedEpisodes: [1],
    });
    const revisionPlan = makeRevisionPlan([action]);

    const llm = createMockLLMCaller(
      (prompt) => ({ ...prompt.currentEpisode, centralConflict: "Fixed" }),
      "groq",
      "llama-3.1-70b",
    );

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.results[0]!.provider).toBe("groq");
    expect(result.results[0]!.model).toBe("llama-3.1-70b");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: diagnose → plan → execute
// ---------------------------------------------------------------------------

describe("End-to-end revision flow", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetActionCounter();
  });

  it("diagnoses findings, plans revisions, and executes them", async () => {
    const plan = fullPlan();
    const b = bible();

    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "e2e-1", category: "character_history_contradiction", severity: "blocking", message: "Episode 2 character history contradicts canon.", episodeNumber: 2, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const diagnoses = diagnoseFindings({ findings, plan, bible: b, ledger: null, isSeasonFinale: false });
    expect(diagnoses.length).toBeGreaterThan(0);

    const revisionPlan = planRevisions({ diagnoses, round: 1 });
    expect(revisionPlan.actions.length).toBeGreaterThan(0);

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: "Revised development that resolves the contradiction",
    }));

    const result = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: b,
      seriesTitle: "The Phantom Protocol",
      llm,
    });

    expect(result.successCount).toBe(1);
    expect(result.revisedPlan.episodeProgression[1]!.characterDevelopment).toContain("Revised development");
  });
});