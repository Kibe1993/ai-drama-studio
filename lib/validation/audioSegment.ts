import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

export const AUDIO_SEGMENT_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type AudioSegmentStatus = (typeof AUDIO_SEGMENT_STATUSES)[number];

export const AUDIO_SEGMENT_KINDS = ["dialogue", "narration"] as const;
export type AudioSegmentKind = (typeof AUDIO_SEGMENT_KINDS)[number];

export const AUDIO_SPEAKER_TYPES = ["character", "narrator"] as const;
export type AudioSpeakerType = (typeof AUDIO_SPEAKER_TYPES)[number];

export const audioSegmentSchema = z.object({
  projectId: objectId,
  episodeId: objectId.nullable().optional(),
  runId: objectId,
  storyId: objectId,
  sceneNumber: z.number().int().positive().max(50),
  sequence: z.number().int().min(0).max(999),
  speakerType: z.enum(AUDIO_SPEAKER_TYPES),
  speakerName: z.string().trim().min(1).max(160),
  canonicalEntityId: objectId.nullable().optional(),
  voiceProfileId: objectId.nullable().optional(),
  voiceIdentifier: z.string().trim().min(1).max(160),
  text: z.string().trim().min(1).max(500),
  kind: z.enum(AUDIO_SEGMENT_KINDS),
  status: z.enum(AUDIO_SEGMENT_STATUSES).default("pending"),
  mediaAssetId: objectId.nullable().optional(),
  durationSeconds: z.number().positive().nullable().default(null),
  error: z.string().trim().max(500).nullable().default(null),
  attempts: z.number().int().min(0).default(0),
  idempotencyKey: z.string().trim().min(8).max(180),
  sourceCanonVersion: z.number().int().nonnegative().nullable().optional(),
  canonStale: z.boolean().optional(),
  canonStaleReason: z.string().max(600).optional(),
});

export type AudioSegmentInput = z.infer<typeof audioSegmentSchema>;
export type AudioSegmentRecord = AudioSegmentInput & {
  id: string;
  clerkUserId: string;
  createdAt: string;
  updatedAt: string;
};