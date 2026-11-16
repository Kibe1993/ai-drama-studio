import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export const shotProductionRecordSchema = z.object({
  projectId: objectId,
  productionSceneId: objectId,
  shotNumber: z.number().int().min(1),
  productionStatus: z.enum(["pending", "in_progress", "completed", "failed"]).default("pending"),
  generationContext: z.object({
    prompt: z.string().max(4000).default(""),
    referenceAssetIds: z.array(objectId).default([]),
    provider: z.string().max(80).default(""),
    model: z.string().max(160).default(""),
    settings: z.record(z.string(), z.unknown()).default({}),
  }).default({}),
  resultingAssetIds: z.array(objectId).default([]),
  segments: z.array(z.object({
    segmentNumber: z.number().int().min(1),
    durationSeconds: z.number().positive(),
    assetId: objectId.nullable().optional(),
  })).default([]),
  adjustedDurationSeconds: z.number().positive().nullable().default(null),
  validationInfo: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(8).max(180),
  sourceCanonVersion: z.number().int().nonnegative().nullable().optional(),
  canonStale: z.boolean().optional(),
  canonStaleReason: z.string().max(600).optional(),
});

export type ShotProductionRecordInput = z.infer<typeof shotProductionRecordSchema>;
export type ShotProductionRecord = ShotProductionRecordInput & {
  id: string;
  clerkUserId: string;
  createdAt: string;
  updatedAt: string;
};