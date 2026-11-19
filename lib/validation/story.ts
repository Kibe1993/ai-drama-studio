import { z } from "zod";
import type {
  EpisodeCanonSummary,
  EpisodePlan,
  EpisodeValidation,
} from "@/lib/validation/casna";
import type { StoryContract } from "@/lib/validation/storyContract";
import type { CanonSuggestion } from "@/lib/validation/canonExtraction";

export const dialogueLineSchema = z.object({
  characterName: z.string().trim().min(1).max(80),
  line: z.string().trim().min(1).max(500),
});

export const screenplaySceneSchema = z.object({
  sceneNumber: z.number().int().positive().max(50),
  heading: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(160),
  timeOfDay: z.string().trim().min(1).max(40),
  charactersPresent: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  visualDescription: z.string().trim().min(1).max(2000),
  action: z.string().trim().min(1).max(2000),
  dialogue: z.array(dialogueLineSchema).max(20),
});

export const storyStructureSchema = z.object({
  act1: z.object({
    introduction: z.string().trim().min(1).max(800),
    mainCharacters: z.string().trim().min(1).max(800),
    setting: z.string().trim().min(1).max(800),
    initialSituation: z.string().trim().min(1).max(800),
    incitingIncident: z.string().trim().min(1).max(800),
  }),
  act2: z.object({
    risingTension: z.string().trim().min(1).max(800),
    obstacles: z.string().trim().min(1).max(800),
    characterDecisions: z.string().trim().min(1).max(800),
    turningPoint: z.string().trim().min(1).max(800),
  }),
  act3: z.object({
    climax: z.string().trim().min(1).max(800),
    resolution: z.string().trim().min(1).max(800),
    finalOutcome: z.string().trim().min(1).max(800),
  }),
});

export const generatedStorySchema = z.object({
  title: z.string().trim().min(1).max(120),
  synopsis: z.string().trim().min(1).max(2000),
  structure: storyStructureSchema,
  screenplay: z.array(screenplaySceneSchema).min(1).max(40),
});

export const STORY_STATUSES = ["awaiting_approval", "approved", "failed"] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

/**
 * Input for the run-less `story.draft` job that develops the project-level
 * story draft of the guided workflow.
 */
export const storyDraftGenerationJobInputSchema = z.object({
  operation: z.enum(["generate", "revise", "regenerate", "targeted_revision"]),
  instruction: z.string().trim().max(2000).default(""),
  creativeDirection: z.string().trim().max(2000).default(""),
  targetFindingId: z.string().trim().max(40).optional(),
  /** Bible version pinned at job creation so the worker loads the exact snapshot. */
  sourceBibleVersion: z.number().int().positive().optional(),
});
export type StoryDraftGenerationJobInput = z.infer<typeof storyDraftGenerationJobInputSchema>;

export const storyDraftRequestSchema = z.object({
  operation: z.enum(["generate", "revise", "regenerate", "targeted_revision"]).default("generate"),
  instruction: z.string().trim().max(2000).optional(),
  creativeDirection: z.string().trim().max(2000).optional(),
  targetFindingId: z.string().trim().max(40).optional(),
});
export type StoryDraftRequest = z.infer<typeof storyDraftRequestSchema>;

export type DialogueLine = z.infer<typeof dialogueLineSchema>;
export type ScreenplayScene = z.infer<typeof screenplaySceneSchema>;
export type StoryStructure = z.infer<typeof storyStructureSchema>;
export type GeneratedStory = z.infer<typeof generatedStorySchema>;

/**
 * A creator's manual revision of an episode screenplay. The screenplay is
 * revalidated against canon before it is saved, exactly like generated content.
 */
export const screenplayEditSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  synopsis: z.string().trim().min(1).max(2000).optional(),
  screenplay: z.array(screenplaySceneSchema).min(1).max(40),
  /** Optimistic guard: rejects an edit made against an older story revision. */
  expectedUpdatedAt: z.string().trim().min(1).max(40).optional(),
});
export type ScreenplayEdit = z.infer<typeof screenplayEditSchema>;

export const findingResolutionRequestSchema = z.object({
  findingId: z.string().trim().min(1).max(40),
  status: z.enum([
    "open",
    "revision_requested",
    "resolved",
    "accepted_as_intentional",
    "recheck_required",
  ]),
  note: z.string().trim().max(1000).optional(),
});
export type FindingResolutionRequest = z.infer<typeof findingResolutionRequestSchema>;

export type SceneRepairRecord = {
  attempt: number;
  sceneNumbers: number[];
  findingsBefore: number;
  findingsAfter: number;
  resolved: boolean;
  provider?: string;
  model?: string;
};

export type StoryRecord = GeneratedStory & {
  id: string;
  clerkUserId: string;
  projectId: string;
  /** `null` for the project-level story draft; the run id for an episode screenplay. */
  productionRunId: string | null;
  episodeId?: string | null;
  status: StoryStatus;
  version: number;
  provider: string;
  model: string;
  fallbackFrom: string | null;
  /** CASNA Stage F: the episode-specific plan this screenplay was written from. */
  plan?: EpisodePlan | null;
  /** CASNA Stage H: structured validation findings for the screenplay. */
  validationFindings?: EpisodeValidation | null;
  /** CASNA Stage I: authoritative canon extracted when the episode is approved. */
  canonSummary?: EpisodeCanonSummary | null;
  /** M5: advisory canon suggestions extracted post-hoc from the screenplay. */
  canonSuggestions?: CanonSuggestion | null;
  /** CASNA Stage H: bounded targeted-repair attempts and their outcomes. */
  repairHistory?: SceneRepairRecord[];
  /** Canon version this screenplay was validated against. */
  sourceCanonVersion?: number | null;
  /** Bible version this draft was generated from. */
  sourceBibleVersion?: number | null;
  /** SHA-256 fingerprint (16 chars) of the prompt digest for cross-run comparison. */
  promptFingerprint?: string | null;
  /** Provisional narrative claims for this draft revision. Not a second canon store. */
  storyContract?: StoryContract | null;
  canonStale?: boolean;
  canonStaleReason?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * JSON Schema sent to Gemini structured output. Kept beside the Zod schema
 * so a model response is checked twice: once by the provider, then by Zod.
 */
export const STORY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "synopsis", "structure", "screenplay"],
  properties: {
    title: { type: "string" },
    synopsis: { type: "string" },
    structure: {
      type: "object",
      additionalProperties: false,
      required: ["act1", "act2", "act3"],
      properties: {
        act1: {
          type: "object",
          additionalProperties: false,
          required: ["introduction", "mainCharacters", "setting", "initialSituation", "incitingIncident"],
          properties: {
            introduction: { type: "string" },
            mainCharacters: { type: "string" },
            setting: { type: "string" },
            initialSituation: { type: "string" },
            incitingIncident: { type: "string" },
          },
        },
        act2: {
          type: "object",
          additionalProperties: false,
          required: ["risingTension", "obstacles", "characterDecisions", "turningPoint"],
          properties: {
            risingTension: { type: "string" },
            obstacles: { type: "string" },
            characterDecisions: { type: "string" },
            turningPoint: { type: "string" },
          },
        },
        act3: {
          type: "object",
          additionalProperties: false,
          required: ["climax", "resolution", "finalOutcome"],
          properties: {
            climax: { type: "string" },
            resolution: { type: "string" },
            finalOutcome: { type: "string" },
          },
        },
      },
    },
    screenplay: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sceneNumber",
          "heading",
          "location",
          "timeOfDay",
          "charactersPresent",
          "visualDescription",
          "action",
          "dialogue",
        ],
        properties: {
          sceneNumber: { type: "integer" },
          heading: { type: "string" },
          location: { type: "string" },
          timeOfDay: { type: "string" },
          charactersPresent: { type: "array", items: { type: "string" } },
          visualDescription: { type: "string" },
          action: { type: "string" },
          dialogue: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["characterName", "line"],
              properties: {
                characterName: { type: "string" },
                line: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;
