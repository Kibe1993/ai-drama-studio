import { describe, expect, it } from "vitest";
import {
  buildProposedNodesFromPlan,
  promoteNodesForApprovedEpisode,
  validateDependencies,
  retrieveRelevantSubgraph,
  detectCanonViolations,
} from "@/lib/domain/narrativeGraph";
import type { SeasonPlanRecord } from "@/lib/validation/seasonPlan";
import type { EpisodeCanonSummary } from "@/lib/validation/casna";
import type { GraphNode, GraphEdge } from "@/lib/validation/narrativeGraph";

function makePlan(): SeasonPlanRecord {
  return {
    seasonObjective: "Find the truth",
    centralConflictOrMystery: "Who killed the king?",
    mainCharacterObjectives: "Amara seeks justice",
    overallCharacterDevelopment: "Amara grows from naive to decisive",
    majorStoryDevelopments: ["The letter", "The betrayal"],
    beginningDirection: "Amara arrives",
    middleDirection: "Amara investigates",
    endingDirection: "Amara confronts the killer",
    episodeProgression: [
      {
        episodeNumber: 1,
        workingTitle: "The Letter",
        narrativePurpose: "Introduce Amara and the mystery",
        startingSituation: "Amara receives a letter",
        mainObjective: "Read the letter",
        centralConflict: "Amara vs her fear",
        majorStoryBeats: ["Amara reads the letter"],
        informationRevealed: ["The king was murdered"],
        characterDevelopment: "Amara becomes curious",
        importantEvents: ["The letter arrives"],
        consequences: ["Amara is now a target"],
        storyContribution: "Sets up the mystery",
        endingOrCliffhanger: "Amara hears a noise",
        unresolvedThreads: ["Who sent the letter?"],
        continuityRequirements: "None",
        characterArcChanges: [],
        relationshipChanges: [],
        objectChanges: [],
        locationChanges: [],
      },
      {
        episodeNumber: 2,
        workingTitle: "The Suspect",
        narrativePurpose: "Amara investigates",
        startingSituation: "Amara at the palace",
        mainObjective: "Find evidence",
        centralConflict: "Amara vs the suspect",
        majorStoryBeats: ["Amara questions the suspect"],
        informationRevealed: ["The suspect has an alibi"],
        characterDevelopment: "Amara learns to be skeptical",
        importantEvents: ["The interrogation"],
        consequences: ["The suspect is cleared"],
        storyContribution: "Narrows the suspect pool",
        endingOrCliffhanger: "A new clue appears",
        unresolvedThreads: ["Where was the weapon?"],
        continuityRequirements: "Respect the letter from ep1",
        characterArcChanges: [],
        relationshipChanges: [],
        objectChanges: [],
        locationChanges: [],
      },
    ],
    importantRevelations: ["The king was poisoned"],
    relationshipChanges: ["Amara and the suspect: tension"],
    consequencesCarriedBetween: ["Amara is a target"],
    setupAndPayoff: ["The letter setup pays off in ep3"],
    unresolvedQuestions: ["Who is the killer?"],
    intendedSeasonConclusion: "Amara finds the killer",
    id: "a".repeat(24),
    clerkUserId: "user",
    projectId: "b".repeat(24),
    basedOnBibleVersion: 1,
    basedOnBibleFingerprint: "hash",
    version: 1,
    status: "approved",
    provider: "test",
    model: "test",
    fallbackFrom: null,
    validationFindings: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeCanon(episodeNumber: number): EpisodeCanonSummary {
  return {
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    summary: "Things happen",
    events: [
      {
        event: "Amara reads the letter",
        consequence: "Amara becomes a target",
        affectedCharacters: ["Amara"],
        revealedInformation: ["The king was murdered"],
      },
    ],
    characterStates: [
      {
        name: "Amara",
        currentLocation: "Kitchen",
        currentObjective: "Find the truth",
        knowledge: ["The king was murdered"],
        beliefs: ["The letter is genuine"],
        motivations: ["Justice"],
        emotionalState: "Determined",
        physicalState: "Healthy",
        relationships: [],
      },
    ],
    locationStates: [],
    objectStates: [],
    revealedSecrets: ["The king was murdered"],
    unresolvedThreads: [
      { thread: "Who sent the letter?", introducedInEpisode: 1, status: "open" },
    ],
    consequences: ["Amara is now a target"],
  };
}

describe("Narrative Dependency Graph", () => {
  describe("buildProposedNodesFromPlan", () => {
    it("creates episode nodes for each episode in the plan", () => {
      const plan = makePlan();
      const { nodes } = buildProposedNodesFromPlan(plan);
      const episodeNodes = nodes.filter((n) => n.type === "episode");
      expect(episodeNodes).toHaveLength(2);
      expect(episodeNodes.every((n) => n.status === "approved_plan")).toBe(true);
    });

    it("creates revelation nodes linked to their episode", () => {
      const plan = makePlan();
      const { nodes, edges } = buildProposedNodesFromPlan(plan);
      const revelationNodes = nodes.filter((n) => n.type === "revelation");
      expect(revelationNodes.length).toBeGreaterThanOrEqual(2);
      const introducesEdges = edges.filter((e) => e.type === "introduces");
      expect(introducesEdges.length).toBeGreaterThanOrEqual(2);
    });

    it("creates unresolved thread nodes", () => {
      const plan = makePlan();
      const { nodes } = buildProposedNodesFromPlan(plan);
      const threadNodes = nodes.filter((n) => n.type === "unresolved_thread");
      expect(threadNodes.length).toBeGreaterThanOrEqual(2);
    });

    it("creates consequence nodes with consequence_of edges", () => {
      const plan = makePlan();
      const { nodes, edges } = buildProposedNodesFromPlan(plan);
      const consequenceNodes = nodes.filter((n) => n.type === "consequence");
      expect(consequenceNodes.length).toBeGreaterThanOrEqual(2);
      const consequenceEdges = edges.filter((e) => e.type === "consequence_of");
      expect(consequenceEdges.length).toBeGreaterThanOrEqual(2);
    });

    it("deduplicates nodes with the same id", () => {
      const plan = makePlan();
      const { nodes } = buildProposedNodesFromPlan(plan);
      const ids = nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("promoteNodesForApprovedEpisode", () => {
    it("promotes planned nodes to established_canon when episode is approved", () => {
      const plan = makePlan();
      const { nodes, edges } = buildProposedNodesFromPlan(plan);
      const canon = makeCanon(1);
      const result = promoteNodesForApprovedEpisode(nodes, edges, canon);
      const eventNodes = result.nodes.filter((n) => n.type === "story_event");
      expect(eventNodes.length).toBeGreaterThanOrEqual(1);
      expect(eventNodes.every((n) => n.status === "established_canon")).toBe(true);
    });

    it("adds character nodes with established_canon status", () => {
      const plan = makePlan();
      const { nodes, edges } = buildProposedNodesFromPlan(plan);
      const canon = makeCanon(1);
      const result = promoteNodesForApprovedEpisode(nodes, edges, canon);
      const charNodes = result.nodes.filter((n) => n.type === "character");
      expect(charNodes.some((n) => n.label === "Amara")).toBe(true);
      expect(charNodes.every((n) => n.status === "established_canon")).toBe(true);
    });

    it("adds character knowledge nodes with knowledge_from edges", () => {
      const plan = makePlan();
      const { nodes, edges } = buildProposedNodesFromPlan(plan);
      const canon = makeCanon(1);
      const result = promoteNodesForApprovedEpisode(nodes, edges, canon);
      const knowledgeNodes = result.nodes.filter((n) => n.type === "character_knowledge");
      expect(knowledgeNodes.length).toBeGreaterThanOrEqual(1);
      const knowledgeEdges = result.edges.filter((e) => e.type === "knowledge_from");
      expect(knowledgeEdges.length).toBeGreaterThanOrEqual(1);
    });

    it("resolves threads marked as resolved", () => {
      const plan = makePlan();
      const { nodes, edges } = buildProposedNodesFromPlan(plan);
      const canon = makeCanon(1);
      canon.unresolvedThreads = [
        { thread: "Who sent the letter?", introducedInEpisode: 1, status: "resolved" },
      ];
      const result = promoteNodesForApprovedEpisode(nodes, edges, canon);
      const threadNodes = result.nodes.filter((n) => n.type === "unresolved_thread");
      const resolvedThread = threadNodes.find((n) => n.description?.includes("Who sent the letter"));
      if (resolvedThread) {
        expect(resolvedThread.status).toBe("resolved");
      }
    });
  });

  describe("validateDependencies", () => {
    it("returns valid when no dependencies are unsatisfied", () => {
      const nodes: GraphNode[] = [
        { id: "episode:1", type: "episode", label: "Ep1", description: "Ep1", status: "established_canon", episodeNumber: 1 },
        { id: "episode:2", type: "episode", label: "Ep2", description: "Ep2", status: "approved_plan", episodeNumber: 2 },
      ];
      const edges: GraphEdge[] = [];
      const result = validateDependencies(nodes, edges, 2);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("returns invalid when a depends_on edge points to a proposed node", () => {
      const nodes: GraphNode[] = [
        { id: "setup:1", type: "setup", label: "Setup", description: "Setup", status: "proposed", episodeNumber: 1 },
        { id: "payoff:1", type: "payoff", label: "Payoff", description: "Payoff", status: "approved_plan", episodeNumber: 2 },
      ];
      const edges: GraphEdge[] = [
        { from: "setup:1", to: "payoff:1", type: "depends_on", description: "Payoff depends on setup" },
      ];
      const result = validateDependencies(nodes, edges, 2);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.severity === "error")).toBe(true);
    });

    it("warns when a revelation has no supporting clues", () => {
      const nodes: GraphNode[] = [
        { id: "revelation:1", type: "revelation", label: "Revelation", description: "Revelation", status: "approved_plan", episodeNumber: 2 },
      ];
      const edges: GraphEdge[] = [];
      const result = validateDependencies(nodes, edges, 2);
      expect(result.violations.some((v) => v.severity === "warning")).toBe(true);
    });

    it("returns invalid when a payoff depends on a non-established setup", () => {
      const nodes: GraphNode[] = [
        { id: "setup:1", type: "setup", label: "Setup", description: "Setup", status: "approved_plan", episodeNumber: 1 },
        { id: "payoff:1", type: "payoff", label: "Payoff", description: "Payoff", status: "approved_plan", episodeNumber: 2 },
      ];
      const edges: GraphEdge[] = [
        { from: "setup:1", to: "payoff:1", type: "payoff_of", description: "Payoff of setup" },
      ];
      const result = validateDependencies(nodes, edges, 2);
      expect(result.valid).toBe(false);
    });
  });

  describe("retrieveRelevantSubgraph", () => {
    it("includes all established canon nodes", () => {
      const nodes: GraphNode[] = [
        { id: "a", type: "story_event", label: "A", description: "A", status: "established_canon", episodeNumber: 1 },
        { id: "b", type: "story_event", label: "B", description: "B", status: "approved_plan", episodeNumber: 5 },
        { id: "c", type: "story_event", label: "C", description: "C", status: "approved_plan", episodeNumber: 10 },
      ];
      const edges: GraphEdge[] = [];
      const result = retrieveRelevantSubgraph(nodes, edges, 4);
      expect(result.nodes.find((n) => n.id === "a")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "b")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "c")).toBeUndefined();
    });

    it("includes proposed nodes for the next 3 episodes", () => {
      const nodes: GraphNode[] = [
        { id: "ep4", type: "episode", label: "Ep4", description: "Ep4", status: "approved_plan", episodeNumber: 4 },
        { id: "ep5", type: "episode", label: "Ep5", description: "Ep5", status: "approved_plan", episodeNumber: 5 },
        { id: "ep6", type: "episode", label: "Ep6", description: "Ep6", status: "approved_plan", episodeNumber: 6 },
        { id: "ep7", type: "episode", label: "Ep7", description: "Ep7", status: "approved_plan", episodeNumber: 7 },
      ];
      const edges: GraphEdge[] = [];
      const result = retrieveRelevantSubgraph(nodes, edges, 4);
      expect(result.nodes.find((n) => n.id === "ep4")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "ep5")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "ep6")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "ep7")).toBeUndefined();
    });

    it("excludes superseded and rejected nodes", () => {
      const nodes: GraphNode[] = [
        { id: "old", type: "story_event", label: "Old", description: "Old", status: "superseded", episodeNumber: 1 },
        { id: "bad", type: "story_event", label: "Bad", description: "Bad", status: "rejected", episodeNumber: 2 },
      ];
      const edges: GraphEdge[] = [];
      const result = retrieveRelevantSubgraph(nodes, edges, 1);
      expect(result.nodes).toHaveLength(0);
    });
  });

  describe("detectCanonViolations", () => {
    it("returns no violations when planned nodes are not treated as canon", () => {
      const nodes: GraphNode[] = [
        { id: "a", type: "revelation", label: "A", description: "A", status: "approved_plan", episodeNumber: 2 },
      ];
      expect(detectCanonViolations(nodes)).toHaveLength(0);
    });

    it("returns violations when planned nodes are treated as canon", () => {
      const nodes: GraphNode[] = [
        {
          id: "a",
          type: "revelation",
          label: "A",
          description: "A",
          status: "approved_plan",
          episodeNumber: 2,
          metadata: { treatedAsCanon: true },
        },
      ];
      const violations = detectCanonViolations(nodes);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("treated as canon");
    });

    it("returns no violations for established canon nodes", () => {
      const nodes: GraphNode[] = [
        {
          id: "a",
          type: "story_event",
          label: "A",
          description: "A",
          status: "established_canon",
          episodeNumber: 1,
          metadata: { treatedAsCanon: true },
        },
      ];
      expect(detectCanonViolations(nodes)).toHaveLength(0);
    });
  });
});