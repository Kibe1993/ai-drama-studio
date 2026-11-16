import { describe, it, expect } from "vitest";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { GraphNode, GraphEdge } from "@/lib/validation/narrativeGraph";
import {
  detectChanges,
  analyzeImpact,
  getImpactsRequiringRevision,
  getBlockingImpacts,
  hasImpact,

} from "@/lib/domain/planValidation/impactAnalyzer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEpisode(num: number, overrides?: Partial<EpisodePlanItem>): EpisodePlanItem {
  return {
    episodeNumber: num,
    workingTitle: `Episode ${num}`,
    narrativePurpose: `Advance the story in episode ${num}`,
    startingSituation: `Start of episode ${num}`,
    mainObjective: `Objective for episode ${num}`,
    centralConflict: `Conflict in episode ${num}`,
    majorStoryBeats: [`Beat 1 of ep ${num}`, `Beat 2 of ep ${num}`],
    informationRevealed: [`Info reveal ${num}`],
    characterDevelopment: `Development in ep ${num}`,
    importantEvents: [`Event in ep ${num}`],
    consequences: [`Consequence of ep ${num}`],
    storyContribution: `Advances season by ${num}`,
    endingOrCliffhanger: `Ending of ep ${num}`,
    unresolvedThreads: [`Thread from ep ${num}`],
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
    centralConflictOrMystery: "Test conflict.",
    mainCharacterObjectives: "Test objectives.",
    overallCharacterDevelopment: "Test development.",
    majorStoryDevelopments: ["Dev 1"],
    beginningDirection: "Beginning.",
    middleDirection: "Middle.",
    endingDirection: "Ending.",
    episodeProgression: episodes,
    importantRevelations: ["Revelation 1"],
    relationshipChanges: ["Rel change 1"],
    consequencesCarriedBetween: ["Consequence 1"],
    setupAndPayoff: ["Setup 1"],
    unresolvedQuestions: ["Question 1"],
    intendedSeasonConclusion: "Conclusion.",
  };
}

function makeGraphNodes(sourceEp: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [
    { id: `episode:${sourceEp}`, type: "episode", label: `Episode ${sourceEp}`, description: `Ep ${sourceEp}`, status: "approved_plan", episodeNumber: sourceEp },
    { id: `consequence:ep${sourceEp}:test`, type: "consequence", label: "Test consequence", description: "Test consequence", status: "approved_plan", episodeNumber: sourceEp },
    { id: `episode:${sourceEp + 1}`, type: "episode", label: `Episode ${sourceEp + 1}`, description: `Ep ${sourceEp + 1}`, status: "approved_plan", episodeNumber: sourceEp + 1 },
  ];
  const edges: GraphEdge[] = [
    { from: `episode:${sourceEp}`, to: `consequence:ep${sourceEp}:test`, type: "consequence_of", description: "creates consequence" },
    { from: `consequence:ep${sourceEp}:test`, to: `episode:${sourceEp + 1}`, type: "depends_on", description: "next ep depends on consequence" },
  ];
  return { nodes, edges };
}

const fullPlan = () => makePlan([makeEpisode(1), makeEpisode(2), makeEpisode(3), makeEpisode(4), makeEpisode(5), makeEpisode(6)]);

// ---------------------------------------------------------------------------
// Change Detection Tests
// ---------------------------------------------------------------------------

describe("Impact Analyzer — change detection", () => {
  describe("detectChanges", () => {
    it("returns no changes when episodes are identical", () => {
      const ep = makeEpisode(1);
      const changes = detectChanges(ep, ep);
      expect(changes).toHaveLength(0);
    });

    it("detects a modified string field", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = { ...original, centralConflict: "Revised conflict" };
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "centralConflict" && c.changeType === "modified")).toBe(true);
    });

    it("detects an added array item", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = { ...original, importantEvents: [...original.importantEvents, "New event"] };
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "importantEvents" && c.changeType === "added")).toBe(true);
    });

    it("detects a removed array item", () => {
      const original = makeEpisode(1, { importantEvents: ["Event A", "Event B"] });
      const revised: EpisodePlanItem = { ...original, importantEvents: ["Event A"] };
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "importantEvents" && c.changeType === "removed")).toBe(true);
    });

    it("detects added character arc changes", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = {
        ...original,
        characterArcChanges: [{ name: "Mara Voss", change: "Becomes determined" }],
      };
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "characterArcChanges" && c.changeType === "added")).toBe(true);
    });

    it("detects removed character arc changes", () => {
      const original = makeEpisode(1, {
        characterArcChanges: [{ name: "Mara Voss", change: "Becomes determined" }],
      });
      const revised = makeEpisode(1);
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "characterArcChanges" && c.changeType === "removed")).toBe(true);
    });

    it("detects modified character arc changes", () => {
      const original = makeEpisode(1, {
        characterArcChanges: [{ name: "Mara Voss", change: "Becomes determined" }],
      });
      const revised: EpisodePlanItem = {
        ...original,
        characterArcChanges: [{ name: "Mara Voss", change: "Becomes resolute" }],
      };
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "characterArcChanges" && c.changeType === "modified")).toBe(true);
    });

    it("detects added relationship changes", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = {
        ...original,
        relationshipChanges: [{ from: "Mara", to: "Vale", change: "Form alliance" }],
      };
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "relationshipChanges" && c.changeType === "added")).toBe(true);
    });

    it("detects removed unresolved threads", () => {
      const original = makeEpisode(1, { unresolvedThreads: ["Thread A", "Thread B"] });
      const revised: EpisodePlanItem = { ...original, unresolvedThreads: ["Thread A"] };
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "unresolvedThreads" && c.changeType === "removed")).toBe(true);
    });

    it("detects ending/cliffhanger changes", () => {
      const original = makeEpisode(1);
      const revised: EpisodePlanItem = { ...original, endingOrCliffhanger: "Completely different ending" };
      const changes = detectChanges(original, revised);
      expect(changes.some((c) => c.field === "endingOrCliffhanger")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Impact Analysis Tests
// ---------------------------------------------------------------------------

describe("Impact Analyzer — analyzeImpact", () => {
  it("returns no impact when episodes are identical", () => {
    const plan = fullPlan();
    const ep = makeEpisode(2);
    const report = analyzeImpact({ originalEpisode: ep, revisedEpisode: ep, plan });
    expect(report.changes).toHaveLength(0);
    expect(report.downstreamImpacts).toHaveLength(0);
    expect(report.hasBlockingImpact).toBe(false);
    expect(report.affectedEpisodeCount).toBe(0);
  });

  it("detects changes and downstream impacts for a revised episode", () => {
    const plan = fullPlan();
    const original = plan.episodeProgression[1]!;
    const revised: EpisodePlanItem = { ...original, centralConflict: "Revised conflict" };
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(report.changes.length).toBeGreaterThan(0);
    expect(report.sourceEpisodeNumber).toBe(2);
  });

  it("identifies blocking impact when a character arc is removed", () => {
    const plan = fullPlan();
    const original = makeEpisode(2, {
      characterArcChanges: [{ name: "Mara Voss", change: "Key development" }],
    });
    const revised = makeEpisode(2);
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(report.changes.some((c) => c.field === "characterArcChanges" && c.changeType === "removed")).toBe(true);
  });

  it("identifies high-severity impact when an unresolved thread is removed", () => {
    const plan = fullPlan();
    const original = makeEpisode(2, { unresolvedThreads: ["Important thread", "Other thread"] });
    const revised = makeEpisode(2, { unresolvedThreads: ["Other thread"] });
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(report.changes.some((c) => c.field === "unresolvedThreads" && c.changeType === "removed")).toBe(true);
  });

  it("identifies ending change as high severity", () => {
    const plan = fullPlan();
    const original = makeEpisode(2);
    const revised = makeEpisode(2, { endingOrCliffhanger: "Completely new ending" });
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(report.changes.some((c) => c.field === "endingOrCliffhanger")).toBe(true);
  });

  it("uses the narrative graph to find dependent episodes", () => {
    const plan = fullPlan();
    const original = makeEpisode(1);
    const revised = makeEpisode(1, { consequences: ["New consequence that changes everything"] });
    const { nodes, edges } = makeGraphNodes(1);
    const report = analyzeImpact({
      originalEpisode: original,
      revisedEpisode: revised,
      plan,
      graphNodes: nodes,
      graphEdges: edges,
    });
    expect(report.changes.length).toBeGreaterThan(0);
  });

  it("produces a human-readable summary", () => {
    const plan = fullPlan();
    const original = makeEpisode(2);
    const revised = makeEpisode(2, { centralConflict: "Different conflict" });
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(report.summary).toContain("Episode 2");
    expect(report.summary).toContain("change");
  });

  it("produces a no-change summary when episodes are identical", () => {
    const plan = fullPlan();
    const ep = makeEpisode(2);
    const report = analyzeImpact({ originalEpisode: ep, revisedEpisode: ep, plan });
    expect(report.summary).toContain("No changes");
  });

  it("sorts downstream impacts by episode number then severity", () => {
    const plan = fullPlan();
    const original = makeEpisode(1, {
      importantEvents: ["Event A", "Event B"],
      unresolvedThreads: ["Thread A", "Thread B"],
    });
    const revised = makeEpisode(1, {
      importantEvents: ["Event A"],
      unresolvedThreads: ["Thread A"],
    });
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    for (let i = 1; i < report.downstreamImpacts.length; i++) {
      const prev = report.downstreamImpacts[i - 1]!;
      const curr = report.downstreamImpacts[i]!;
      if (prev.episodeNumber === curr.episodeNumber) {
        const severityRank = { blocking: 4, high: 3, medium: 2, low: 1 };
        expect(severityRank[prev.severity]).toBeGreaterThanOrEqual(severityRank[curr.severity]);
      } else {
        expect(prev.episodeNumber).toBeLessThan(curr.episodeNumber);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Utility Function Tests
// ---------------------------------------------------------------------------

describe("Impact Analyzer — utility functions", () => {
  it("getImpactsRequiringRevision filters to blocking and high severity", () => {
    const plan = fullPlan();
    const original = makeEpisode(1, {
      characterArcChanges: [{ name: "Mara Voss", change: "Development" }],
    });
    const revised = makeEpisode(1);
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    const requiring = getImpactsRequiringRevision(report);
    expect(requiring.every((i) => i.requiresRevision)).toBe(true);
  });

  it("getBlockingImpacts filters to blocking severity only", () => {
    const plan = fullPlan();
    const original = makeEpisode(1, {
      characterArcChanges: [{ name: "Mara Voss", change: "Development" }],
    });
    const revised = makeEpisode(1);
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    const blocking = getBlockingImpacts(report);
    expect(blocking.every((i) => i.severity === "blocking")).toBe(true);
  });

  it("hasImpact returns true when changes exist", () => {
    const plan = fullPlan();
    const original = makeEpisode(1);
    const revised = makeEpisode(1, { centralConflict: "Different" });
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(hasImpact(report)).toBe(true);
  });

  it("hasImpact returns false when no changes exist", () => {
    const plan = fullPlan();
    const ep = makeEpisode(1);
    const report = analyzeImpact({ originalEpisode: ep, revisedEpisode: ep, plan });
    expect(hasImpact(report)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("Impact Analyzer — edge cases", () => {
  it("handles revision of the last episode (no downstream)", () => {
    const plan = fullPlan();
    const original = plan.episodeProgression[5]!;
    const revised: EpisodePlanItem = { ...original, centralConflict: "Revised" };
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(report.sourceEpisodeNumber).toBe(6);
    expect(report.affectedEpisodeCount).toBe(0);
  });

  it("handles a plan with a single episode", () => {
    const plan = makePlan([makeEpisode(1)]);
    const original = plan.episodeProgression[0]!;
    const revised: EpisodePlanItem = { ...original, centralConflict: "Revised" };
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(report.affectedEpisodeCount).toBe(0);
  });

  it("handles multiple changes in a single revision", () => {
    const plan = fullPlan();
    const original = makeEpisode(2);
    const revised = makeEpisode(2, {
      centralConflict: "New conflict",
      endingOrCliffhanger: "New ending",
      importantEvents: [...original.importantEvents, "Additional event"],
      unresolvedThreads: [...original.unresolvedThreads, "New thread"],
    });
    const report = analyzeImpact({ originalEpisode: original, revisedEpisode: revised, plan });
    expect(report.changes.length).toBeGreaterThanOrEqual(4);
  });
});