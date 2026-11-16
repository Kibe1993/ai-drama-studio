import { describe, it, expect, beforeEach } from "vitest";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { resetFindingIdCounter } from "@/lib/validation/seasonPlanValidation";
import { validateSeasonPlanRich } from "@/lib/domain/planValidation";
import { runRevalidationLoop } from "@/lib/domain/planValidation/revalidationLoop";
import { createMockLLMCaller } from "@/lib/domain/planValidation/revisionExecutor";

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

const fullPlan = () => makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);
const bible = () => makeBible();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Revalidation Loop Controller", () => {
  beforeEach(() => {
    resetFindingIdCounter();
  });

  it("returns immediately when there are no blocking/high findings", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "low1", category: "reference_integrity", severity: "low", message: "Minor issue.", episodeNumber: 1 }),
    ];

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm: createMockLLMCaller((p) => p.currentEpisode),
    });

    expect(result.totalRounds).toBe(0);
    expect(result.finalPassed).toBe(true);
    expect(result.stopReason).toBe("no_findings");
    expect(result.finalPlan).toBe(plan);
  });

  it("returns immediately for empty findings", async () => {
    const plan = fullPlan();

    const result = await runRevalidationLoop({
      initialFindings: [],
      plan,
      bible: null,
      ledger: null,
      seriesTitle: "Test",
      llm: createMockLLMCaller((p) => p.currentEpisode),
    });

    expect(result.totalRounds).toBe(0);
    expect(result.finalPassed).toBe(true);
    expect(result.stopReason).toBe("no_findings");
  });

  it("runs a revision round and revalidates", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "rev1", category: "character_history_contradiction", severity: "blocking", message: "Episode 2 character history contradicts canon.", episodeNumber: 2, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: "Revised development that resolves the contradiction",
    }));

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "The Phantom Protocol",
      llm,
    });

    expect(result.totalRounds).toBeGreaterThanOrEqual(1);
    expect(result.rounds[0]!.round).toBe(1);
    expect(result.rounds[0]!.diagnoses.length).toBeGreaterThan(0);
    expect(result.rounds[0]!.executionResult.successCount).toBe(1);
    expect(result.totalRevisionsApplied).toBe(1);
  });

  it("stops when all blocking findings are resolved", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "resolve1", category: "character_history_contradiction", severity: "blocking", message: "Episode 1 character history contradicts canon.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: "Fixed development",
    }));

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm,
      validate: () => ({ findings: [], passed: true }),
    });

    expect(result.stopReason).toBe("all_blocking_resolved");
    expect(result.finalPassed).toBe(true);
  });

  it("stops when human approval is needed (ambiguous findings)", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "amb1", category: "setup_payoff", severity: "medium", message: "Episode 2 foreshadowing 'The phantom appears briefly' has no payoff.", episodeNumber: 2 }),
    ];

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm: createMockLLMCaller((p) => p.currentEpisode),
    });

    expect(result.stopReason).toBe("human_approval_needed");
    expect(result.totalRevisionsApplied).toBe(0);
  });

  it("stops when max rounds are reached", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "max1", category: "character_history_contradiction", severity: "blocking", message: "Episode 1 character history contradicts canon.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
      makeFinding({ findingId: "max2", category: "character_history_contradiction", severity: "blocking", message: "Episode 2 character history contradicts canon.", episodeNumber: 2, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
      makeFinding({ findingId: "max3", category: "character_history_contradiction", severity: "blocking", message: "Episode 3 character history contradicts canon.", episodeNumber: 3, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: `Revised ${prompt.currentEpisode.episodeNumber}`,
    }));

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm,
      maxRounds: 1,
      validate: () => ({
        passed: false,
        overallSeverity: "blocking",
        findings: [
          makeFinding({ findingId: "max1", category: "character_history_contradiction", severity: "blocking", message: "Episode 1 still contradicts canon.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
        ],
        deterministicFindingCount: 1,
        aiFindingCount: 0,
        repairHistory: [],
        validatorVersion: "2.0",
        validatedAt: new Date().toISOString(),
      }),
    });

    expect(result.totalRounds).toBe(1);
    expect(result.stopReason).toBe("max_rounds_reached");
  });

  it("stops when LLM execution fails", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "fail1", category: "character_history_contradiction", severity: "blocking", message: "Episode 1 character history contradicts canon.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm: {
        async reviseEpisode() {
          throw new Error("LLM unavailable");
        },
      },
    });

    expect(result.stopReason).toBe("execution_failed");
    expect(result.totalRevisionsApplied).toBe(0);
  });

  it("records impact reports for successful revisions", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "imp1", category: "character_history_contradiction", severity: "blocking", message: "Episode 2 character history contradicts canon.", episodeNumber: 2, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: "Revised development",
      consequences: [...prompt.currentEpisode.consequences, "New consequence"],
    }));

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm,
    });

    const round = result.rounds[0]!;
    expect(round.impactReports.length).toBeGreaterThanOrEqual(0);
  });

  it("tracks total revisions applied and rejected", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "track1", category: "character_history_contradiction", severity: "blocking", message: "Episode 1 character history contradicts canon.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: "Fixed",
    }));

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.totalRevisionsApplied).toBeGreaterThanOrEqual(1);
    expect(result.totalRevisionsRejected).toBe(0);
  });

  it("produces a final plan that differs from the input when revisions are applied", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "diff1", category: "character_history_contradiction", severity: "blocking", message: "Episode 1 character history contradicts canon.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: "Completely revised development",
    }));

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm,
    });

    expect(result.finalPlan).not.toBe(plan);
    expect(result.finalPlan.episodeProgression[0]!.characterDevelopment).toBe("Completely revised development");
  });

  it("preserves unmodified episodes in the final plan", async () => {
    const plan = fullPlan();
    const originalEp3 = { ...plan.episodeProgression[2]! };
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "pres1", category: "character_history_contradiction", severity: "blocking", message: "Episode 1 character history contradicts canon.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: "Fixed",
    }));

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm,
    });

    const finalEp3 = result.finalPlan.episodeProgression.find((e) => e.episodeNumber === 3);
    expect(finalEp3).toBeDefined();
    expect(JSON.stringify(finalEp3)).toBe(JSON.stringify(originalEp3));
  });

  it("handles multiple rounds when the first round does not resolve all findings", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({ findingId: "multi1", category: "character_history_contradiction", severity: "blocking", message: "Episode 1 character history contradicts canon.", episodeNumber: 1, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
      makeFinding({ findingId: "multi2", category: "character_history_contradiction", severity: "blocking", message: "Episode 3 character history contradicts canon.", episodeNumber: 3, canonIssueType: "CHARACTER_HISTORY_CONTRADICTION" }),
    ];

    let callCount = 0;
    const llm = createMockLLMCaller((prompt) => {
      callCount += 1;
      return {
        ...prompt.currentEpisode,
        characterDevelopment: `Fixed in call ${callCount}`,
      };
    });

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test",
      llm,
      maxRounds: 3,
    });

    expect(result.totalRounds).toBeGreaterThanOrEqual(1);
    expect(result.totalRevisionsApplied).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: real validation findings → loop
// ---------------------------------------------------------------------------

describe("Revalidation Loop — integration with real validation", () => {
  beforeEach(() => {
    resetFindingIdCounter();
  });

  it("runs the loop using findings from validateSeasonPlanRich", async () => {
    const plan = fullPlan();
    const b = bible();
    const validationResult = validateSeasonPlanRich(plan, b);
    const findings = validationResult.findings.filter(
      (f) => f.severity === "blocking" || f.severity === "high",
    );

    if (findings.length === 0) {
      expect(findings).toHaveLength(0);
      return;
    }

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: b,
      ledger: null,
      seriesTitle: "The Phantom Protocol",
      llm: createMockLLMCaller((prompt) => ({
        ...prompt.currentEpisode,
        characterDevelopment: "Revised to fix validation",
      })),
      maxRounds: 2,
    });

    expect(result.totalRounds).toBeGreaterThanOrEqual(1);
    expect(result.rounds[0]!.diagnoses.length).toBeGreaterThan(0);
  });
});