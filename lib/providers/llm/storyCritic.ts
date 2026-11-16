import { z } from "zod";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { StageTransport } from "@/lib/providers/llm/stageTasks";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";

/**
 * An optional continuity critic.
 *
 * The deterministic validator remains the authority for canon. This pass
 * proposes timeline, knowledge, and canon claims. An error blocks the draft.
 * The application confirms a claim against the scene text before treating it
 * as a canon breach. The critic never writes canon.
 */
export type StoryCriticPrompt = {
  seriesTitle: string;
  episodeNumber: number;
  synopsis: string;
  screenplay: ScreenplayScene[];
  episodePlan: unknown | null;
  seasonPlan: unknown | null;
  continuityLedger: unknown | null;
  bibleBrief: unknown | null;
};

export const storyCriticFindingSchema = z.object({
  category: z.enum(["canon", "timeline", "knowledge", "quality"]),
  severity: z.enum(["warning", "error"]),
  sceneNumber: z.number().int().positive().optional(),
  message: z.string().trim().min(1).max(600),
});

export const storyCritiqueSchema = z.object({
  findings: z.array(storyCriticFindingSchema).max(12),
});

export type StoryCriticFinding = z.infer<typeof storyCriticFindingSchema>;

export const STORY_CRITIQUE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "message"],
        properties: {
          category: { type: "string", enum: ["canon", "timeline", "knowledge", "quality"] },
          severity: { type: "string", enum: ["warning", "error"] },
          sceneNumber: { type: "integer" },
          message: { type: "string", maxLength: 600 },
        },
      },
    },
  },
} as const;

export function criticInstructions(input: StoryCriticPrompt): { system: string; prompt: string } {
  return {
    system:
      "You are a continuity editor for a serialized drama. Report only concrete problems you can point to in the screenplay. Do not rewrite anything. Return only the JSON object the schema describes.",
    prompt: [
      `Series: ${input.seriesTitle}`,
      `Episode: ${input.episodeNumber}`,
      "Check the screenplay against the approved canon and plan below.",
      "Look for: a timeline that cannot be true, a character acting on knowledge they were never given (or forgetting knowledge they already had), a canon contradiction, and scenes that do not serve this episode.",
      "Only report an issue when you can name the scene and explain the conflict. Do not report style preferences, pacing, or quality without a concrete canonical or logical problem.",
      "severity must be 'warning' unless the screenplay directly contradicts a stated canon fact.",
      "If there is nothing concrete, return an empty findings array.",
      input.bibleBrief ? `Approved canon:\n${JSON.stringify(input.bibleBrief)}` : "",
      input.episodePlan ? `Episode plan:\n${JSON.stringify(input.episodePlan)}` : "",
      input.seasonPlan ? `Season plan:\n${JSON.stringify(input.seasonPlan)}` : "",
      input.continuityLedger ? `Continuity Ledger:\n${JSON.stringify(input.continuityLedger)}` : "",
      `Synopsis: ${input.synopsis}`,
      `Screenplay:\n${JSON.stringify(input.screenplay)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function requestStoryCritique(
  transport: StageTransport,
  input: StoryCriticPrompt,
  options: StoryCallOptions = {}
): Promise<{ findings: StoryCriticFinding[]; usage?: TokenUsage }> {
  const instructions = criticInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    STORY_CRITIQUE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    options.signal ?? AbortSignal.timeout(90_000),
    4_000
  );
  const parsed = parseStructured(transport.label, response.text, storyCritiqueSchema, "story critique");
  return { findings: parsed.findings, usage: response.usage };
}
