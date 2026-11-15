import { JobError } from "@/lib/pipeline/types";
import { stageCompletionBudget, minimumScenesForDuration } from "@/lib/providers/llm/budget";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import type { ScreenplayScene } from "@/lib/validation/story";
import {
  EPISODE_SUGGESTION_RESPONSE_SCHEMA,
  episodeSuggestionSchema,
  type EpisodeSuggestion,
} from "@/lib/validation/episode";
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
  continuityContext?: string;
};

export type ScenePrompt = {
  title: string;
  screenplay: ScreenplayScene[];
  characterNames: string[];
  targetDurationSeconds: number;
  continuityContext?: string;
};

export type EpisodeSuggestionPrompt = {
  seriesTitle: string;
  targetDurationSeconds: number;
  episodeNumber: number;
  productionMode?: string;
  previousEpisodes?: { episodeNumber: number; title: string; premise: string }[];
  storyBible?: unknown;
  /** CASNA: The approved Season Plan for this series. */
  seasonPlan?: unknown | null;
  /** CASNA: The current Continuity Ledger from approved episodes. */
  continuityLedger?: unknown | null;
  /** CASNA: The episode-specific plan for this episode number. */
  episodePlan?: unknown | null;
};

// Re-exported so consumers can import all prompt types from one place.
export type { SeasonPlanPrompt } from "@/lib/providers/llm/seasonPlanTask";

export type StageTransport = {
  label: string;
  request(
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    signal: AbortSignal,
    maxCompletionTokens?: number
  ): Promise<{ text: string; usage?: TokenUsage; truncated?: boolean }>;
};

function signalOf(options: StoryCallOptions): AbortSignal {
  return options.signal ?? AbortSignal.timeout(300_000);
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
      "",
      "ALIASES AND IDENTITY:",
      "If a character appears under a different name (disguise, code name, phone voice, nickname),",
      "list that alternate name in their aliases array. Do NOT create a separate character for the alias.",
      "For example, if 'Phone Voice' is revealed to be Amara, create one character 'Amara' with",
      "alias { name: 'Phone Voice', type: 'phone_voice' } — do NOT create a second character named 'Phone Voice'.",
      "If a character uses a disguise or codename, record it the same way.",
      "Each alias must have a type: disguise, codename, phone_voice, nickname, or alias.",
      "",
      "RELATIONSHIPS:",
      "For each character, list their relationships with other characters in the story.",
      "Each relationship must have: characterName, type (ally, enemy, family, romantic, rival, mentor, colleague, unknown),",
      "and a brief description of the relationship dynamic.",
      "Only include relationships that are evident from the screenplay or story context.",
      "",
      "VOICE MANIFESTATIONS:",
      "If a character has distinct voice variations (e.g., disguised voice, phone voice, altered voice),",
      "list each in voiceManifestations with: name, description, and distinguishingFeatures.",
      "This is for voice direction only — the character is still one person, not multiple characters.",
      "",
      input.continuityContext ? `Approved prior-episode character canon. Keep these established traits consistent where names match; do not add details absent from this canon or screenplay:\n${input.continuityContext}` : "",
      "Approved screenplay:",
      JSON.stringify(input.screenplay),
    ].join("\n"),
  };
}

export function sceneInstructions(input: ScenePrompt): { system: string; prompt: string } {
  const totalScenes = input.screenplay.length;
  const avgDuration = totalScenes > 0
    ? Math.round(input.targetDurationSeconds / totalScenes)
    : input.targetDurationSeconds;
  return {
    system: "You turn an approved screenplay into production scenes. Return one JSON object and no other text.",
    prompt: [
      `Story title: ${input.title}`,
      `Target episode duration: ${input.targetDurationSeconds} seconds across ${totalScenes} scene${totalScenes === 1 ? "" : "s"} (average ~${avgDuration} s per scene).`,
      `Approved characters: ${input.characterNames.join(", ")}.`,
      "Keep the same scene numbers as the screenplay. Do not add, drop, merge, or renumber scenes.",
      "Do not change the story, add events, or add characters who are not in the approved character list.",
      "Copy the dialogue from the screenplay. Do not shorten or paraphrase it.",
      "title: a short descriptive title for the scene (not the episode title).",
      "interiorExterior is 'interior', 'exterior', or an empty string when the heading does not specify.",
      "cameraDirection: a brief note on camera angle or movement if the screenplay implies one, otherwise omit or use an empty string.",
      `estimatedDurationSeconds: estimate how many seconds this scene takes to perform based on its action and dialogue, proportioned to the ${input.targetDurationSeconds}s total. Must be a positive integer and not exceed 600.`,
      input.continuityContext ? `Approved prior-episode character and location canon. Preserve established appearance and location details where applicable:\n${input.continuityContext}` : "",
      "Approved screenplay:",
      JSON.stringify(input.screenplay),
    ].filter(Boolean).join("\n"),
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
    signalOf(options),
    stageCompletionBudget(input.screenplay.length)
  );
  const parsed = parseStructured(transport.label, response.text, characterSetSchema, "character list");
  const characters: CharacterProfile[] = parsed.characters.map((character) => ({
    name: character.name,
    role: character.role ?? "",
    ageRange: character.ageRange ?? "",
    gender: character.gender ?? "",
    personality: character.personality ?? "",
    physicalDescription: character.physicalDescription ?? "",
    clothing: character.clothing ?? "",
    distinguishingFeatures: character.distinguishingFeatures ?? "",
    background: character.background ?? "",
    relationships: (character.relationships ?? []).map((r) => ({
      characterName: r.characterName,
      type: r.type ?? "unknown",
      description: r.description ?? "",
    })),
    aliases: (character.aliases ?? []).map((a) => ({
      name: a.name,
      type: a.type ?? "alias",
      description: a.description ?? "",
    })),
    voiceManifestations: (character.voiceManifestations ?? []).map((v) => ({
      name: v.name,
      description: v.description ?? "",
      distinguishingFeatures: v.distinguishingFeatures ?? "",
    })),
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
    signalOf(options),
    stageCompletionBudget(input.screenplay.length)
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

export async function requestEpisodeSuggestion(
  transport: StageTransport,
  input: EpisodeSuggestionPrompt,
  options: StoryCallOptions = {}
): Promise<{ suggestion: EpisodeSuggestion; usage?: TokenUsage }> {
  const response = await transport.request(
    "You propose the next episode of an existing series. Return one JSON object and no other text.",
    [
      `Series title: ${input.seriesTitle}`,
      `Production type: ${input.productionMode ?? "standalone"}.`,
      `Target duration: ${input.targetDurationSeconds} seconds.`,
      `Propose episode number ${input.episodeNumber}.`,
      "title: at most 120 characters, specific to this episode, not the series title.",
      "premise: 2-6 sentences describing what happens in this episode, the central conflict, and the cliffhanger or resolution it ends on.",
      input.productionMode === "serialized"
        ? "The episode must advance the serialized plot and respect the established canon below. Do not resolve the whole series unless the bible says this is the finale."
        : "The episode must stand on its own while staying consistent with the reference below.",
      input.previousEpisodes?.length
        ? `Episodes already produced (do not repeat their plots; build on what happened):\n${JSON.stringify(input.previousEpisodes)}`
        : "",
      input.storyBible !== undefined ? `Series reference (immutable canon):\n${JSON.stringify(input.storyBible)}` : "",
      input.seasonPlan
        ? `Approved Season Plan (follow this plan; your episode should accomplish the purpose described for episode ${input.episodeNumber}):\n${JSON.stringify(input.seasonPlan)}`
        : "",
      input.episodePlan
        ? `Episode-specific plan for episode ${input.episodeNumber} (follow this plan closely):\n${JSON.stringify(input.episodePlan)}`
        : "",
      input.continuityLedger
        ? `Continuity Ledger (established events, character states, and unresolved threads from approved episodes — your episode must respect all of this):\n${JSON.stringify(input.continuityLedger)}`
        : "",
      input.seasonPlan || input.episodePlan
        ? "Do not contradict the approved Season Plan, the episode-specific plan, or the Continuity Ledger."
        : "",
    ].filter(Boolean).join("\n"),
    EPISODE_SUGGESTION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options)
  );
  const suggestion = parseStructured(transport.label, response.text, episodeSuggestionSchema, "episode suggestion");
  return { suggestion, usage: response.usage };
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function assertCharacters(screenplay: ScreenplayScene[], characters: CharacterProfile[]): void {
  const expected = new Set(screenplayCharacterNames(screenplay).map(normalize));
  const charNames = characters.map((character) => normalize(character.name));
  if (new Set(charNames).size !== charNames.length) {
    throw new JobError("The character list repeats a name.", "invalid_schema", false);
  }

  const charNameSet = new Set(charNames);
  const aliasToChar = new Map<string, string>();
  for (const character of characters) {
    for (const alias of character.aliases ?? []) {
      const aliasKey = normalize(alias.name);
      if (charNameSet.has(aliasKey)) {
        throw new JobError(`Alias "${alias.name}" duplicates a character name. Merge them into one character.`, "invalid_schema", false);
      }
      if (aliasToChar.has(aliasKey)) {
        throw new JobError(`Alias "${alias.name}" is shared by two characters. Only one character can own each alias.`, "invalid_schema", false);
      }
      aliasToChar.set(aliasKey, normalize(character.name));
    }
  }

  const allKnownNames = new Set([...charNames, ...aliasToChar.keys()]);
  for (const name of expected) {
    if (!allKnownNames.has(name)) {
      throw new JobError("The character list omitted someone from the screenplay.", "invalid_schema", false);
    }
  }
  for (const name of charNames) {
    if (!expected.has(name)) {
      throw new JobError("The character list added someone who is not in the screenplay.", "invalid_schema", false);
    }
  }
  for (const [aliasKey] of aliasToChar) {
    if (!expected.has(aliasKey)) {
      throw new JobError("An alias references a name that is not in the screenplay.", "invalid_schema", false);
    }
  }
}

/**
 * Reject a screenplay that is too short for its requested duration.
 *
 * A single scene is a valid shape for a sub-minute episode, but for anything
 * longer it means the generation was truncated or the model stopped early.
 * Throwing a failover-eligible error keeps a partial screenplay from being
 * saved and marked complete.
 */
export function assertScreenplayPacing(targetDurationSeconds: number, screenplay: ScreenplayScene[]): void {
  const minimum = minimumScenesForDuration(targetDurationSeconds);
  if (screenplay.length >= minimum) return;
  throw new JobError(
    `The screenplay has ${screenplay.length} scene${screenplay.length === 1 ? "" : "s"} but a ${targetDurationSeconds}-second episode needs at least ${minimum}. The generation is incomplete.`,
    "invalid_schema",
    false
  );
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
  // Warn (non-fatal) if estimated durations are wildly over the target.
  // We do not reject here because providers often omit estimatedDurationSeconds
  // and it defaults to null; total 0 is fine.
  const total = scenes.reduce((sum, scene) => sum + (scene.estimatedDurationSeconds ?? 0), 0);
  if (total > 0 && total > input.targetDurationSeconds * 2.5) {
    throw new JobError(
      `The estimated scene durations total ${total}s but the episode target is ${input.targetDurationSeconds}s. Scale the estimates to match the episode.`,
      "invalid_schema",
      false
    );
  }
}
