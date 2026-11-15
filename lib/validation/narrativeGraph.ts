import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * Narrative Dependency Graph — tracks explicit dependencies between story
 * elements across episodes. Each node has a status that distinguishes proposed
 * content from established canon.
 */

export const GRAPH_NODE_TYPES = [
  "story_event",
  "clue",
  "revelation",
  "character",
  "character_knowledge",
  "location",
  "object",
  "episode",
  "scene",
  "decision",
  "consequence",
  "unresolved_thread",
  "mystery",
  "secret",
  "turning_point",
  "setup",
  "payoff",
] as const;

export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export const GRAPH_NODE_STATUSES = [
  "proposed",
  "approved_plan",
  "introduced",
  "established_canon",
  "resolved",
  "superseded",
  "rejected",
] as const;

export type GraphNodeStatus = (typeof GRAPH_NODE_STATUSES)[number];

export const GRAPH_EDGE_TYPES = [
  "depends_on",
  "establishes",
  "reveals",
  "resolves",
  "contradicts",
  "supersedes",
  "introduces",
  "develops",
  "payoff_of",
  "consequence_of",
  "clue_for",
  "setup_for",
  "knowledge_from",
] as const;

export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number];

export const graphNodeSchema = z.object({
  id: text(120),
  type: z.enum(GRAPH_NODE_TYPES),
  label: text(200),
  description: text(800),
  status: z.enum(GRAPH_NODE_STATUSES),
  episodeNumber: z.number().int().positive().max(100).optional(),
  sceneNumber: z.number().int().positive().max(200).optional(),
  /** Type-specific metadata (e.g., clue evidence, character knowledge content). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  from: text(120),
  to: text(120),
  type: z.enum(GRAPH_EDGE_TYPES),
  description: text(400),
});

export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const narrativeGraphSchema = z.object({
  nodes: z.array(graphNodeSchema).max(500),
  edges: z.array(graphEdgeSchema).max(1000),
  asOfEpisode: z.number().int().min(0).max(100),
  basedOnPlanVersion: z.number().int().min(0),
  version: z.number().int().min(1),
});

export type NarrativeGraphRecord = z.infer<typeof narrativeGraphSchema> & {
  id: string;
  clerkUserId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Validation result for dependency checks.
 */
export const dependencyValidationSchema = z.object({
  valid: z.boolean(),
  violations: z.array(
    z.object({
      nodeId: text(120),
      message: text(600),
      severity: z.enum(["warning", "error"]),
    })
  ).max(50),
});

export type DependencyValidation = z.infer<typeof dependencyValidationSchema>;