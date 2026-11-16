import { describe, it, expect, beforeEach } from "vitest";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";

import type { RevalidationLoopResult } from "@/lib/domain/planValidation/revalidationLoop";
import {
  summarizeEpisodeChanges,
  createRevisionHistoryEntry,
  applyReviewDecision,
  isPendingReview,
  isApproved,
  isRejected,
  hasEpisodeChanges,
  getChangedEpisodeNumbers,
  resetEntryCounter,
} from "@/lib/domain/planValidation/revisionHistory";

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
    seasonObjective: "Test season objective.",
    centralConflictOrMystery: "Test central conflict.",
    mainCharacterObjectives: "Test character objectives.",
    overallCharacterDevelopment: "Test character development.",
    majorStoryDevelopments: ["Dev 1"],
    beginningDirection: "Test beginning.",
    middleDirection: "Test middle.",
    endingDirection: "Test ending.",
    episodeProgression: episodes,
    importantRevelations: ["Rev 1"],
    relationshipChanges: ["Rel 1"],
    consequencesCarriedBetween: ["Cons 1"],
    setupAndPayoff: ["Setup 1"],
    unresolvedQuestions: ["Q 1"],
    intendedSeasonConclusion: "Test conclusion.",
  };
}

function makeLoopResult(overrides?: Partial<RevalidationLoopResult>): RevalidationLoopResult {
  return {
    finalPlan: makePlan([makeEpisode(1), makeEpisode(2)]),
    rounds: [],
    totalRounds: 1,
    finalFindings: [],
    finalPassed: true,
    stopReason: "all_blocking_resolved",
    totalRevisionsApplied: 1,
    totalRevisionsRejected: 0,
    ...overrides,
  };
}

describe("Revision History — summarizeEpisodeChanges", () => {
  it("returns empty array when plans are identical", () => {
    const plan = makePlan([makeEpisode(1), makeEpisode(2)]);
    const changes = summarizeEpisodeChanges(plan, plan);
    expect(changes).toEqual([]);
  });

  it("detects single field change in one episode", () => {
    const original = makePlan([makeEpisode(1), makeEpisode(2)]);
    const revised = makePlan([
      makeEpisode(1, { characterDevelopment: "Revised development" }),
      makeEpisode(2),
    ]);
    const changes = summarizeEpisodeChanges(original, revised);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.episodeNumber).toBe(1);
    expect(changes[0]!.changedFields).toContain("characterDevelopment");
  });

  it("detects multiple field changes in one episode", () => {
    const original = makePlan([makeEpisode(1), makeEpisode(2)]);
    const revised = makePlan([
      makeEpisode(1, {
        characterDevelopment: "Revised",
        centralConflict: "New conflict",
        workingTitle: "New Title",
      }),
      makeEpisode(2),
    ]);
    const changes = summarizeEpisodeChanges(original, revised);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.episodeNumber).toBe(1);
    expect(changes[0]!.changedFields).toHaveLength(3);
    expect(changes[0]!.changedFields).toContain("characterDevelopment");
    expect(changes[0]!.changedFields).toContain("centralConflict");
    expect(changes[0]!.changedFields).toContain("workingTitle");
  });

  it("detects changes across multiple episodes", () => {
    const original = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3)]);
    const revised = makePlan([
      makeEpisode(1, { characterDevelopment: "Revised 1" }),
      makeEpisode(2, { centralConflict: "Revised 2" }),
      makeEpisode(3),
    ]);
    const changes = summarizeEpisodeChanges(original, revised);
    expect(changes).toHaveLength(2);
    expect(changes[0]!.episodeNumber).toBe(1);
    expect(changes[1]!.episodeNumber).toBe(2);
  });

  it("detects array field changes", () => {
    const original = makePlan([makeEpisode(1)]);
    const revised = makePlan([
      makeEpisode(1, { majorStoryBeats: ["New beat 1", "New beat 2", "New beat 3"] }),
    ]);
    const changes = summarizeEpisodeChanges(original, revised);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.changedFields).toContain("majorStoryBeats");
  });

  it("marks all fields as changed for new episodes not in original", () => {
    const original = makePlan([makeEpisode(1)]);
    const revised = makePlan([makeEpisode(1), makeEpisode(2)]);
    const changes = summarizeEpisodeChanges(original, revised);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.episodeNumber).toBe(2);
    expect(changes[0]!.changedFields.length).toBeGreaterThan(5);
  });
});

describe("Revision History — createRevisionHistoryEntry", () => {
  beforeEach(() => {
    resetEntryCounter();
  });

  it("creates an entry from a loop result", () => {
    const originalPlan = makePlan([makeEpisode(1), makeEpisode(2)]);
    const loopResult = makeLoopResult({
      finalPlan: makePlan([
        makeEpisode(1, { characterDevelopment: "Fixed" }),
        makeEpisode(2),
      ]),
    });

    const entry = createRevisionHistoryEntry(
      loopResult,
      "auto_revalidation",
      1,
      2,
      "Automatic revision",
      3,
      originalPlan,
    );

    expect(entry.source).toBe("auto_revalidation");
    expect(entry.fromVersion).toBe(1);
    expect(entry.toVersion).toBe(2);
    expect(entry.reason).toBe("Automatic revision");
    expect(entry.stopReason).toBe("all_blocking_resolved");
    expect(entry.totalRounds).toBe(1);
    expect(entry.totalRevisionsApplied).toBe(1);
    expect(entry.totalRevisionsRejected).toBe(0);
    expect(entry.findingsBefore).toBe(3);
    expect(entry.findingsAfter).toBe(0);
    expect(entry.blockingResolved).toBe(true);
    expect(entry.reviewStatus).toBe("pending");
    expect(entry.reviewedBy).toBeNull();
    expect(entry.reviewedAt).toBeNull();
    expect(entry.reviewNotes).toBeNull();
  });

  it("records episode changes from the loop result", () => {
    const originalPlan = makePlan([makeEpisode(1), makeEpisode(2)]);
    const loopResult = makeLoopResult({
      finalPlan: makePlan([
        makeEpisode(1, { characterDevelopment: "Fixed" }),
        makeEpisode(2),
      ]),
    });

    const entry = createRevisionHistoryEntry(
      loopResult,
      "auto_revalidation",
      1,
      2,
      "Test",
      1,
      originalPlan,
    );

    expect(entry.episodeChanges).toHaveLength(1);
    expect(entry.episodeChanges[0]!.episodeNumber).toBe(1);
    expect(entry.episodeChanges[0]!.changedFields).toContain("characterDevelopment");
  });

  it("records round summaries", () => {
    const originalPlan = makePlan([makeEpisode(1)]);
    const loopResult = makeLoopResult({
      rounds: [{
        round: 1,
        diagnoses: [],
        revisionPlan: {} as never,
        executionResult: {
          revisedPlan: originalPlan,
          results: [],
          successCount: 2,
          rejectedCount: 1,
          failedCount: 0,
          skippedCount: 0,
          allActionsApplied: true,
          stoppedEarly: false,
          stopReason: "",
        },
        impactReports: [],
        revalidationFindings: [],
        revalidationPassed: true,
        newFindingsIntroduced: [],
        stopped: true,
        stopReason: "All blocking resolved.",
      }],
      totalRounds: 1,
    });

    const entry = createRevisionHistoryEntry(
      loopResult,
      "auto_revalidation",
      1,
      2,
      "Test",
      1,
      originalPlan,
    );

    expect(entry.rounds).toHaveLength(1);
    expect(entry.rounds[0]!.round).toBe(1);
    expect(entry.rounds[0]!.actionsApplied).toBe(2);
    expect(entry.rounds[0]!.actionsRejected).toBe(1);
  });

  it("generates unique entry IDs", () => {
    const plan = makePlan([makeEpisode(1)]);
    const loopResult = makeLoopResult();

    const entry1 = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "A", 0, plan);
    const entry2 = createRevisionHistoryEntry(loopResult, "auto_revalidation", 2, 3, "B", 0, plan);

    expect(entry1.entryId).not.toBe(entry2.entryId);
  });

  it("sets timestamp to a valid ISO string", () => {
    const plan = makePlan([makeEpisode(1)]);
    const loopResult = makeLoopResult();

    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "Test", 0, plan);

    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("Revision History — applyReviewDecision", () => {
  beforeEach(() => {
    resetEntryCounter();
  });

  it("approves a pending entry", () => {
    const plan = makePlan([makeEpisode(1)]);
    const loopResult = makeLoopResult();
    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "Test", 0, plan);

    const reviewed = applyReviewDecision(entry, {
      decision: "approve",
      notes: "Looks good",
      reviewedBy: "user-123",
      reviewedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(reviewed.reviewStatus).toBe("approved");
    expect(reviewed.reviewedBy).toBe("user-123");
    expect(reviewed.reviewedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(reviewed.reviewNotes).toBe("Looks good");
  });

  it("rejects a pending entry", () => {
    const plan = makePlan([makeEpisode(1)]);
    const loopResult = makeLoopResult();
    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "Test", 0, plan);

    const reviewed = applyReviewDecision(entry, {
      decision: "reject",
      notes: "Changes are incorrect",
      reviewedBy: "user-456",
      reviewedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(reviewed.reviewStatus).toBe("rejected");
    expect(reviewed.reviewedBy).toBe("user-456");
    expect(reviewed.reviewNotes).toBe("Changes are incorrect");
  });

  it("preserves original entry fields", () => {
    const plan = makePlan([makeEpisode(1)]);
    const loopResult = makeLoopResult();
    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "Test", 5, plan);

    const reviewed = applyReviewDecision(entry, {
      decision: "approve",
      notes: null,
      reviewedBy: "user",
      reviewedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(reviewed.entryId).toBe(entry.entryId);
    expect(reviewed.source).toBe("auto_revalidation");
    expect(reviewed.fromVersion).toBe(1);
    expect(reviewed.toVersion).toBe(2);
    expect(reviewed.findingsBefore).toBe(5);
  });
});

describe("Revision History — helper functions", () => {
  beforeEach(() => {
    resetEntryCounter();
  });

  it("isPendingReview returns true for pending entries", () => {
    const plan = makePlan([makeEpisode(1)]);
    const entry = createRevisionHistoryEntry(makeLoopResult(), "auto_revalidation", 1, 2, "T", 0, plan);
    expect(isPendingReview(entry)).toBe(true);
    expect(isApproved(entry)).toBe(false);
    expect(isRejected(entry)).toBe(false);
  });

  it("isApproved returns true for approved entries", () => {
    const plan = makePlan([makeEpisode(1)]);
    const entry = createRevisionHistoryEntry(makeLoopResult(), "auto_revalidation", 1, 2, "T", 0, plan);
    const approved = applyReviewDecision(entry, {
      decision: "approve", notes: null, reviewedBy: "u", reviewedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(isPendingReview(approved)).toBe(false);
    expect(isApproved(approved)).toBe(true);
    expect(isRejected(approved)).toBe(false);
  });

  it("isRejected returns true for rejected entries", () => {
    const plan = makePlan([makeEpisode(1)]);
    const entry = createRevisionHistoryEntry(makeLoopResult(), "auto_revalidation", 1, 2, "T", 0, plan);
    const rejected = applyReviewDecision(entry, {
      decision: "reject", notes: null, reviewedBy: "u", reviewedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(isPendingReview(rejected)).toBe(false);
    expect(isApproved(rejected)).toBe(false);
    expect(isRejected(rejected)).toBe(true);
  });

  it("hasEpisodeChanges returns true when changes exist", () => {
    const original = makePlan([makeEpisode(1)]);
    const loopResult = makeLoopResult({
      finalPlan: makePlan([makeEpisode(1, { characterDevelopment: "Fixed" })]),
    });
    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "T", 0, original);
    expect(hasEpisodeChanges(entry)).toBe(true);
  });

  it("hasEpisodeChanges returns false when no changes", () => {
    const plan = makePlan([makeEpisode(1)]);
    const loopResult = makeLoopResult({ finalPlan: plan });
    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "T", 0, plan);
    expect(hasEpisodeChanges(entry)).toBe(false);
  });

  it("getChangedEpisodeNumbers returns episode numbers", () => {
    const original = makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3)]);
    const loopResult = makeLoopResult({
      finalPlan: makePlan([
        makeEpisode(1, { characterDevelopment: "Fixed 1" }),
        makeEpisode(2),
        makeEpisode(3, { centralConflict: "Fixed 3" }),
      ]),
    });
    const entry = createRevisionHistoryEntry(loopResult, "auto_revalidation", 1, 2, "T", 0, original);
    const nums = getChangedEpisodeNumbers(entry);
    expect(nums).toContain(1);
    expect(nums).toContain(3);
    expect(nums).not.toContain(2);
  });
});

describe("Revision History — createRevisionLLMCallerFromProvider", () => {
  it("creates a caller that delegates to the LLM provider", async () => {
    const { createRevisionLLMCallerFromProvider, createMockLLMCaller } = await import(
      "@/lib/domain/planValidation/revisionExecutor"
    );

    const mockCaller = createMockLLMCaller((prompt) => prompt.currentEpisode, "test-provider", "test-model");
    const caller = createRevisionLLMCallerFromProvider({
      async reviseEpisode(prompt) {
        return mockCaller.reviseEpisode(prompt);
      },
    });

    const prompt = {
      seriesTitle: "Test",
      action: {
        actionId: "a1",
        groupId: "g1",
        findingIds: ["f1"],
        type: "episode_revision" as const,
        domain: "character_continuity" as const,
        classification: "genuine_continuity_error" as const,
        priority: 1,
        affectedEpisodes: [1],
        description: "Test",
        correctionGuidance: "Test",
        safetyConstraints: [],
        requiresHumanApproval: false,
        target: { episodeNumber: 1 },
      },
      currentEpisode: makeEpisode(1),
      seasonPlanObjective: "Test objective",
      bible: null,
      previousEpisode: null,
      nextEpisode: null,
    };

    const result = await caller.reviseEpisode(prompt);
    expect(result.episode).toBeDefined();
    expect(result.episode.episodeNumber).toBe(1);
    expect(result.provider).toBe("test-provider");
    expect(result.model).toBe("test-model");
  });

  it("throws when provider does not support reviseEpisode", async () => {
    const { createRevisionLLMCallerFromProvider } = await import(
      "@/lib/domain/planValidation/revisionExecutor"
    );

    const caller = createRevisionLLMCallerFromProvider({});

    await expect(caller.reviseEpisode({} as never)).rejects.toThrow("does not support episode revision");
  });
});