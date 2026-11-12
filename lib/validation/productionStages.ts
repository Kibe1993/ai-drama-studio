import { z } from "zod";
import { dialogueLineSchema, type ScreenplayScene } from "@/lib/validation/story";

const blank = z.string().trim().max(800).optional().default("");

export const characterProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(200).optional().default(""),
  ageRange: z.string().trim().max(40).optional().default(""),
  gender: z.string().trim().max(40).optional().default(""),
  personality: blank,
  physicalDescription: blank,
  clothing: z.string().trim().max(400).optional().default(""),
  distinguishingFeatures: z.string().trim().max(400).optional().default(""),
  background: blank,
});

export const characterSetSchema = z.object({
  characters: z.array(characterProfileSchema).min(1).max(12),
});

export const productionSceneSchema = z.object({
  sceneNumber: z.number().int().positive().max(20),
  title: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(160),
  interiorExterior: z.enum(["interior", "exterior", ""]).optional().default(""),
  timeOfDay: z.string().trim().min(1).max(40),
  charactersPresent: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  visualDescription: z.string().trim().min(1).max(1200),
  action: z.string().trim().min(1).max(1200),
  dialogue: z.array(dialogueLineSchema).max(12),
  cameraDirection: z.string().trim().max(400).optional().default(""),
  estimatedDurationSeconds: z.number().int().positive().max(180).nullable().optional().default(null),
});

export const sceneBreakdownSchema = z.object({
  scenes: z.array(productionSceneSchema).min(1).max(8),
});

export type CharacterProfile = z.infer<typeof characterProfileSchema>;
export type ProductionScene = z.infer<typeof productionSceneSchema>;

export const CHARACTER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["characters"],
  properties: {
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          ageRange: { type: "string" },
          gender: { type: "string" },
          personality: { type: "string" },
          physicalDescription: { type: "string" },
          clothing: { type: "string" },
          distinguishingFeatures: { type: "string" },
          background: { type: "string" },
        },
      },
    },
  },
} as const;

export const SCENE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sceneNumber",
          "title",
          "location",
          "timeOfDay",
          "charactersPresent",
          "visualDescription",
          "action",
          "dialogue",
        ],
        properties: {
          sceneNumber: { type: "integer" },
          title: { type: "string" },
          location: { type: "string" },
          interiorExterior: { type: "string", enum: ["interior", "exterior", ""] },
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
          cameraDirection: { type: "string" },
          estimatedDurationSeconds: { type: "integer" },
        },
      },
    },
  },
} as const;

export function screenplayCharacterNames(screenplay: ScreenplayScene[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const scene of screenplay) {
    for (const name of [...scene.charactersPresent, ...scene.dialogue.map((line) => line.characterName)]) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name.trim());
    }
  }
  return names;
}
