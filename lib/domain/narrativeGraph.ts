import type {
  GraphNode,
  GraphEdge,
  GraphNodeStatus,
  DependencyValidation,
} from "@/lib/validation/narrativeGraph";
import type { EpisodeCanonSummary } from "@/lib/validation/casna";
import type { SeasonPlanRecord } from "@/lib/validation/seasonPlan";

/**
 * Narrative Dependency Graph — domain logic.
 *
 * Pure functions for constructing, validating, and querying the dependency
 * graph that connects story elements across episodes. The graph is derived
 * from the approved Season Plan (proposed nodes) and updated when episodes are
 * approved (established canon). It is the single source of truth for what
 * depends on what, what has been established, and what remains unresolved.
 */

function nodeId(type: string, key: string): string {
  return `${type}:${key}`;
}

/**
 * Build proposed graph nodes from an approved Season Plan.
 * These nodes have status "approved_plan" — they are planned but not yet
 * established canon. They become "established_canon" only when the episode
 * containing them is approved.
 */
export function buildProposedNodesFromPlan(plan: SeasonPlanRecord): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const ep of plan.episodeProgression) {
    const epNodeId = nodeId("episode", String(ep.episodeNumber));
    nodes.push({
      id: epNodeId,
      type: "episode",
      label: `Episode ${ep.episodeNumber}`,
      description: ep.workingTitle ?? `Episode ${ep.episodeNumber}`,
      status: "approved_plan" as GraphNodeStatus,
      episodeNumber: ep.episodeNumber,
    });

    for (const reveal of ep.informationRevealed ?? []) {
      const revealId = nodeId("revelation", `ep${ep.episodeNumber}:${reveal.slice(0, 60)}`);
      nodes.push({
        id: revealId,
        type: "revelation",
        label: reveal.slice(0, 80),
        description: reveal,
        status: "approved_plan" as GraphNodeStatus,
        episodeNumber: ep.episodeNumber,
      });
      edges.push({
        from: epNodeId,
        to: revealId,
        type: "introduces",
        description: `Episode ${ep.episodeNumber} reveals: ${reveal.slice(0, 100)}`,
      });
    }

    for (const thread of ep.unresolvedThreads ?? []) {
      const threadId = nodeId("unresolved_thread", `ep${ep.episodeNumber}:${thread.slice(0, 60)}`);
      nodes.push({
        id: threadId,
        type: "unresolved_thread",
        label: thread.slice(0, 80),
        description: thread,
        status: "approved_plan" as GraphNodeStatus,
        episodeNumber: ep.episodeNumber,
      });
      edges.push({
        from: epNodeId,
        to: threadId,
        type: "introduces",
        description: `Episode ${ep.episodeNumber} introduces thread: ${thread.slice(0, 100)}`,
      });
    }

    for (const consequence of ep.consequences ?? []) {
      const consId = nodeId("consequence", `ep${ep.episodeNumber}:${consequence.slice(0, 60)}`);
      nodes.push({
        id: consId,
        type: "consequence",
        label: consequence.slice(0, 80),
        description: consequence,
        status: "approved_plan" as GraphNodeStatus,
        episodeNumber: ep.episodeNumber,
      });
      edges.push({
        from: epNodeId,
        to: consId,
        type: "consequence_of",
        description: `Episode ${ep.episodeNumber} creates consequence: ${consequence.slice(0, 100)}`,
      });
    }
  }

  return { nodes: deduplicateNodes(nodes), edges: deduplicateEdges(edges) };
}

/**
 * Update graph nodes when an episode is approved — promote proposed nodes to
 * established canon and resolve threads that the episode addresses.
 */
export function promoteNodesForApprovedEpisode(
  existingNodes: GraphNode[],
  existingEdges: GraphEdge[],
  canon: EpisodeCanonSummary
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map(existingNodes.map((n) => [n.id, { ...n }]));
  const edges = [...existingEdges];

  for (const event of canon.events) {
    const eventId = nodeId("story_event", `ep${canon.episodeNumber}:${event.event.slice(0, 60)}`);
    const existing = nodeMap.get(eventId);
    if (existing) {
      existing.status = "established_canon";
    } else {
      nodeMap.set(eventId, {
        id: eventId,
        type: "story_event",
        label: event.event.slice(0, 80),
        description: event.event,
        status: "established_canon",
        episodeNumber: canon.episodeNumber,
      });
    }
  }

  for (const secret of canon.revealedSecrets) {
    const secretId = nodeId("secret", `ep${canon.episodeNumber}:${secret.slice(0, 60)}`);
    const existing = nodeMap.get(secretId);
    if (existing) {
      existing.status = "established_canon";
    } else {
      nodeMap.set(secretId, {
        id: secretId,
        type: "secret",
        label: secret.slice(0, 80),
        description: secret,
        status: "established_canon",
        episodeNumber: canon.episodeNumber,
      });
    }
  }

  for (const thread of canon.unresolvedThreads) {
    const threadId = nodeId("unresolved_thread", `ep${thread.introducedInEpisode}:${thread.thread.slice(0, 60)}`);
    const existing = nodeMap.get(threadId);
    if (existing) {
      existing.status = thread.status === "resolved" ? "resolved" : "established_canon";
    }
  }

  for (const state of canon.characterStates) {
    const charId = nodeId("character", state.name);
    const existing = nodeMap.get(charId);
    if (existing) {
      existing.status = "established_canon";
    } else {
      nodeMap.set(charId, {
        id: charId,
        type: "character",
        label: state.name,
        description: `${state.name}: ${state.currentObjective}`,
        status: "established_canon",
        episodeNumber: canon.episodeNumber,
      });
    }
    for (const knowledge of state.knowledge) {
      const knowledgeId = nodeId("character_knowledge", `${state.name}:${knowledge.slice(0, 60)}`);
      nodeMap.set(knowledgeId, {
        id: knowledgeId,
        type: "character_knowledge",
        label: `${state.name} knows: ${knowledge.slice(0, 60)}`,
        description: knowledge,
        status: "established_canon",
        episodeNumber: canon.episodeNumber,
      });
      edges.push({
        from: charId,
        to: knowledgeId,
        type: "knowledge_from",
        description: `${state.name} learned: ${knowledge.slice(0, 100)}`,
      });
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges: deduplicateEdges(edges) };
}

/**
 * Validate that all dependencies for a target episode are satisfied.
 * A dependency is satisfied when the node it depends on is at least
 * "established_canon" or "resolved".
 */
export function validateDependencies(
  nodes: GraphNode[],
  edges: GraphEdge[],
  targetEpisodeNumber: number
): DependencyValidation {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const violations: DependencyValidation["violations"] = [];

  const targetNodes = nodes.filter((n) => n.episodeNumber === targetEpisodeNumber);

  for (const node of targetNodes) {
    const incomingDeps = edges.filter((e) => e.to === node.id && e.type === "depends_on");
    for (const dep of incomingDeps) {
      const depNode = nodeMap.get(dep.from);
      if (!depNode) {
        violations.push({
          nodeId: node.id,
          message: `Dependency "${dep.from}" is referenced but does not exist in the graph.`,
          severity: "error",
        });
        continue;
      }
      if (depNode.status === "proposed" || depNode.status === "rejected") {
        violations.push({
          nodeId: node.id,
          message: `Dependency "${depNode.label}" (${depNode.status}) is not yet established. It must be approved before episode ${targetEpisodeNumber}.`,
          severity: "error",
        });
      }
    }
  }

  for (const node of targetNodes) {
    if (node.type === "payoff") {
      const setupEdges = edges.filter((e) => e.to === node.id && e.type === "payoff_of");
      for (const edge of setupEdges) {
        const setupNode = nodeMap.get(edge.from);
        if (setupNode && setupNode.status !== "established_canon") {
          violations.push({
            nodeId: node.id,
            message: `Payoff "${node.label}" depends on setup "${setupNode.label}" which is not yet established canon.`,
            severity: "error",
          });
        }
      }
    }
  }

  for (const node of nodes) {
    if (node.type === "revelation" && node.episodeNumber === targetEpisodeNumber) {
      const clueEdges = edges.filter((e) => e.to === node.id && e.type === "clue_for");
      if (clueEdges.length === 0) {
        violations.push({
          nodeId: node.id,
          message: `Revelation "${node.label}" has no supporting clues in the dependency graph.`,
          severity: "warning",
        });
      }
    }
  }

  return { valid: !violations.some((v) => v.severity === "error"), violations };
}

/**
 * Selective retrieval: return only the graph nodes and edges relevant to
 * generating episode N. Includes:
 * - All established canon nodes (facts that must be respected)
 * - Proposed nodes for the next 3 upcoming episodes
 * - Unresolved threads (active dependencies)
 * - Edges connecting the retrieved nodes
 */
export function retrieveRelevantSubgraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  targetEpisodeNumber: number
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const relevantNodes = nodes.filter((n) => {
    if (n.status === "established_canon" || n.status === "resolved") return true;
    if (n.status === "superseded" || n.status === "rejected") return false;
    if (n.episodeNumber === undefined) return n.status === "approved_plan";
    return n.episodeNumber >= targetEpisodeNumber && n.episodeNumber <= targetEpisodeNumber + 2;
  });

  const nodeIds = new Set(relevantNodes.map((n) => n.id));
  const relevantEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  return { nodes: relevantNodes, edges: relevantEdges };
}

/**
 * Check whether a planned future event is being treated as established canon.
 * This is a critical invariant: planned events must not appear as facts.
 */
export function detectCanonViolations(nodes: GraphNode[]): string[] {
  const violations: string[] = [];
  for (const node of nodes) {
    if (node.status === "proposed" || node.status === "approved_plan") {
      if (node.metadata?.treatedAsCanon === true) {
        violations.push(
          `Node "${node.label}" (${node.type}) is planned (${node.status}) but treated as canon.`
        );
      }
    }
  }
  return violations;
}

function deduplicateNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (!seen.has(node.id)) seen.set(node.id, node);
  }
  return Array.from(seen.values());
}

function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }
  return result;
}