import { z } from "zod";

const layerStatus = z.enum(["passed", "failed", "not_executed"]);

/**
 * The provisional narrative claim of a Story Draft.
 * It is stored on the draft. It is not a second canon collection.
 * A model fact stays proposed until the creator approves the draft.
 */
export const storyContractSchema = z.object({
  version: z.literal(1),
  status: z.enum(["provisional", "approved"]),
  draftHash: z.string().trim().min(16).max(64),
  layers: z.object({
    structural: layerStatus,
    agreement: layerStatus,
    worldRules: layerStatus,
    knowledge: layerStatus,
    causal: layerStatus,
    semantic: layerStatus,
  }),
  characters: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    role: z.enum(["creator", "proposed"]),
    source: z.string().trim().min(1).max(80),
    evidence: z.string().trim().max(240),
  })).max(40),
  rules: z.array(z.object({
    description: z.string().trim().min(1).max(400),
    intervalCount: z.number().int().positive().max(10000).nullable(),
    intervalUnit: z.enum(["year", "month", "week", "day"]).nullable(),
    approvalStatus: z.enum(["proposed", "approved"]),
    source: z.string().trim().min(1).max(80),
    evidence: z.string().trim().max(240),
  })).max(20),
  events: z.array(z.object({
    description: z.string().trim().min(1).max(400),
    sceneNumber: z.number().int().positive().nullable(),
    source: z.string().trim().min(1).max(80),
    evidence: z.string().trim().max(240),
    dramatized: z.boolean(),
  })).max(40),
  scenes: z.array(z.object({
    sceneNumber: z.number().int().positive(),
    location: z.string().trim().max(120),
    characters: z.array(z.string().trim().min(1).max(80)).max(12),
    purpose: z.string().trim().max(240),
    outcome: z.string().trim().max(400),
  })).max(40),
});

export type StoryContract = z.infer<typeof storyContractSchema>;
export type ContractLayer = z.infer<typeof layerStatus>;
