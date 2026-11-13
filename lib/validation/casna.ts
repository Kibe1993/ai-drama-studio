import { z } from "zod";
import {
  characterStateSchema,
  continuityLocationStateSchema,
  continuityObjectStateSchema,
  unresolvedThreadSchema,
} from "@/lib/validation/continuityLedger";

const text = (max: number) => z.string().trim().min(1).max(max);
const list = (maxItems: number, maxLen: number) => z.array(text(maxLen)).max(maxItems);

/**
 * CASNA Stage F: the episode-specific plan that is generated before a
 * screenplay. It is derived from the approved Season Plan's episode entry and
 * augmented with what the episode inherits from the Continuity Ledger and the
 * previous approved episode. It is validated against the Season Plan before the
 * screenplay is written, and stored on the story draft as proposed content that
 * only becomes canon when the episode is approved.
 */
export const episodePlanSchema = z.object({
  episodeNumber: z.number().int().positive().max(100),
  workingTitle: text(120),
  narrativePurpose: text(600),
  /** The approved Season Plan version this episode plan was derived from. */
  sourcePlanVersion: z.number().int().min(1),
  /** What the episode inherits from earlier approved episodes and the ledger. */
  inheritsFrom: list(8, 400),
  intendsToAchieve: text(600),
  /** Proposed developments. Not canon until the episode is approved. */
  newDevelopments: list(8, 400),
  characterChanges: list(6, 400),
  informationRevealed: list(8, 400),
  consequencesCreated: list(8, 400),
  seasonAdvance: text(600),
  carryForward: text(600),
  continuityRequirements: text(600),
  unresolvedThreads: list(6, 400),
  /** Structured canon deltas proposed for this episode (from the approved plan). */
  characterArcChanges: z
    .array(z.object({ name: text(80), change: text(400) }))
    .max(8)
    .optional(),
  relationshipChanges: z
    .array(z.object({ from: text(80), to: text(80), change: text(300) }))
    .max(6)
    .optional(),
  objectChanges: z
    .array(z.object({ name: text(120), ownership: text(200), condition: text(300) }))
    .max(6)
    .optional(),
  locationChanges: z
    .array(z.object({ name: text(120), change: text(300) }))
    .max(6)
    .optional(),
});

export type EpisodePlan = z.infer<typeof episodePlanSchema>;

export const EPISODE_PLAN_CATEGORIES = [
  "completeness",
  "canon",
  "continuity",
  "progression",
  "repetition",
  "structure",
  "duration",
  "timeline",
  "knowledge",
  "quality",
] as const;

export type EpisodeValidationCategory = (typeof EPISODE_PLAN_CATEGORIES)[number];

export const episodeValidationFindingSchema = z.object({
  category: z.enum(EPISODE_PLAN_CATEGORIES),
  severity: z.enum(["warning", "error"]),
  sceneNumber: z.number().int().positive().optional(),
  message: text(600),
});

export type EpisodeValidationFinding = z.infer<typeof episodeValidationFindingSchema>;

export const episodeValidationSchema = z.object({
  passed: z.boolean(),
  findings: z.array(episodeValidationFindingSchema),
  validatedAt: z.string().trim().min(1).max(40),
});

export type EpisodeValidation = z.infer<typeof episodeValidationSchema>;

/**
 * CASNA Stage I: the authoritative summary of an approved episode. It is built
 * from the approved Season Plan entry for the episode plus the approved
 * screenplay, and becomes the only source the Continuity Ledger is updated from.
 */
export const episodeCanonSummarySchema = z.object({
  episodeNumber: z.number().int().positive().max(100),
  title: text(120),
  summary: text(2000),
  events: z
    .array(
      z.object({
        event: text(400),
        consequence: text(400),
        affectedCharacters: list(8, 80),
        revealedInformation: list(6, 300),
      })
    )
    .max(10),
  characterStates: z.array(characterStateSchema).max(24),
  locationStates: z.array(continuityLocationStateSchema).max(18),
  objectStates: z.array(continuityObjectStateSchema).max(18).default([]),
  revealedSecrets: list(10, 400),
  unresolvedThreads: z.array(unresolvedThreadSchema).max(16),
  consequences: list(10, 400),
});

export type EpisodeCanonSummary = z.infer<typeof episodeCanonSummarySchema>;
