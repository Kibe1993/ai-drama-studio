import { z } from "zod";
import { storyCompletionBudget, storySceneRange } from "@/lib/providers/llm/budget";
import { parseStructured } from "@/lib/providers/llm/parse";
import { repairScreenplayScenes, screenplaySource } from "@/lib/providers/llm/repairStory";
import type { StageTransport } from "@/lib/providers/llm/stageTasks";
import type { StoryCallOptions, StoryPrompt, TokenUsage } from "@/lib/providers/llm/types";
import { screenplaySceneSchema, type ScreenplayScene } from "@/lib/validation/story";

/**
 * When a single screenplay response is truncated or shorter than the episode
 * needs, the provider is asked to continue from the last complete scene
 * instead of the whole episode being discarded. A single response can no
 * longer be the ceiling on how long a screenplay can be.
 */
export const MAX_CONTINUATION_ROUNDS = 4;

export const screenplayContinuationSchema = z.object({
  screenplay: z.array(screenplaySceneSchema).min(1).max(40),
});

export const STORY_CONTINUATION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["screenplay"],
  properties: {
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

export function continuationInstructions(
  input: StoryPrompt,
  written: ScreenplayScene[]
): { system: string; prompt: string } {
  const next = written.length + 1;
  const maximum = storySceneRange(input.targetDurationSeconds).max;
  const remaining = Math.max(1, maximum - written.length);
  const last = written[written.length - 1];
  return {
    system:
      "You continue an in-progress screenplay. Return only the JSON object the schema describes and no other text.",
    prompt: [
      `Story title: ${input.title}`,
      `Genre: ${input.genre}. Language: ${input.language}. Tone: ${input.tone}. Visual style: ${input.visualStyle}.`,
      `Target duration: ${input.targetDurationSeconds} seconds.`,
      ...(input.continuityContext?.trim()
        ? ["Approved Story Bible context (follow these established facts and boundaries):", input.continuityContext.trim()]
        : []),
      "Story idea:",
      input.idea.trim() || "A short family conflict with a private choice at the center.",
      `The screenplay already contains ${written.length} scene${written.length === 1 ? "" : "s"} (scenes 1–${written.length}).`,
      last ? `The most recent scene is:\n${JSON.stringify(last)}` : "",
      `Continue from scene ${next}. Write the next ${remaining} scene${remaining === 1 ? "" : "s"} that carry the remaining acts to a developed climax and a resolution or deliberate cliffhanger.`,
      "Do not repeat, summarise, renumber, or rewrite the scenes already written, and do not restart the story.",
      `Number the new scenes sequentially starting at ${next}.`,
      "Maintain continuity with the written scenes: keep the same characters, locations, world rules, and unresolved plot threads.",
      "Return an object with a single key 'screenplay' whose array holds only the new scenes.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export type StoryContinuationResult = {
  screenplay: ScreenplayScene[];
  usage?: TokenUsage;
  truncated?: boolean;
};

export async function requestStoryContinuation(
  transport: StageTransport,
  input: StoryPrompt,
  written: ScreenplayScene[],
  options: StoryCallOptions = {}
): Promise<StoryContinuationResult> {
  const instructions = continuationInstructions(input, written);
  const signal = options.signal ?? AbortSignal.timeout(90_000);
  const declared = (text: string): number => {
    try {
      return screenplaySource(JSON.parse(text)).length;
    } catch {
      return 0;
    }
  };
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    STORY_CONTINUATION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signal,
    storyCompletionBudget(input.targetDurationSeconds)
  );
  const parsed = parseStructured(
    transport.label,
    response.text,
    screenplayContinuationSchema,
    "screenplay continuation",
    (value) => ({ screenplay: repairScreenplayScenes(screenplaySource(value)) })
  );
  const truncated =
    Boolean(response.truncated) || declared(response.text) > parsed.screenplay.length;
  return { screenplay: parsed.screenplay, usage: response.usage, truncated };
}

/**
 * Combine the scenes already written with a continuation, keeping the earlier
 * scenes, dropping anything that repeats them, and renumbering the result so
 * scene numbers stay sequential and unique.
 */
export function mergeScreenplays(
  existing: ScreenplayScene[],
  addition: ScreenplayScene[]
): ScreenplayScene[] {
  const fingerprints = new Set(existing.map(fingerprint));
  const merged = [...existing];
  for (const scene of addition) {
    const key = fingerprint(scene);
    if (fingerprints.has(key)) continue;
    fingerprints.add(key);
    merged.push({ ...scene, sceneNumber: merged.length + 1 });
  }
  return merged;
}

function fingerprint(scene: ScreenplayScene): string {
  return `${scene.heading}|${scene.action}`.trim().toLowerCase();
}
