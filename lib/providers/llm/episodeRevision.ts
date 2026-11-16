import { z } from "zod";
import type { EpisodePlanItem } from "@/lib/validation/seasonPlan";
import { episodePlanItemSchema } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RevisionAction } from "@/lib/validation/revisionPlan";
import type { StageTransport } from "@/lib/providers/llm/stageTasks";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { StoryCallOptions } from "@/lib/providers/llm/types";
import type { TokenUsage } from "@/lib/providers/llm/types";

/**
 * Episode Revision — transport-level module for revising a single episode's
 * plan content to resolve a validation finding.
 *
 * This follows the same pattern as repairScenes.ts and seasonPlanReasoning.ts:
 * 1. Define the prompt type
 * 2. Define the Zod result schema + JSON Schema for structured output
 * 3. Build the system + user prompt
 * 4. Call the transport and parse the structured response
 */

// ---------------------------------------------------------------------------
// Prompt type
// ---------------------------------------------------------------------------

export interface EpisodeRevisionPrompt {
  seriesTitle: string;
  action: RevisionAction;
  currentEpisode: EpisodePlanItem;
  seasonPlanObjective: string;
  bible: StoryBibleContent | null;
  previousEpisode: EpisodePlanItem | null;
  nextEpisode: EpisodePlanItem | null;
}

// ---------------------------------------------------------------------------
// Zod result schema — the LLM returns a single revised episode
// ---------------------------------------------------------------------------

export const episodeRevisionResultSchema = z.object({
  episode: episodePlanItemSchema,
});

// ---------------------------------------------------------------------------
// JSON Schema for structured output (passed to the transport)
// ---------------------------------------------------------------------------

export const EPISODE_REVISION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["episode"],
  properties: {
    episode: {
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
          type: "array", maxItems: 8,
          items: {
            type: "object", additionalProperties: false,
            required: ["name", "change"],
            properties: { name: { type: "string", maxLength: 80 }, change: { type: "string", maxLength: 400 } },
          },
        },
        relationshipChanges: {
          type: "array", maxItems: 6,
          items: {
            type: "object", additionalProperties: false,
            required: ["from", "to", "change"],
            properties: {
              from: { type: "string", maxLength: 80 },
              to: { type: "string", maxLength: 80 },
              change: { type: "string", maxLength: 300 },
            },
          },
        },
        objectChanges: {
          type: "array", maxItems: 6,
          items: {
            type: "object", additionalProperties: false,
            required: ["name", "ownership", "condition"],
            properties: {
              name: { type: "string", maxLength: 120 },
              ownership: { type: "string", maxLength: 200 },
              condition: { type: "string", maxLength: 300 },
            },
          },
        },
        locationChanges: {
          type: "array", maxItems: 6,
          items: {
            type: "object", additionalProperties: false,
            required: ["name", "change"],
            properties: { name: { type: "string", maxLength: 120 }, change: { type: "string", maxLength: 300 } },
          },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function safetyRules(constraints: RevisionAction["safetyConstraints"]): string[] {
  const rules: string[] = [];
  for (const constraint of constraints) {
    switch (constraint) {
      case "smallest_possible_change":
        rules.push("Make the smallest possible change that addresses the finding. Do not rewrite the entire episode.");
        break;
      case "no_canon_modification":
        rules.push("Do not change or contradict the Story Bible canon.");
        break;
      case "no_premise_change":
        rules.push("Do not change the central premise of the story.");
        break;
      case "no_full_rewrite":
        rules.push("Do not rewrite the entire episode. Modify only the sections directly related to the finding.");
        break;
      case "no_history_invention":
        rules.push("Do not invent new character history or background not already established in canon.");
        break;
      case "no_character_removal":
        rules.push("Do not remove characters from the episode. If a name is wrong, correct it; do not delete the character.");
        break;
      case "no_rule_weakening":
        rules.push("Do not weaken or remove validation rules to make the finding pass.");
        break;
      case "preserve_dialogue":
        rules.push("Preserve existing dialogue patterns and character voice.");
        break;
      case "preserve_scene_order":
        rules.push("Preserve the order of scenes and story beats unless the finding is specifically about ordering.");
        break;
      case "preserve_motivations":
        rules.push("Preserve character motivations unless the finding is specifically about a motivation problem.");
        break;
      case "preserve_deliberate_mysteries":
        rules.push("Preserve deliberate mysteries, cliffhangers, and unresolved threads that are intentional.");
        break;
    }
  }
  return rules;
}

export function revisionInstructions(input: EpisodeRevisionPrompt): { system: string; prompt: string } {
  const { action, currentEpisode } = input;
  const rules = safetyRules(action.safetyConstraints);

  const systemParts: string[] = [
    "You are a narrative continuity editor revising a single episode of a serialized drama season plan.",
    "You receive an episode with a specific validation finding and must revise ONLY the affected content.",
    "Return only the JSON object the schema describes and no other text.",
  ];

  const promptParts: string[] = [
    `Series: ${input.seriesTitle}`,
    `Season Objective: ${input.seasonPlanObjective}`,
    "",
    `Revision Action: ${action.description}`,
    `Action Type: ${action.type}`,
    `Domain: ${action.domain}`,
    `Priority: ${action.priority}`,
    "",
    "Correction Guidance:",
    action.correctionGuidance,
    "",
    `Target Episode: ${currentEpisode.episodeNumber} — "${currentEpisode.workingTitle}"`,
    "Current episode content:",
    JSON.stringify(currentEpisode, null, 2),
    "",
  ];

  if (input.previousEpisode) {
    promptParts.push(
      `Previous episode (${input.previousEpisode.episodeNumber}) for continuity context:`,
      JSON.stringify({
        workingTitle: input.previousEpisode.workingTitle,
        endingOrCliffhanger: input.previousEpisode.endingOrCliffhanger,
        consequences: input.previousEpisode.consequences,
        unresolvedThreads: input.previousEpisode.unresolvedThreads,
      }),
      "",
    );
  }

  if (input.nextEpisode) {
    promptParts.push(
      `Next episode (${input.nextEpisode.episodeNumber}) for downstream context:`,
      JSON.stringify({
        workingTitle: input.nextEpisode.workingTitle,
        startingSituation: input.nextEpisode.startingSituation,
        continuityRequirements: input.nextEpisode.continuityRequirements,
      }),
      "",
    );
  }

  if (input.bible) {
    const bibleSummary = [
      `Title: ${input.bible.identity.title}`,
      `Premise: ${input.bible.identity.centralPremise}`,
      `Characters: ${input.bible.characters.characters.map((c) => c.name).join(", ")}`,
      `Locations: ${input.bible.world.geographyAndLocations.map((l) => l.name).join(", ")}`,
    ].join("\n");
    promptParts.push("Story Bible (canon — do not modify):", bibleSummary, "");
  }

  promptParts.push("Safety Rules:");
  for (let i = 0; i < rules.length; i++) {
    promptParts.push(`${i + 1}. ${rules[i]}`);
  }
  promptParts.push("");
  promptParts.push(
    `Keep the episode number as ${currentEpisode.episodeNumber}.`,
    "Return the complete revised episode as a JSON object with a single key, episode, containing the revised episode.",
  );

  return {
    system: systemParts.join("\n"),
    prompt: promptParts.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Transport request function
// ---------------------------------------------------------------------------

export async function requestEpisodeRevision(
  transport: StageTransport,
  input: EpisodeRevisionPrompt,
  options: StoryCallOptions = {},
): Promise<{ episode: EpisodePlanItem; usage?: TokenUsage }> {
  const instructions = revisionInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    EPISODE_REVISION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    options.signal ?? AbortSignal.timeout(90_000),
    4_000,
  );
  const parsed = parseStructured(
    transport.label,
    response.text,
    episodeRevisionResultSchema,
    "episode revision",
  );
  const episode = episodePlanItemSchema.parse(parsed.episode);
  return { episode, usage: response.usage };
}