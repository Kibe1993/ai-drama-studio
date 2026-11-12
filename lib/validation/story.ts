import { z } from "zod";

export const dialogueLineSchema = z.object({
  characterName: z.string().trim().min(1).max(80),
  line: z.string().trim().min(1).max(500),
});

export const screenplaySceneSchema = z.object({
  sceneNumber: z.number().int().positive().max(20),
  heading: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(160),
  timeOfDay: z.string().trim().min(1).max(40),
  charactersPresent: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  visualDescription: z.string().trim().min(1).max(1200),
  action: z.string().trim().min(1).max(1200),
  dialogue: z.array(dialogueLineSchema).max(12),
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
  synopsis: z.string().trim().min(1).max(1200),
  structure: storyStructureSchema,
  screenplay: z.array(screenplaySceneSchema).min(1).max(8),
});

export const STORY_STATUSES = ["awaiting_approval", "approved", "failed"] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export type DialogueLine = z.infer<typeof dialogueLineSchema>;
export type ScreenplayScene = z.infer<typeof screenplaySceneSchema>;
export type StoryStructure = z.infer<typeof storyStructureSchema>;
export type GeneratedStory = z.infer<typeof generatedStorySchema>;

export type StoryRecord = GeneratedStory & {
  id: string;
  clerkUserId: string;
  projectId: string;
  productionRunId: string;
  status: StoryStatus;
  version: number;
  provider: string;
  model: string;
  fallbackFrom: string | null;
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
