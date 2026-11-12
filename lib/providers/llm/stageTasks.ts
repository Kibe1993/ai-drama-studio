import { JobError } from "@/lib/pipeline/types";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import type { ScreenplayScene } from "@/lib/validation/story";
import {
  CHARACTER_RESPONSE_SCHEMA,
  characterSetSchema,
  SCENE_RESPONSE_SCHEMA,
  sceneBreakdownSchema,
  screenplayCharacterNames,
  type CharacterProfile,
  type ProductionScene,
} from "@/lib/validation/productionStages";

export type CharacterPrompt = {
  title: string;
  screenplay: ScreenplayScene[];
};

export type ScenePrompt = {
  title: string;
  screenplay: ScreenplayScene[];
  characterNames: string[];
  targetDurationSeconds: number;
};

export type StageTransport = {
  label: string;
  request(
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<{ text: string; usage?: TokenUsage }>;
};

function signalOf(options: StoryCallOptions): AbortSignal {
  return options.signal ?? AbortSignal.timeout(90_000);
}

export function characterInstructions(input: CharacterPrompt): { system: string; prompt: string } {
  const names = screenplayCharacterNames(input.screenplay);
  return {
    system: "You extract characters from an approved screenplay. Return one JSON object and no other text.",
    prompt: [
      `Story title: ${input.title}`,
      "Use only people who appear in charactersPresent or who speak.",
      `Those names are: ${names.join(", ") || "none"}.`,
      "Do not add a narrator, extra, or anyone who is not in that list.",
      "Do not omit anyone from that list.",
      "If age, gender, appearance, clothing, personality, or background is not stated, use an empty string.",
      "Do not invent those details.",
      "Approved screenplay:",
      JSON.stringify(input.screenplay),
    ].join("\n"),
  };
}

export function sceneInstructions(input: ScenePrompt): { system: string; prompt: string } {
  return {
    system: "You turn an approved screenplay into production scenes. Return one JSON object and no other text.",
    prompt: [
      `Story title: ${input.title}`,
      `Target duration: ${input.targetDurationSeconds} seconds.`,
      `Approved characters: ${input.characterNames.join(", ")}.`,
      "Keep the same scene numbers as the screenplay. Do not add, drop, merge, or renumber scenes.",
      "Do not change the story, add events, or add characters.",
      "Copy the dialogue from the screenplay.",
      "interiorExterior is interior, exterior, or an empty string when the heading does not say.",
      "cameraDirection and estimatedDurationSeconds may be omitted when the screenplay does not state them.",
      "Approved screenplay:",
      JSON.stringify(input.screenplay),
    ].join("\n"),
  };
}

export async function requestCharacters(
  transport: StageTransport,
  input: CharacterPrompt,
  options: StoryCallOptions = {}
): Promise<{ characters: CharacterProfile[]; usage?: TokenUsage }> {
  const instructions = characterInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    CHARACTER_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options)
  );
  const parsed = parseStructured(transport.label, response.text, characterSetSchema, "character list");
  const characters = parsed.characters.map((character) => ({
    name: character.name,
    role: character.role ?? "",
    ageRange: character.ageRange ?? "",
    gender: character.gender ?? "",
    personality: character.personality ?? "",
    physicalDescription: character.physicalDescription ?? "",
    clothing: character.clothing ?? "",
    distinguishingFeatures: character.distinguishingFeatures ?? "",
    background: character.background ?? "",
  }));
  assertCharacters(input.screenplay, characters);
  return { characters, usage: response.usage };
}

export async function requestScenes(
  transport: StageTransport,
  input: ScenePrompt,
  options: StoryCallOptions = {}
): Promise<{ scenes: ProductionScene[]; usage?: TokenUsage }> {
  const instructions = sceneInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    SCENE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options)
  );
  const parsed = parseStructured(transport.label, response.text, sceneBreakdownSchema, "scene breakdown");
  const scenes = parsed.scenes.map((scene) => ({
    ...scene,
    interiorExterior: scene.interiorExterior ?? "",
    cameraDirection: scene.cameraDirection ?? "",
    estimatedDurationSeconds: scene.estimatedDurationSeconds ?? null,
  }));
  assertScenes(input, scenes);
  return { scenes, usage: response.usage };
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function assertCharacters(screenplay: ScreenplayScene[], characters: CharacterProfile[]): void {
  const expected = new Set(screenplayCharacterNames(screenplay).map(normalize));
  const got = characters.map((character) => normalize(character.name));
  if (new Set(got).size !== got.length) {
    throw new JobError("The character list repeats a name.", "invalid_schema", false);
  }
  for (const name of expected) {
    if (!got.includes(name)) {
      throw new JobError("The character list omitted someone from the screenplay.", "invalid_schema", false);
    }
  }
  for (const name of got) {
    if (!expected.has(name)) {
      throw new JobError("The character list added someone who is not in the screenplay.", "invalid_schema", false);
    }
  }
}

export function assertScenes(input: ScenePrompt, scenes: ProductionScene[]): void {
  const expected = input.screenplay.map((scene) => scene.sceneNumber).sort((a, b) => a - b);
  const got = scenes.map((scene) => scene.sceneNumber);
  if (new Set(got).size !== got.length) {
    throw new JobError("The scene breakdown repeats a scene number.", "invalid_schema", false);
  }
  const sorted = [...got].sort((a, b) => a - b);
  if (expected.join(",") !== sorted.join(",")) {
    throw new JobError("The scene breakdown does not keep the approved scene numbers.", "invalid_schema", false);
  }
  const allowed = new Set(input.characterNames.map(normalize));
  for (const scene of scenes) {
    for (const name of scene.charactersPresent) {
      if (!allowed.has(normalize(name))) {
        throw new JobError("A scene includes a character who was not approved.", "invalid_schema", false);
      }
    }
  }
}
