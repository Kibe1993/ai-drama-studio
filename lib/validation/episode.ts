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

export const episodeSuggestionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  premise: z.string().trim().min(1).max(3000),
});

export type EpisodeSuggestion = z.infer<typeof episodeSuggestionSchema>;

/**
 * JSON Schema sent to providers with structured output support. Kept beside the
 * Zod schema so a model response is checked twice: once by the provider, then by Zod.
 */
export const EPISODE_SUGGESTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "premise"],
  properties: {
    title: { type: "string" },
    premise: { type: "string" },
  },
} as const;

export type EpisodeInput = z.infer<typeof episodeInputSchema>;

export type EpisodeRecord = EpisodeInput & {
  id: string;
  clerkUserId: string;
  projectId: string;
  episodeNumber: number;
  status: (typeof EPISODE_STATUSES)[number];
  currentStoryId: string | null;
  /** The approved Story Bible version the episode was started from. */
  baseSnapshotVersion: number;
  /** The approved Season Plan version the episode was planned from (CASNA). */
  basePlanVersion: number;
  createdAt: string;
  updatedAt: string;
};
