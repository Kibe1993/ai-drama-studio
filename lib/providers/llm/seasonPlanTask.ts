import { parseStructured } from "@/lib/providers/llm/parse";
import {
  normalizeSeasonArchitecture,
  normalizeEpisodeDetailBatch,
  normalizeSeasonPlan,
} from "@/lib/providers/llm/normalizeSeasonPlan";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import {
  SEASON_PLAN_RESPONSE_SCHEMA,
  seasonPlanSchema,
  type SeasonPlan,
  SEASON_ARCHITECTURE_RESPONSE_SCHEMA,
  seasonArchitectureSchema,
  type SeasonArchitecture,
  EPISODE_DETAIL_BATCH_RESPONSE_SCHEMA,
  episodeDetailBatchSchema,
  type EpisodeDetailBatch,
  type EpisodeOutline,
} from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";

export type SeasonPlanPrompt = {
  seriesTitle: string;
  /** The approved Story Bible brief (compact projection). */
  storyBible: unknown;
  /** The approved story draft foundation text. */
  storyFoundation: string;
  /** Creator's creative direction and tone. */
  creativeDirection: string;
  tone: string;
  genre: string;
  language: string;
  productionMode: string;
  /** Requested number of episodes. */
  episodeCount: number;
  /** Previous episodes (if regenerating or extending). */
  previousEpisodes?: { episodeNumber: number; title: string; premise: string }[];
  /** Continuity ledger brief for existing episodes. */
  continuityContext?: string;
  /** Operation: generate, revise, or regenerate. */
  operation: "generate" | "revise" | "regenerate";
  /** Natural-language revision instruction. */
  instruction?: string;
  /** Revise only this episode's section, keeping the rest of the plan. */
  targetEpisodeNumber?: number;
  /** The plan being revised, so unchanged parts can be preserved. */
  previousPlan?: unknown;
};

export type SeasonPlanTaskTransport = {
  label: string;
  request(
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    signal: AbortSignal,
    maxOutputTokens?: number
  ): Promise<{ text: string; usage?: TokenUsage; truncated?: boolean }>;
};

function signalOf(options: StoryCallOptions): AbortSignal {
  return options.signal ?? AbortSignal.timeout(300_000);
}

export function seasonPlanInstructions(input: SeasonPlanPrompt): { system: string; prompt: string } {
  const common = [
    "You are a narrative architect developing a complete season plan for a serialized drama.",
    "Do not write individual episode screenplays. Write a structured plan that describes how the entire season develops.",
    "Every episode must belong to the same overall story, have a distinct narrative purpose, build upon established events, and create consequences that affect subsequent episodes.",
    "Do not repeat the same conflict, countdown, discovery, decision, or cliffhanger across episodes without meaningful development.",
    "Each episode must advance the story, develop characters, introduce meaningful developments, and produce consequences.",
    "Respect the approved Story Bible as immutable canon. Do not contradict established facts, character motivations, world rules, or relationships.",
    "Be creative within the approved story direction. Do not change the direction itself.",
    "Return only the JSON object described by the schema. No markdown, no commentary.",
  ];

  const modeText = input.operation === "generate"
    ? "Create a complete first season plan from the approved foundation."
    : input.operation === "regenerate"
      ? "Regenerate the complete plan. Preserve the creator's explicit instructions and established canon, but develop a fresh plan."
      : "Revise the plan according to the creator's instruction. Keep everything they did not ask to change.";

  const targetText = input.targetEpisodeNumber
    ? `Revise ONLY episode ${input.targetEpisodeNumber}. Keep every other episode and every season-level field exactly as they are in the current plan.`
    : "";

  const prompt = [
    `Series title: ${input.seriesTitle}`,
    `Genre: ${input.genre}`,
    `Language: ${input.language}`,
    `Tone: ${input.tone}`,
    `Production mode: ${input.productionMode}`,
    `Requested episode count: ${input.episodeCount}`,
    input.creativeDirection ? `Creator's creative direction: ${input.creativeDirection}` : "",
    input.instruction ? `Creator's requested change: ${input.instruction}` : "",
    `Approved story foundation:\n${input.storyFoundation}`,
    `Approved Story Bible (immutable canon):\n${JSON.stringify(input.storyBible)}`,
    input.previousPlan
      ? `Current plan (keep every part the instruction does not change):\n${JSON.stringify(input.previousPlan)}`
      : "",
    input.previousEpisodes?.length
      ? `Episodes already produced (the plan must account for them):\n${JSON.stringify(input.previousEpisodes)}`
      : "",
    input.continuityContext
      ? `Continuity ledger (established events and states from approved episodes):\n${input.continuityContext}`
      : "",
    "",
    `Mode: ${modeText}`,
    targetText,
    "",
    "Provide exactly the following top-level fields in the JSON object:",
    "String fields (must be a single string, not an array):",
    "- seasonObjective (string, max 1200 chars: the overarching goal of this season)",
    "- centralConflictOrMystery (string, max 1000 chars: the main conflict or mystery driving the season)",
    "- mainCharacterObjectives (string, max 1000 chars: what the main characters aim to achieve)",
    "- overallCharacterDevelopment (string, max 1000 chars: how characters develop across the season)",
    "- beginningDirection (string, max 800 chars: narrative direction for the beginning)",
    "- middleDirection (string, max 800 chars: narrative direction for the middle)",
    "- endingDirection (string, max 800 chars: narrative direction for the ending)",
    "- intendedSeasonConclusion (string, max 1000 chars: how the season concludes)",
    "Array of strings fields (must be an array of strings, not a single string):",
    "- majorStoryDevelopments (3 to 10 strings, each max 500 chars: key story developments)",
    "- importantRevelations (2 to 8 strings, each max 500 chars: major revelations)",
    "- relationshipChanges (2 to 8 strings, each max 500 chars: key relationship changes)",
    "- consequencesCarriedBetween (2 to 8 strings, each max 500 chars: consequences that carry between episodes)",
    "- setupAndPayoff (2 to 6 strings, each max 500 chars: setups and their payoffs)",
    "- unresolvedQuestions (2 to 6 strings, each max 500 chars: questions left open for future seasons)",
    "Array of objects field:",
    `- episodeProgression (1 to 24 episode objects, one per requested episode (${input.episodeCount} requested))`,
    "",
    "For every episode in episodeProgression, provide all fields with the correct type:",
    "String fields (must be a single string, not an array):",
    "- episodeNumber (integer, sequential, starting at 1)",
    "- workingTitle (string, max 120 chars: specific to this episode, not the series title)",
    "- narrativePurpose (string, max 600 chars: what this episode accomplishes in the season)",
    "- startingSituation (string, max 800 chars: what the episode inherits from previous episodes)",
    "- mainObjective (string, max 600 chars: what the protagonist(s) aim to do)",
    "- centralConflict (string, max 600 chars: the specific conflict of this episode)",
    "- characterDevelopment (string, max 800 chars: a narrative summary of how characters change — NOT an array)",
    "- storyContribution (string, max 600 chars: how this episode advances the season)",
    "- endingOrCliffhanger (string, max 600 chars: how the episode ends)",
    "- continuityRequirements (string, max 600 chars: what the next episode must respect)",
    "Array of strings fields (must be an array of strings, not a single string):",
    "- majorStoryBeats (1 to 10 strings, each max 400 chars: key dramatic moments)",
    "- informationRevealed (1 to 8 strings, each max 400 chars: what the audience/characters learn)",
    "- importantEvents (1 to 8 strings, each max 400 chars: what happens)",
    "- consequences (1 to 8 strings, each max 400 chars: what carries forward)",
    "- unresolvedThreads (1 to 6 strings, each max 400 chars: questions left open)",
    "Array of objects fields (use empty arrays when an episode has no change of that kind):",
    "- characterArcChanges (0 to 8 objects, each {name: string max 80, change: string max 400})",
    "- relationshipChanges (0 to 6 objects, each {from: string max 80, to: string max 80, change: string max 300})",
    "- objectChanges (0 to 6 objects, each {name: string max 120, ownership: string max 200, condition: string max 300})",
    "- locationChanges (0 to 6 objects, each {name: string max 120, change: string max 300})",
    "",
    "Required output contract:",
    `Return exactly the JSON shape described by the schema. Every key must be present. Replace every placeholder with real content. Every array item and every required text field must be non-empty.`,
  ].filter(Boolean).join("\n");

  return { system: common.join(" "), prompt };
}

export async function requestSeasonPlan(
  transport: SeasonPlanTaskTransport,
  input: SeasonPlanPrompt,
  options: StoryCallOptions = {}
): Promise<{ plan: SeasonPlan; usage?: TokenUsage }> {
  const instructions = seasonPlanInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    SEASON_PLAN_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options),
    seasonPlanOutputBudget(input.episodeCount, Boolean(input.targetEpisodeNumber))
  );
  const parsed = parseStructured(transport.label, response.text, seasonPlanSchema, "season plan", normalizeSeasonPlan, response.truncated);
  return { plan: parsed as SeasonPlan, usage: response.usage };
}

function seasonPlanOutputBudget(episodeCount: number, targeted: boolean): number {
  if (targeted) return Math.min(16_000, Math.max(8_000, episodeCount * 400 + 2_000));
  return Math.min(48_000, Math.max(12_000, episodeCount * 800 + 4_000));
}

/**
 * Build a compact reference from a Story Bible content for the season plan prompt.
 */
export function seasonPlanBibleReference(bible: StoryBibleContent): unknown {
  return {
    identity: {
      title: bible.identity.title,
      centralPremise: bible.identity.centralPremise,
      centralConflict: bible.identity.centralConflict,
      narrativeConcept: bible.identity.narrativeConcept,
      toneAndAtmosphere: bible.identity.toneAndAtmosphere,
    },
    world: {
      description: bible.world.description.slice(0, 600),
      rules: bible.world.rules.slice(0, 6),
    },
    characters: bible.characters.characters.slice(0, 6).map((c) => ({
      name: c.name,
      storyRole: c.storyRole,
      motivations: c.motivations.slice(0, 3),
      fearsAndWeaknesses: c.fearsAndWeaknesses.slice(0, 2),
      developmentPotential: c.developmentPotential.slice(0, 300),
    })),
    narrative: {
      mainStoryline: bible.narrative.mainStoryline.slice(0, 800),
      majorConflicts: bible.narrative.majorConflicts.slice(0, 4),
      longTermDirection: bible.narrative.longTermDirection.slice(0, 600),
      unresolvedMysteries: bible.narrative.unresolvedMysteries.slice(0, 4),
      serializedEndingGuidance: bible.narrative.serializedEndingGuidance.slice(0, 300),
    },
    guidelines: {
      mainThemes: bible.guidelines.mainThemes.slice(0, 4),
      mustRemainConsistent: bible.guidelines.mustRemainConsistent.slice(0, 6),
    },
    canon: {
      confirmedFacts: bible.canon.confirmedFacts.slice(0, 8),
      unresolvedQuestions: bible.canon.unresolvedQuestions.slice(0, 4),
    },
  };
}
// ---------------------------------------------------------------------------
// Two-stage generation: Stage A (architecture) + Stage B (episode details)
// ---------------------------------------------------------------------------

export type SeasonArchitecturePrompt = {
  seriesTitle: string;
  storyBible: unknown;
  storyFoundation: string;
  creativeDirection: string;
  tone: string;
  genre: string;
  language: string;
  productionMode: string;
  episodeCount: number;
  previousEpisodes?: { episodeNumber: number; title: string; premise: string }[];
  continuityContext?: string;
  operation: "generate" | "revise" | "regenerate";
  instruction?: string;
};

export type EpisodeDetailBatchPrompt = {
  seriesTitle: string;
  storyBible: unknown;
  genre: string;
  language: string;
  tone: string;
  productionMode: string;
  architecture: SeasonArchitecture;
  outlines: EpisodeOutline[];
  previousEpisodes?: { episodeNumber: number; title: string; premise: string }[];
  continuityContext?: string;
};

function architectureOutputBudget(episodeCount: number): number {
  return Math.min(16_000, Math.max(8_000, episodeCount * 400 + 3_000));
}

function episodeDetailBatchBudget(episodeCount: number): number {
  return Math.min(24_000, Math.max(8_000, episodeCount * 1_500 + 2_000));
}

export function seasonArchitectureInstructions(input: SeasonArchitecturePrompt): { system: string; prompt: string } {
  const system = [
    "You are a narrative architect designing the high-level season architecture for a serialized drama.",
    "Do not write detailed episode plans or screenplays. Produce only the season-level direction and a brief outline for each episode.",
    "Every episode must have a distinct narrative purpose and build upon established events.",
    "Respect the approved Story Bible as immutable canon.",
    "Return only the JSON object described by the schema. No markdown, no commentary.",
  ].join(" ");

  const prompt = [
    `Series title: ${input.seriesTitle}`,
    `Genre: ${input.genre}`,
    `Language: ${input.language}`,
    `Tone: ${input.tone}`,
    `Production mode: ${input.productionMode}`,
    `Requested episode count: ${input.episodeCount}`,
    input.creativeDirection ? `Creator's creative direction: ${input.creativeDirection}` : "",
    input.instruction ? `Creator's requested change: ${input.instruction}` : "",
    `Approved story foundation:\n${input.storyFoundation}`,
    `Approved Story Bible (immutable canon):\n${JSON.stringify(input.storyBible)}`,
    input.previousEpisodes?.length
      ? `Episodes already produced:\n${JSON.stringify(input.previousEpisodes)}`
      : "",
    input.continuityContext
      ? `Continuity ledger:\n${input.continuityContext}`
      : "",
    "",
    "Provide exactly the following top-level fields in the JSON object:",
    "String fields (must be a single string, not an array):",
    "- seasonObjective (string, max 1200 chars: the overarching goal of this season)",
    "- centralConflictOrMystery (string, max 1000 chars: the main conflict or mystery driving the season)",
    "- mainCharacterObjectives (string, max 1000 chars: what the main characters aim to achieve this season)",
    "- overallCharacterDevelopment (string, max 1000 chars: how characters develop across the season)",
    "- beginningDirection (string, max 800 chars: narrative direction for the beginning of the season)",
    "- middleDirection (string, max 800 chars: narrative direction for the middle of the season)",
    "- endingDirection (string, max 800 chars: narrative direction for the ending of the season)",
    "- intendedSeasonConclusion (string, max 1000 chars: how the season is intended to conclude)",
    "Array of strings fields (must be an array of strings, not a single string):",
    "- majorStoryDevelopments (3 to 10 strings, each max 500 chars: key story developments)",
    "- importantRevelations (2 to 8 strings, each max 500 chars: major revelations)",
    "- relationshipChanges (2 to 8 strings, each max 500 chars: key relationship changes)",
    "- consequencesCarriedBetween (2 to 8 strings, each max 500 chars: consequences that carry between episodes)",
    "- setupAndPayoff (2 to 6 strings, each max 500 chars: setups and their payoffs)",
    "- unresolvedQuestions (2 to 6 strings, each max 500 chars: questions left open for future seasons)",
    "Array of objects field:",
    `- episodeOutlines (1 to 24 objects, one per requested episode (${input.episodeCount} requested), each with):`,
    "  - episodeNumber (integer, sequential, starting at 1)",
    "  - workingTitle (string, max 120 chars: specific to this episode, not the series title)",
    "  - narrativePurpose (string, max 600 chars: what this episode accomplishes)",
    "  - centralConflict (string, max 600 chars: the specific conflict of this episode)",
    "  - endingOrCliffhanger (string, max 600 chars: how the episode ends)",
    "",
    "Required output contract:",
    "Return exactly the JSON shape described above. Every key must be present. Replace every placeholder with real content. Every array item and every required text field must be non-empty. Do not include any fields not listed above.",
  ].filter(Boolean).join("\n");

  return { system, prompt };
}

export async function requestSeasonArchitecture(
  transport: SeasonPlanTaskTransport,
  input: SeasonArchitecturePrompt,
  options: StoryCallOptions = {}
): Promise<{ architecture: SeasonArchitecture; usage?: TokenUsage }> {
  const instructions = seasonArchitectureInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    SEASON_ARCHITECTURE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options),
    architectureOutputBudget(input.episodeCount)
  );
  const parsed = parseStructured(transport.label, response.text, seasonArchitectureSchema, "season architecture", normalizeSeasonArchitecture, response.truncated);
  return { architecture: parsed, usage: response.usage };
}

export function episodeDetailBatchInstructions(input: EpisodeDetailBatchPrompt): { system: string; prompt: string } {
  const system = [
    "You are a narrative architect writing detailed episode plans for a serialized drama.",
    "The season architecture is already approved. Your job is to flesh out each episode with full detail.",
    "Every episode must respect the season architecture, the Story Bible canon, and continuity from prior episodes.",
    "Return only the JSON object described by the schema. No markdown, no commentary.",
  ].join(" ");

  const episodeNumbers = input.outlines.map((o) => o.episodeNumber).join(", ");
  const outlinesText = input.outlines.map((o) =>
    `Episode ${o.episodeNumber}: "${o.workingTitle}" — Purpose: ${o.narrativePurpose} — Conflict: ${o.centralConflict} — Ending: ${o.endingOrCliffhanger}`
  ).join("\n");

  const prompt = [
    `Series title: ${input.seriesTitle}`,
    `Genre: ${input.genre}`,
    `Language: ${input.language}`,
    `Tone: ${input.tone}`,
    `Production mode: ${input.productionMode}`,
    `Approved Story Bible (immutable canon):\n${JSON.stringify(input.storyBible)}`,
    `Approved season architecture:\n${JSON.stringify(input.architecture)}`,
    `Episodes to detail: ${episodeNumbers}`,
    `Episode outlines:\n${outlinesText}`,
    input.previousEpisodes?.length
      ? `Episodes already produced:\n${JSON.stringify(input.previousEpisodes)}`
      : "",
    input.continuityContext
      ? `Continuity ledger:\n${input.continuityContext}`
      : "",
    "",
    "For each episode in the episodes array, provide all fields with the correct type:",
    "String fields (must be a single string, not an array):",
    "- episodeNumber (integer)",
    "- workingTitle (string, max 120 chars, from the outline)",
    "- narrativePurpose (string, max 600 chars, from the outline)",
    "- startingSituation (string, max 800 chars: what the episode inherits from previous episodes)",
    "- mainObjective (string, max 600 chars, from the outline)",
    "- centralConflict (string, max 600 chars, from the outline)",
    "- characterDevelopment (string, max 800 chars: a narrative summary of how characters change in this episode — NOT an array)",
    "- storyContribution (string, max 600 chars: how this episode advances the season)",
    "- endingOrCliffhanger (string, max 600 chars, from the outline)",
    "- continuityRequirements (string, max 600 chars: what the next episode must respect)",
    "Array of strings fields (must be an array of strings, not a single string):",
    "- majorStoryBeats (1 to 10 strings, each max 400 chars: key dramatic moments)",
    "- informationRevealed (1 to 8 strings, each max 400 chars: what the audience/characters learn)",
    "- importantEvents (1 to 8 strings, each max 400 chars: what happens)",
    "- consequences (1 to 8 strings, each max 400 chars: what carries forward)",
    "- unresolvedThreads (1 to 6 strings, each max 400 chars: questions left open)",
    "Array of objects fields (use empty arrays when an episode has no change of that kind):",
    "- characterArcChanges (0 to 8 objects, each {name: string max 80, change: string max 400})",
    "- relationshipChanges (0 to 6 objects, each {from: string max 80, to: string max 80, change: string max 300})",
    "- objectChanges (0 to 6 objects, each {name: string max 120, ownership: string max 200, condition: string max 300})",
    "- locationChanges (0 to 6 objects, each {name: string max 120, change: string max 300})",
    "",
    "Required output contract:",
    "Return a JSON object with a single key \"episodes\" containing an array of episode objects. Every field listed above must be present in each episode object with the correct type. Replace every placeholder with real content. Every required text field must be non-empty.",
  ].filter(Boolean).join("\n");

  return { system, prompt };
}

export async function requestEpisodeDetails(
  transport: SeasonPlanTaskTransport,
  input: EpisodeDetailBatchPrompt,
  options: StoryCallOptions = {}
): Promise<{ batch: EpisodeDetailBatch; usage?: TokenUsage }> {
  const instructions = episodeDetailBatchInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    EPISODE_DETAIL_BATCH_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options),
    episodeDetailBatchBudget(input.outlines.length)
  );
  const parsed = parseStructured(transport.label, response.text, episodeDetailBatchSchema, "episode details", normalizeEpisodeDetailBatch, response.truncated);
  return { batch: parsed as EpisodeDetailBatch, usage: response.usage };
}

export function assembleSeasonPlan(
  architecture: SeasonArchitecture,
  episodes: EpisodeDetailBatch["episodes"]
): SeasonPlan {
  return {
    seasonObjective: architecture.seasonObjective,
    centralConflictOrMystery: architecture.centralConflictOrMystery,
    mainCharacterObjectives: architecture.mainCharacterObjectives,
    overallCharacterDevelopment: architecture.overallCharacterDevelopment,
    majorStoryDevelopments: architecture.majorStoryDevelopments,
    beginningDirection: architecture.beginningDirection,
    middleDirection: architecture.middleDirection,
    endingDirection: architecture.endingDirection,
    episodeProgression: episodes,
    importantRevelations: architecture.importantRevelations,
    relationshipChanges: architecture.relationshipChanges,
    consequencesCarriedBetween: architecture.consequencesCarriedBetween,
    setupAndPayoff: architecture.setupAndPayoff,
    unresolvedQuestions: architecture.unresolvedQuestions,
    intendedSeasonConclusion: architecture.intendedSeasonConclusion,
  };
}
