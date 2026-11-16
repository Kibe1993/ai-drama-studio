import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const timelineClipSchema = z.object({
  assetId: objectId,
  startSeconds: z.number().min(0).default(0),
  durationSeconds: z.number().positive(),
  audioOffsetSeconds: z.number().default(0),
  transition: z.string().max(60).default(""),
  optional: z.boolean().default(false),
});

const timelineTrackSchema = z.object({
  kind: z.enum(["video", "dialogue", "narration", "music", "sfx", "subtitle"]),
  clips: z.array(timelineClipSchema).default([]),
});

const validationResultSchema = z.object({
  missingAssets: z.array(z.string()).default([]),
  overlaps: z.array(z.record(z.string(), z.unknown())).default([]),
  brokenReferences: z.array(z.string()).default([]),
  durationMismatch: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});

export const timelineSchema = z.object({
  projectId: objectId,
  episodeId: objectId,
  tracks: z.array(timelineTrackSchema).default([]),
  aspectRatio: z.string().max(10).default("16:9"),
  outputResolution: z.string().max(20).default("1920x1080"),
  frameRate: z.number().min(1).default(30),
  episodeTargetDurationSeconds: z.number().min(0).nullable().default(null),
  status: z.enum(["draft", "under_review", "approved", "stale"]).default("draft"),
  validation: validationResultSchema.default({}),
  idempotencyKey: z.string().trim().min(8).max(180),
  sourceCanonVersion: z.number().int().nonnegative().nullable().optional(),
  canonStale: z.boolean().optional(),
  canonStaleReason: z.string().max(600).optional(),
});

export type TimelineRecord = z.infer<typeof timelineSchema> & {
  id: string;
  clerkUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type TimelineTrack = z.infer<typeof timelineTrackSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;