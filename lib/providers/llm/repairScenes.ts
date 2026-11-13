import { z } from "zod";
import { stageCompletionBudget } from "@/lib/providers/llm/budget";
import { parseStructured } from "@/lib/providers/llm/parse";
import { screenplaySceneSchema, type ScreenplayScene } from "@/lib/validation/story";
import type { EpisodeValidationFinding } from "@/lib/validation/casna";
import type { StageTransport } from "@/lib/providers/llm/stageTasks";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";

/**
 * CASNA Stage H repair: rewrite only the scenes a validation finding points at,
 * keeping every other scene untouched. This is the alternative to regenerating
 * an entire episode when one scene contradicts canon or repeats a beat.
 */
export type RepairScenesPrompt = {
  seriesTitle: string;
  episodeNumber: number;
  targetDurationSeconds: number;
  /** The complete screenplay, so the repair knows what surrounds the target scenes. */
  screenplay: ScreenplayScene[];
  /** Findings that identify the scenes to repair. */
  findings: EpisodeValidationFinding[];
  episodePlan: unknown | null;
  seasonPlan: unknown | null;
  continuityLedger: unknown | null;
};

export const repairScenesResultSchema = z.object({
  screenplay: z.array(screenplaySceneSchema).min(1).max(40),
});

export const REPAIR_SCENES_RESPONSE_SCHEMA = {
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

export function repairSceneNumbers(findings: EpisodeValidationFinding[]): number[] {
  return [
    ...new Set(
      findings
        .filter((finding) => finding.severity === "error" && finding.sceneNumber)
        .map((finding) => finding.sceneNumber!)
    ),
  ].sort((a, b) => a - b);
}

export function repairSceneInstructions(input: RepairScenesPrompt): { system: string; prompt: string } {
  const targets = repairSceneNumbers(input.findings);
  const targetScenes = input.screenplay.filter((scene) => targets.includes(scene.sceneNumber));
  const findings = input.findings
    .filter((finding) => finding.severity === "error")
    .map((finding) => `- ${finding.category}${finding.sceneNumber ? ` (scene ${finding.sceneNumber})` : ""}: ${finding.message}`);
  return {
    system:
      "You repair specific scenes of an existing, canon-bound screenplay. Return only the JSON object the schema describes and no other text.",
    prompt: [
      `Series title: ${input.seriesTitle}`,
      `Episode: ${input.episodeNumber}`,
      `Target duration: ${input.targetDurationSeconds} seconds.`,
      "Rewrite ONLY the scenes listed under 'Scenes to repair'. Keep their sceneNumber exactly the same.",
      "Do not add, remove, merge, or renumber scenes. Do not change any scene you were not asked to repair.",
      "Keep the established canon below. Do not introduce a character, fact, location, or event that is not already sanctioned by it.",
      "Each repaired scene must keep the same screenplay shape: heading, location, timeOfDay, charactersPresent, visualDescription, action, dialogue.",
      "Make the smallest change that resolves the finding while preserving the surrounding story.",
      "Validation findings to resolve:",
      ...(findings.length > 0 ? findings : ["- (none listed)"]),
      "Scenes to repair:",
      JSON.stringify(targetScenes),
      "Full screenplay for context (do not rewrite scenes outside the repair list):",
      JSON.stringify(input.screenplay),
      input.episodePlan ? `Episode plan:\n${JSON.stringify(input.episodePlan)}` : "",
      input.seasonPlan ? `Season plan:\n${JSON.stringify(input.seasonPlan)}` : "",
      input.continuityLedger ? `Established canon:\n${JSON.stringify(input.continuityLedger)}` : "",
      "Required output: a JSON object with a single key, screenplay, containing exactly the repaired scenes.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function requestSceneRepair(
  transport: StageTransport,
  input: RepairScenesPrompt,
  options: StoryCallOptions = {}
): Promise<{ screenplay: ScreenplayScene[]; usage?: TokenUsage }> {
  const instructions = repairSceneInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    REPAIR_SCENES_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    options.signal ?? AbortSignal.timeout(90_000),
    stageCompletionBudget(repairSceneNumbers(input.findings).length)
  );
  const parsed = parseStructured(transport.label, response.text, repairScenesResultSchema, "scene repair");
  return { screenplay: parsed.screenplay, usage: response.usage };
}

/**
 * Replace only the repaired scenes, keeping the original order and every
 * untouched scene. Returns null when the repair is not usable (missing scene,
 * duplicate, or an unexpected scene number).
 */
export function mergeSceneRepair(
  screenplay: ScreenplayScene[],
  repaired: ScreenplayScene[],
  targetNumbers: number[]
): ScreenplayScene[] | null {
  if (targetNumbers.length === 0) return null;
  // Be tolerant of a provider that echoes the whole screenplay: only the target
  // scene numbers are consumed, and every target must be present.
  const byNumber = new Map(
    repaired
      .filter((scene) => targetNumbers.includes(scene.sceneNumber))
      .map((scene) => [scene.sceneNumber, scene])
  );
  if (byNumber.size !== targetNumbers.length) return null;
  return screenplay.map((scene) => byNumber.get(scene.sceneNumber) ?? scene);
}
