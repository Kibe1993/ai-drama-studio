import { z } from "zod";
import { DURATION_OPTIONS } from "@/lib/domain/projectCatalog";

const allowedDurations = DURATION_OPTIONS.map((item) => item.seconds);

export const EPISODE_STATUSES = [
  "draft", "in_production", "story_review", "story_approved", "unavailable", "failed", "completed",
] as const;

export const episodeInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  premise: z.string().trim().max(3000).default(""),
  targetDurationSeconds: z.number().int().refine((seconds) => allowedDurations.some((value) => value === seconds)),
});

export type EpisodeInput = z.infer<typeof episodeInputSchema>;

export type EpisodeRecord = EpisodeInput & {
  id: string;
  clerkUserId: string;
  projectId: string;
  episodeNumber: number;
  status: (typeof EPISODE_STATUSES)[number];
  currentStoryId: string | null;
  baseSnapshotVersion: number;
  createdAt: string;
  updatedAt: string;
};
