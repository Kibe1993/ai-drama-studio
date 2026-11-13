import { z } from "zod";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const list = (maxItems: number, maxLen: number) => z.array(text(1, maxLen)).max(maxItems);

/**
 * Per-episode plan within a Season Plan. Each episode has a distinct narrative
 * purpose, inherits from prior episodes, and creates consequences that carry
 * forward.
 */
export const episodeArcChangeSchema = z.object({
  name: text(1, 80),
  change: text(1, 400),
});

export const episodeRelationshipChangeSchema = z.object({
  from: text(1, 80),
  to: text(1, 80),
  change: text(1, 300),
});

export const episodeObjectChangeSchema = z.object({
  name: text(1, 120),
  ownership: text(1, 200),
  condition: text(1, 300),
});

export const episodeLocationChangeSchema = z.object({
  name: text(1, 120),
  change: text(1, 300),
});

export const episodePlanItemSchema = z.object({
  episodeNumber: z.number().int().positive().max(100),
  workingTitle: text(1, 120),
  narrativePurpose: text(1, 600),
  startingSituation: text(1, 800),
  mainObjective: text(1, 600),
  centralConflict: text(1, 600),
  majorStoryBeats: list(10, 400),
  informationRevealed: list(8, 400),
  characterDevelopment: text(1, 800),
  importantEvents: list(8, 400),
  consequences: list(8, 400),
  storyContribution: text(1, 600),
  endingOrCliffhanger: text(1, 600),
  unresolvedThreads: list(6, 400),
  continuityRequirements: text(1, 600),
  /** Structured canon deltas, approved with the plan and applied at episode approval. */
  characterArcChanges: z.array(episodeArcChangeSchema).max(8).default([]),
  relationshipChanges: z.array(episodeRelationshipChangeSchema).max(6).default([]),
  objectChanges: z.array(episodeObjectChangeSchema).max(6).default([]),
  locationChanges: z.array(episodeLocationChangeSchema).max(6).default([]),
});

/**
 * The season-level plan. Describes how the entire season develops, not a
 * collection of unrelated episode summaries.
 */
export const seasonPlanSchema = z.object({
  seasonObjective: text(1, 1200),
  centralConflictOrMystery: text(1, 1000),
  mainCharacterObjectives: text(1, 1000),
  overallCharacterDevelopment: text(1, 1000),
  majorStoryDevelopments: list(10, 500),
  beginningDirection: text(1, 800),
  middleDirection: text(1, 800),
  endingDirection: text(1, 800),
  episodeProgression: z.array(episodePlanItemSchema).min(1).max(24),
  importantRevelations: list(8, 500),
  relationshipChanges: list(8, 500),
  consequencesCarriedBetween: list(8, 500),
  setupAndPayoff: list(6, 500),
  unresolvedQuestions: list(6, 500),
  intendedSeasonConclusion: text(1, 1000),
});

export type EpisodePlanItem = z.infer<typeof episodePlanItemSchema>;
export type SeasonPlan = z.infer<typeof seasonPlanSchema>;

export const SEASON_PLAN_STATUSES = ["awaiting_approval", "approved", "failed"] as const;
export type SeasonPlanStatus = (typeof SEASON_PLAN_STATUSES)[number];

export type SeasonPlanRecord = SeasonPlan & {
  id: string;
  clerkUserId: string;
  projectId: string;
  /** The Story Bible approved version this plan was developed from. */
  basedOnBibleVersion: number;
  /** The Story Bible snapshot content hash for stale-plan detection. */
  basedOnBibleFingerprint: string;
  version: number;
  status: SeasonPlanStatus;
  provider: string;
  model: string;
  fallbackFrom: string | null;
  /** Structured validation findings from the last validation pass. */
  validationFindings: SeasonPlanValidationFindings | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Validation findings (Stage C)
// ---------------------------------------------------------------------------

export const validationFindingSchema = z.object({
  category: z.enum([
    "continuity",
    "progression",
    "repetition",
    "character_development",
    "narrative_structure",
  ]),
  severity: z.enum(["warning", "error"]),
  episodeNumber: z.number().int().positive().optional(),
  message: text(1, 600),
});

export type ValidationFinding = z.infer<typeof validationFindingSchema>;

export type SeasonPlanValidationFindings = {
  passed: boolean;
  findings: ValidationFinding[];
  validatedAt: string;
};

export const seasonPlanValidationFindingsSchema = z.object({
  passed: z.boolean(),
  findings: z.array(validationFindingSchema),
  validatedAt: text(1, 40),
});

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const seasonPlanRequestSchema = z.object({
  operation: z.enum(["generate", "revise", "regenerate"]).default("generate"),
  instruction: z.string().trim().max(2000).optional(),
  episodeCount: z.number().int().min(1).max(24).optional(),
  /** Regenerate only this episode's section of the plan. */
  targetEpisodeNumber: z.number().int().min(1).max(100).optional(),
});
export type SeasonPlanRequest = z.infer<typeof seasonPlanRequestSchema>;

export const seasonPlanRevisionRequestSchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
});
export type SeasonPlanRevisionRequest = z.infer<typeof seasonPlanRevisionRequestSchema>;

/**
 * A creator's manual edit of a plan. `expectedVersion` makes the edit
 * optimistic: a concurrent regeneration makes the save fail instead of
 * silently overwriting newer work.
 */
export const seasonPlanUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().min(1),
  plan: seasonPlanSchema,
});
export type SeasonPlanUpdateRequest = z.infer<typeof seasonPlanUpdateRequestSchema>;

// ---------------------------------------------------------------------------
// JSON Schema for provider structured output
// ---------------------------------------------------------------------------

export const SEASON_PLAN_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "seasonObjective", "centralConflictOrMystery", "mainCharacterObjectives",
    "overallCharacterDevelopment", "majorStoryDevelopments",
    "beginningDirection", "middleDirection", "endingDirection",
    "episodeProgression", "importantRevelations", "relationshipChanges",
    "consequencesCarriedBetween", "setupAndPayoff", "unresolvedQuestions",
    "intendedSeasonConclusion",
  ],
  properties: {
    seasonObjective: { type: "string", minLength: 1, maxLength: 1200 },
    centralConflictOrMystery: { type: "string", minLength: 1, maxLength: 1000 },
    mainCharacterObjectives: { type: "string", minLength: 1, maxLength: 1000 },
    overallCharacterDevelopment: { type: "string", minLength: 1, maxLength: 1000 },
    majorStoryDevelopments: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 10 },
    beginningDirection: { type: "string", minLength: 1, maxLength: 800 },
    middleDirection: { type: "string", minLength: 1, maxLength: 800 },
    endingDirection: { type: "string", minLength: 1, maxLength: 800 },
    episodeProgression: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "episodeNumber", "workingTitle", "narrativePurpose", "startingSituation",
          "mainObjective", "centralConflict", "majorStoryBeats", "informationRevealed",
          "characterDevelopment", "importantEvents", "consequences", "storyContribution",
          "endingOrCliffhanger", "unresolvedThreads", "continuityRequirements",
          "characterArcChanges", "relationshipChanges", "objectChanges", "locationChanges",
        ],
        properties: {
          episodeNumber: { type: "number" },
          workingTitle: { type: "string", maxLength: 120 },
          narrativePurpose: { type: "string", maxLength: 600 },
          startingSituation: { type: "string", maxLength: 800 },
          mainObjective: { type: "string", maxLength: 600 },
          centralConflict: { type: "string", maxLength: 600 },
          majorStoryBeats: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 10 },
          informationRevealed: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 8 },
          characterDevelopment: { type: "string", maxLength: 800 },
          importantEvents: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 8 },
          consequences: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 8 },
          storyContribution: { type: "string", maxLength: 600 },
          endingOrCliffhanger: { type: "string", maxLength: 600 },
          unresolvedThreads: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 6 },
          continuityRequirements: { type: "string", maxLength: 600 },
          characterArcChanges: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "change"],
              properties: {
                name: { type: "string", maxLength: 80 },
                change: { type: "string", maxLength: 400 },
              },
            },
          },
          relationshipChanges: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["from", "to", "change"],
              properties: {
                from: { type: "string", maxLength: 80 },
                to: { type: "string", maxLength: 80 },
                change: { type: "string", maxLength: 300 },
              },
            },
          },
          objectChanges: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "ownership", "condition"],
              properties: {
                name: { type: "string", maxLength: 120 },
                ownership: { type: "string", maxLength: 200 },
                condition: { type: "string", maxLength: 300 },
              },
            },
          },
          locationChanges: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "change"],
              properties: {
                name: { type: "string", maxLength: 120 },
                change: { type: "string", maxLength: 300 },
              },
            },
          },
        },
      },
      maxItems: 24,
    },
    importantRevelations: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 8 },
    relationshipChanges: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 8 },
    consequencesCarriedBetween: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 8 },
    setupAndPayoff: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 6 },
    unresolvedQuestions: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 6 },
    intendedSeasonConclusion: { type: "string", minLength: 1, maxLength: 1000 },
  },
} as const;
