import { parseStructured } from "@/lib/providers/llm/parse";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import {
  SEASON_PLAN_RESPONSE_SCHEMA,
  seasonPlanSchema,
  type SeasonPlan,
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
  return options.signal ?? AbortSignal.timeout(120_000);
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
    "For every episode in episodeProgression, provide:",
    "- episodeNumber (sequential, starting at 1)",
    "- workingTitle (specific to this episode, not the series title)",
    "- narrativePurpose (what this episode accomplishes in the season)",
    "- startingSituation (what the episode inherits from previous episodes)",
    "- mainObjective (what the protagonist(s) aim to do)",
    "- centralConflict (the specific conflict of this episode)",
    "- majorStoryBeats (key dramatic moments)",
    "- informationRevealed (what the audience/characters learn)",
    "- characterDevelopment (how characters change)",
    "- importantEvents (what happens)",
    "- consequences (what carries forward)",
    "- storyContribution (how this episode advances the season)",
    "- endingOrCliffhanger (how the episode ends)",
    "- unresolvedThreads (questions left open)",
    "- continuityRequirements (what the next episode must respect)",
    "- characterArcChanges (array of {name, change}: how each named character changes in this episode)",
    "- relationshipChanges (array of {from, to, change}: how a relationship between two named characters changes)",
    "- objectChanges (array of {name, ownership, condition}: important objects and their state after this episode)",
    "- locationChanges (array of {name, change}: how a location's state changes in this episode)",
    "Use empty arrays when an episode has no change of that kind.",
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
    16_000
  );
  const parsed = parseStructured(transport.label, response.text, seasonPlanSchema, "season plan");
  return { plan: parsed as SeasonPlan, usage: response.usage };
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
