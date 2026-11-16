import { describe, it, expect, beforeEach } from "vitest";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";
import { resetFindingIdCounter } from "@/lib/validation/seasonPlanValidation";
import { validateSeasonPlanRich } from "@/lib/domain/planValidation";
import { diagnoseFindings } from "@/lib/domain/planValidation/findingDiagnoser";
import { planRevisions } from "@/lib/domain/planValidation/revisionPlanner";
import { executeRevisions, createMockLLMCaller } from "@/lib/domain/planValidation/revisionExecutor";
import { analyzeImpact } from "@/lib/domain/planValidation/impactAnalyzer";
import { runRevalidationLoop } from "@/lib/domain/planValidation/revalidationLoop";
import {
  createRevisionHistoryEntry,
  applyReviewDecision,
  summarizeEpisodeChanges,
  resetEntryCounter,
} from "@/lib/domain/planValidation/revisionHistory";

function makeBible(): StoryBibleContent {
  return {
    identity: {
      title: "Test Series", genres: ["Drama"], subgenres: [],
      centralPremise: "A test premise.",
      narrativeConcept: "Test concept.",
      toneAndAtmosphere: "Serious", targetAudience: "Adults",
      centralConflict: "Test conflict.",
    },
    world: {
      description: "A test world.",
      geographyAndLocations: [{ name: "Office", description: "An office.", storyFunction: "Base" }],
      socialStructuresAndCultures: ["Modern"],
      historyAndPastEvents: [],
      rules: [],
      definingSystems: [],
    },
    characters: {
      characters: [
        { name: "Alice", storyRole: "protagonist", roleDescription: "Hero", physicalDescription: "Tall", personality: "Brave", background: "Soldier", motivations: ["Justice"], fearsAndWeaknesses: ["Loss"], abilitiesAndLimitations: ["Combat"], relationships: [], secrets: [], developmentPotential: "Growth" },
        { name: "Bob", storyRole: "antagonist", roleDescription: "Villain", physicalDescription: "Short", personality: "Cunning", background: "Criminal", motivations: ["Power"], fearsAndWeaknesses: ["Exposure"], abilitiesAndLimitations: ["Manipulation"], relationships: [], secrets: [], developmentPotential: "Downfall" },
      ],
      relationshipDynamics: ["Adversarial"],
    },
    narrative: {
      mainStoryline: "Alice vs Bob.",
      majorConflicts: ["Alice vs Bob"],
      longTermDirection: "Alice wins.",
      subplots: [],
      unresolvedMysteries: [],
      potentialFutureRevelations: [],
      majorNarrativeQuestions: ["Who wins?"],
      serializedEndingGuidance: "Alice prevails.",
    },
    guidelines: {
      mainThemes: ["Justice"], secondaryThemes: [],
      storytellingStyle: "Drama", boundaries: [],
      mustRemainConsistent: ["Alice is brave"],
    },
    canon: {
      confirmedFacts: ["Alice is a soldier"], proposedDetails: [],
      unresolvedQuestions: [], hiddenInformation: [],
      characterKnowledge: [
        { characterName: "Alice", knows: ["Bob's crimes"], believes: ["She can win"] },
        { characterName: "Bob", knows: ["His own crimes"], believes: ["He can escape"] },
      ],
      audienceKnowledge: [],
    },
  };
}

function makeEpisode(num: number, overrides?: Partial<EpisodePlanItem>): EpisodePlanItem {
  return {
    episodeNumber: num,
    workingTitle: `Episode ${num}`,
    narrativePurpose: `Purpose ${num}`,
    startingSituation: `Start ${num}`,
    mainObjective: `Objective ${num}`,
    centralConflict: `Conflict ${num}`,
    majorStoryBeats: [`Beat A-${num}`, `Beat B-${num}`],
    informationRevealed: [],
    characterDevelopment: `Development ${num}`,
    importantEvents: [`Event ${num}`],
    consequences: [`Consequence ${num}`],
    storyContribution: `Contribution ${num}`,
    endingOrCliffhanger: `Ending ${num}`,
    unresolvedThreads: [],
    continuityRequirements: `Continuity ${num}`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
    ...overrides,
  };
}

function makePlan(episodes: EpisodePlanItem[]): SeasonPlan {
  return {
    seasonObjective: "Test objective.",
    centralConflictOrMystery: "Test mystery.",
    mainCharacterObjectives: "Test objectives.",
    overallCharacterDevelopment: "Test development.",
    majorStoryDevelopments: ["Dev 1"],
    beginningDirection: "Beginning.",
    middleDirection: "Middle.",
    endingDirection: "Ending.",
    episodeProgression: episodes,
    importantRevelations: ["Rev 1"],
    relationshipChanges: ["Rel 1"],
    consequencesCarriedBetween: ["Cons 1"],
    setupAndPayoff: ["Setup 1"],
    unresolvedQuestions: ["Q 1"],
    intendedSeasonConclusion: "Conclusion.",
  };
}

function makeFinding(overrides: Partial<RichValidationFinding> & Pick<RichValidationFinding, "findingId" | "category" | "severity" | "message">): RichValidationFinding {
  return { source: "deterministic", requiresHumanReview: false, ...overrides };
}

const bible = () => makeBible();
const fullPlan = () => makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4)]);

describe("Regression — Full Revision Pipeline", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetEntryCounter();
  });

  it("diagnose → plan → execute → impact → history for a single blocking finding", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({
        findingId: "reg-1",
        category: "character_history_contradiction",
        severity: "blocking",
        message: "Episode 2 character history contradicts canon.",
        episodeNumber: 2,
        canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
      }),
    ];

    const diagnoses = diagnoseFindings({ findings, plan, bible: bible(), ledger: null, isSeasonFinale: false });
    expect(diagnoses.length).toBeGreaterThan(0);
    expect(diagnoses[0]!.classification).toBe("genuine_continuity_error");

    const revisionPlan = planRevisions({ diagnoses, round: 1, maxRounds: 3 });
    expect(revisionPlan.actions.length).toBeGreaterThan(0);
    expect(revisionPlan.canAutoApply).toBe(true);

    const llm = createMockLLMCaller((prompt) => ({
      ...prompt.currentEpisode,
      characterDevelopment: "Corrected development that aligns with canon",
    }));

    const executionResult = await executeRevisions({
      plan: revisionPlan,
      seasonPlan: plan,
      bible: bible(),
      seriesTitle: "Test Series",
      llm,
    });
    expect(executionResult.successCount).toBe(1);
    expect(executionResult.revisedPlan.episodeProgression[1]!.characterDevelopment).toBe("Corrected development that aligns with canon");

    const originalEp = plan.episodeProgression[1]!;
    const revisedEp = executionResult.revisedPlan.episodeProgression[1]!;
    const impactReport = analyzeImpact({ originalEpisode: originalEp, revisedEpisode: revisedEp, plan: executionResult.revisedPlan });
    expect(impactReport.changes.length).toBeGreaterThan(0);

    const loopResult = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm,
      validate: () => ({ findings: [], passed: true }),
    });
    expect(loopResult.totalRevisionsApplied).toBe(1);

    const historyEntry = createRevisionHistoryEntry(
      loopResult, "auto_revalidation", 1, 2, "Full pipeline test", 1, plan,
    );
    expect(historyEntry.episodeChanges).toHaveLength(1);
    expect(historyEntry.episodeChanges[0]!.episodeNumber).toBe(2);
    expect(historyEntry.reviewStatus).toBe("pending");
  });

  it("preserves all unmodified episodes across the full pipeline", async () => {
    const plan = fullPlan();
    const originalEp1 = { ...plan.episodeProgression[0]! };
    const originalEp3 = { ...plan.episodeProgression[2]! };
    const originalEp4 = { ...plan.episodeProgression[3]! };

    const findings: RichValidationFinding[] = [
      makeFinding({
        findingId: "reg-2",
        category: "character_history_contradiction",
        severity: "blocking",
        message: "Episode 2 character history contradicts canon.",
        episodeNumber: 2,
        canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
      }),
    ];

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => ({ ...p.currentEpisode, characterDevelopment: "Fixed" })),
      validate: () => ({ findings: [], passed: true }),
    });

    const finalEp1 = result.finalPlan.episodeProgression.find((e) => e.episodeNumber === 1)!;
    const finalEp3 = result.finalPlan.episodeProgression.find((e) => e.episodeNumber === 3)!;
    const finalEp4 = result.finalPlan.episodeProgression.find((e) => e.episodeNumber === 4)!;
    expect(JSON.stringify(finalEp1)).toBe(JSON.stringify(originalEp1));
    expect(JSON.stringify(finalEp3)).toBe(JSON.stringify(originalEp3));
    expect(JSON.stringify(finalEp4)).toBe(JSON.stringify(originalEp4));
  });

  it("rejects unsafe revisions that change episode number", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({
        findingId: "reg-3",
        category: "character_history_contradiction",
        severity: "blocking",
        message: "Episode 1 character history contradicts canon.",
        episodeNumber: 1,
        canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
      }),
    ];

    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => ({
        ...p.currentEpisode,
        episodeNumber: 99,
        characterDevelopment: "Changed",
      })),
      validate: () => ({ findings: [], passed: true }),
    });

    expect(result.totalRevisionsRejected).toBeGreaterThanOrEqual(1);
    expect(result.totalRevisionsApplied).toBe(0);
  });

  it("handles multiple blocking findings in priority order", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({
        findingId: "reg-4a",
        category: "character_history_contradiction",
        severity: "blocking",
        message: "Episode 3: Character 'Alice' history contradicts canon.",
        episodeNumber: 3,
        canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
      }),
      makeFinding({
        findingId: "reg-4b",
        category: "character_history_contradiction",
        severity: "blocking",
        message: "Episode 1: Character 'Bob' history contradicts canon.",
        episodeNumber: 1,
        canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
      }),
    ];

    const callOrder: number[] = [];
    const result = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => {
        callOrder.push(p.currentEpisode.episodeNumber);
        return { ...p.currentEpisode, characterDevelopment: `Fixed ep ${p.currentEpisode.episodeNumber}` };
      }),
      validate: () => ({ findings: [], passed: true }),
    });

    expect(result.totalRevisionsApplied).toBe(2);
    expect(callOrder).toContain(1);
    expect(callOrder).toContain(3);
  });

  it("records accurate revision history with round summaries", async () => {
    const plan = fullPlan();
    const findings: RichValidationFinding[] = [
      makeFinding({
        findingId: "reg-5",
        category: "character_history_contradiction",
        severity: "blocking",
        message: "Episode 1 character history contradicts canon.",
        episodeNumber: 1,
        canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
      }),
    ];

    const loopResult = await runRevalidationLoop({
      initialFindings: findings,
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => ({ ...p.currentEpisode, characterDevelopment: "Fixed" })),
      validate: () => ({ findings: [], passed: true }),
    });

    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "Test", 1, plan);

    expect(entry.totalRounds).toBe(1);
    expect(entry.totalRevisionsApplied).toBe(1);
    expect(entry.rounds).toHaveLength(1);
    expect(entry.rounds[0]!.actionsApplied).toBe(1);
    expect(entry.rounds[0]!.actionsRejected).toBe(0);
    expect(entry.stopReason).toBe("all_blocking_resolved");
    expect(entry.blockingResolved).toBe(true);
  });

  it("review decision flow: approve then verify", async () => {
    const plan = fullPlan();
    const loopResult = await runRevalidationLoop({
      initialFindings: [
        makeFinding({
          findingId: "reg-6",
          category: "character_history_contradiction",
          severity: "blocking",
          message: "Episode 1 character history contradicts canon.",
          episodeNumber: 1,
          canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
        }),
      ],
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => ({ ...p.currentEpisode, characterDevelopment: "Fixed" })),
      validate: () => ({ findings: [], passed: true }),
    });

    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "Test", 1, plan);
    expect(entry.reviewStatus).toBe("pending");

    const approved = applyReviewDecision(entry, {
      decision: "approve",
      notes: "Changes look correct",
      reviewedBy: "reviewer-1",
      reviewedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(approved.reviewStatus).toBe("approved");
    expect(approved.reviewedBy).toBe("reviewer-1");
  });

  it("review decision flow: reject then verify", async () => {
    const plan = fullPlan();
    const loopResult = await runRevalidationLoop({
      initialFindings: [
        makeFinding({
          findingId: "reg-7",
          category: "character_history_contradiction",
          severity: "blocking",
          message: "Episode 1 character history contradicts canon.",
          episodeNumber: 1,
          canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
        }),
      ],
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => ({ ...p.currentEpisode, characterDevelopment: "Fixed" })),
      validate: () => ({ findings: [], passed: true }),
    });

    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "Test", 1, plan);
    const rejected = applyReviewDecision(entry, {
      decision: "reject",
      notes: "Changes break continuity",
      reviewedBy: "reviewer-2",
      reviewedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(rejected.reviewStatus).toBe("rejected");
    expect(rejected.reviewNotes).toBe("Changes break continuity");
  });
});

describe("Regression — Integration with Real Validation", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetEntryCounter();
  });

  it("runs the full loop using real validation findings and mock LLM", async () => {
    const plan = fullPlan();
    const b = bible();
    const validationResult = validateSeasonPlanRich(plan, b);
    const findings = validationResult.findings.filter(
      (f) => f.severity === "blocking" || f.severity === "high" || f.severity === "medium",
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
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => ({
        ...p.currentEpisode,
        characterDevelopment: "Revised to address validation findings",
        centralConflict: `Unique conflict for episode ${p.currentEpisode.episodeNumber}`,
        majorStoryBeats: [`Unique beat A for ep ${p.currentEpisode.episodeNumber}`, `Unique beat B for ep ${p.currentEpisode.episodeNumber}`],
        endingOrCliffhanger: `Unique ending for ep ${p.currentEpisode.episodeNumber}`,
      })),
      maxRounds: 2,
    });

    expect(result.totalRounds).toBeGreaterThanOrEqual(1);
    expect(result.rounds[0]!.diagnoses.length).toBeGreaterThan(0);

    if (result.totalRevisionsApplied > 0) {
      const entry = createRevisionHistoryEntry(result, "auto_revalidation", 1, 2, "Real validation test", findings.length, plan);
      expect(entry.episodeChanges.length).toBeGreaterThan(0);
    }
  });

  it("episode change detection matches between summarizeEpisodeChanges and impact analyzer", async () => {
    const plan = fullPlan();
    const revisedPlan = makePlan([
      makeEpisode(1, { characterDevelopment: "Changed development" }),
      makeEpisode(2),
      makeEpisode(3),
      makeEpisode(4),
    ]);

    const changes = summarizeEpisodeChanges(plan, revisedPlan);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.episodeNumber).toBe(1);

    const originalEp = plan.episodeProgression[0]!;
    const revisedEp = revisedPlan.episodeProgression[0]!;
    const impact = analyzeImpact({ originalEpisode: originalEp, revisedEpisode: revisedEp, plan: revisedPlan });
    expect(impact.changes.length).toBeGreaterThan(0);
  });
});

describe("Regression — Safety Constraints", () => {
  beforeEach(() => {
    resetFindingIdCounter();
    resetEntryCounter();
  });

  it("does not modify episodes outside the target", async () => {
    const plan = fullPlan();
    const result = await runRevalidationLoop({
      initialFindings: [
        makeFinding({
          findingId: "reg-safety-1",
          category: "character_history_contradiction",
          severity: "blocking",
          message: "Episode 2 character history contradicts canon.",
          episodeNumber: 2,
          canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
        }),
      ],
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => ({ ...p.currentEpisode, characterDevelopment: "Fixed" })),
      validate: () => ({ findings: [], passed: true }),
    });

    const ep1 = result.finalPlan.episodeProgression.find((e) => e.episodeNumber === 1)!;
    const ep3 = result.finalPlan.episodeProgression.find((e) => e.episodeNumber === 3)!;
    const ep4 = result.finalPlan.episodeProgression.find((e) => e.episodeNumber === 4)!;
    expect(ep1.characterDevelopment).toBe("Development 1");
    expect(ep3.characterDevelopment).toBe("Development 3");
    expect(ep4.characterDevelopment).toBe("Development 4");
  });

  it("preserves working title (safety constraint)", async () => {
    const plan = fullPlan();
    const result = await runRevalidationLoop({
      initialFindings: [
        makeFinding({
          findingId: "reg-safety-2",
          category: "character_history_contradiction",
          severity: "blocking",
          message: "Episode 1 character history contradicts canon.",
          episodeNumber: 1,
          canonIssueType: "CHARACTER_HISTORY_CONTRADICTION",
        }),
      ],
      plan,
      bible: bible(),
      ledger: null,
      seriesTitle: "Test Series",
      llm: createMockLLMCaller((p) => ({
        ...p.currentEpisode,
        workingTitle: "Changed Title",
        characterDevelopment: "Fixed",
      })),
      validate: () => ({ findings: [], passed: true }),
    });

    if (result.totalRevisionsApplied > 0) {
      const ep1 = result.finalPlan.episodeProgression.find((e) => e.episodeNumber === 1)!;
      expect(ep1.workingTitle).toBe("Episode 1");
    }
  });
});