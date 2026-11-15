import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const list = (maxItems: number, maxLen: number) => z.array(text(maxLen)).max(maxItems);

export const storyDiagnosisSchema = z.object({
  strengths: list(10, 500),
  weaknesses: list(10, 500),
  structuralIssues: list(8, 500),
  characterIssues: list(8, 500),
  thematicIssues: list(8, 500),
  recommendations: list(12, 600),
  overallAssessment: text(1200),
  readinessScore: z.number().int().min(0).max(100),
});

export const centralConflictSchema = z.object({
  description: text(1000),
  type: z.enum([
    "man_vs_man",
    "man_vs_nature",
    "man_vs_society",
    "man_vs_self",
    "man_vs_technology",
    "man_vs_supernatural",
    "man_vs_fate",
  ]).default("man_vs_man"),
  stakes: text(600),
  escalationPath: text(800),
});

export const characterArcSchema = z.object({
  characterName: text(80),
  arcType: z.enum([
    "transformation",
    "growth",
    "fall",
    "flat",
    "redemption",
    "tragic",
  ]).default("flat"),
  startState: text(400),
  endState: text(400),
  keyTurningPoints: list(6, 400),
});

export const plotStructureSchema = z.object({
  structure: z.enum([
    "three_act",
    "five_act",
    "hero_journey",
    "episodic",
    "serialized",
    "hybrid",
  ]).default("serialized"),
  setup: text(800),
  incitingIncident: text(600),
  risingAction: text(800),
  climax: text(600),
  resolution: text(600),
});

export const thematicFrameworkSchema = z.object({
  primaryTheme: text(400),
  secondaryThemes: list(6, 300),
  recurringMotifs: list(8, 300),
  symbolism: list(8, 300),
});

export const episodeBlueprintSchema = z.object({
  structure: z.enum(["procedural", "serialized", "hybrid"]).default("serialized"),
  totalEpisodes: z.number().int().min(1).max(52),
  arcAdvancingEpisodes: z.array(z.number().int().positive().max(52)).max(52).default([]),
  standaloneEpisodes: z.array(z.number().int().positive().max(52)).max(52).default([]),
  cliffhangerStrategy: optionalText(600),
});

export const pacingStrategySchema = z.object({
  description: text(800),
  tensionCurve: text(600),
  keySetPieces: list(8, 400),
});

export const storyArchitectureSchema = z.object({
  centralConflict: centralConflictSchema,
  characterArcs: z.array(characterArcSchema).min(1).max(16),
  plotStructure: plotStructureSchema,
  thematicFramework: thematicFrameworkSchema,
  episodeBlueprint: episodeBlueprintSchema,
  pacingStrategy: pacingStrategySchema,
});

export const STORY_DIAGNOSIS_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["strengths", "weaknesses", "structuralIssues", "characterIssues", "thematicIssues", "recommendations", "overallAssessment", "readinessScore"],
  properties: {
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    structuralIssues: { type: "array", items: { type: "string" } },
    characterIssues: { type: "array", items: { type: "string" } },
    thematicIssues: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    overallAssessment: { type: "string" },
    readinessScore: { type: "integer" },
  },
} as const;

export const STORY_ARCHITECTURE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["centralConflict", "characterArcs", "plotStructure", "thematicFramework", "episodeBlueprint", "pacingStrategy"],
  properties: {
    centralConflict: {
      type: "object",
      additionalProperties: false,
      required: ["description", "stakes", "escalationPath"],
      properties: {
        description: { type: "string" },
        type: { type: "string", enum: ["man_vs_man", "man_vs_nature", "man_vs_society", "man_vs_self", "man_vs_technology", "man_vs_supernatural", "man_vs_fate"] },
        stakes: { type: "string" },
        escalationPath: { type: "string" },
      },
    },
    characterArcs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["characterName", "startState", "endState"],
        properties: {
          characterName: { type: "string" },
          arcType: { type: "string", enum: ["transformation", "growth", "fall", "flat", "redemption", "tragic"] },
          startState: { type: "string" },
          endState: { type: "string" },
          keyTurningPoints: { type: "array", items: { type: "string" } },
        },
      },
    },
    plotStructure: {
      type: "object",
      additionalProperties: false,
      required: ["setup", "incitingIncident", "risingAction", "climax", "resolution"],
      properties: {
        structure: { type: "string", enum: ["three_act", "five_act", "hero_journey", "episodic", "serialized", "hybrid"] },
        setup: { type: "string" },
        incitingIncident: { type: "string" },
        risingAction: { type: "string" },
        climax: { type: "string" },
        resolution: { type: "string" },
      },
    },
    thematicFramework: {
      type: "object",
      additionalProperties: false,
      required: ["primaryTheme"],
      properties: {
        primaryTheme: { type: "string" },
        secondaryThemes: { type: "array", items: { type: "string" } },
        recurringMotifs: { type: "array", items: { type: "string" } },
        symbolism: { type: "array", items: { type: "string" } },
      },
    },
    episodeBlueprint: {
      type: "object",
      additionalProperties: false,
      required: ["totalEpisodes"],
      properties: {
        structure: { type: "string", enum: ["procedural", "serialized", "hybrid"] },
        totalEpisodes: { type: "integer" },
        arcAdvancingEpisodes: { type: "array", items: { type: "integer" } },
        standaloneEpisodes: { type: "array", items: { type: "integer" } },
        cliffhangerStrategy: { type: "string" },
      },
    },
    pacingStrategy: {
      type: "object",
      additionalProperties: false,
      required: ["description", "tensionCurve"],
      properties: {
        description: { type: "string" },
        tensionCurve: { type: "string" },
        keySetPieces: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export type StoryDiagnosis = z.infer<typeof storyDiagnosisSchema>;
export type StoryArchitecture = z.infer<typeof storyArchitectureSchema>;
export type CentralConflict = z.infer<typeof centralConflictSchema>;
export type CharacterArc = z.infer<typeof characterArcSchema>;
export type PlotStructure = z.infer<typeof plotStructureSchema>;
export type ThematicFramework = z.infer<typeof thematicFrameworkSchema>;
export type EpisodeBlueprint = z.infer<typeof episodeBlueprintSchema>;
export type PacingStrategy = z.infer<typeof pacingStrategySchema>;