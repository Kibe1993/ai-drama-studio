import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export const renderJobSchema = z.object({
  projectId: objectId,
  episodeId: objectId,
  timelineId: objectId,
  presetId: z.string().trim().min(1).max(60),
  inputAssetIds: z.array(objectId).default([]),
  outputAssetId: objectId.nullable().default(null),
  renderSettings: z.record(z.string(), z.unknown()).default({}),
  ffmpegVersion: z.string().max(40).nullable().default(null),
  renderDurationSeconds: z.number().min(0).nullable().default(null),
  status: z.enum(["queued", "processing", "completed", "failed", "cancelled"]).default("queued"),
  error: z.record(z.string(), z.unknown()).nullable().default(null),
  idempotencyKey: z.string().trim().min(8).max(180),
  bullJobId: z.string().max(120).nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  sourceCanonVersion: z.number().int().nonnegative().nullable().optional(),
  canonStale: z.boolean().optional(),
  canonStaleReason: z.string().max(600).optional(),
});

export type RenderJobInput = z.infer<typeof renderJobSchema>;
export type RenderJobRecord = RenderJobInput & {
  id: string;
  clerkUserId: string;
  createdAt: string;
  updatedAt: string;
};