import { z } from "zod";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { StageTransport } from "@/lib/providers/llm/stageTasks";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import {
  shotPlanSchema,
  type ShotPlan,
} from "@/lib/validation/scene";

export type ShotPlanPrompt = {
  sceneNumber: number;
  title: string;
  location: string;
  interiorExterior: string;
  timeOfDay: string;
  charactersPresent: string[];
  visualDescription: string;
  action: string;
  dialogue: Array<{ characterName: string; line: string }>;
  cameraDirection: string;
  estimatedDurationSeconds: number | null;
  continuityContext?: string;
};

export const SHOT_PLAN_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shots"],
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["shotNumber", "purpose"],
        properties: {
          shotNumber: { type: "integer" },
          purpose: { type: "string" },
          framing: { type: "string" },
          cameraAngle: { type: "string" },
          cameraDirection: { type: "string" },
          action: { type: "string" },
          environment: { type: "string" },
          lighting: { type: "string" },
          continuity: { type: "string" },
          estimatedDurationSeconds: { type: "integer" },
        },
      },
    },
  },
} as const;

const shotPlanSetSchema = shotPlanSchema.extend({}).array().min(1).max(20);

export function shotPlanInstructions(input: ShotPlanPrompt): { system: string; prompt: string } {
  const dialogueSummary = input.dialogue.length > 0
    ? input.dialogue.map((d) => `${d.characterName}: "${d.line}"`).join("\n")
    : "(no dialogue)";
  return {
    system:
      "You are a director of photography. You break a production scene into a sequence of shots. Return one JSON object and no other text.",
    prompt: [
      `Scene ${input.sceneNumber}: ${input.title}`,
      `Location: ${input.location} (${input.interiorExterior || "unspecified"})`,
      `Time of day: ${input.timeOfDay}`,
      `Characters present: ${input.charactersPresent.join(", ")}`,
      `Estimated scene duration: ${input.estimatedDurationSeconds ?? "unknown"} seconds`,
      "",
      "Visual description:",
      input.visualDescription,
      "",
      "Action:",
      input.action,
      "",
      "Dialogue:",
      dialogueSummary,
      "",
      input.cameraDirection ? `Existing camera direction: ${input.cameraDirection}` : "",
      input.continuityContext ? `Continuity context from prior scenes:\n${input.continuityContext}` : "",
      "",
      "Break this scene into a sequence of shots. For each shot:",
      "- shotNumber: sequential integer starting at 1",
      "- purpose: what this shot accomplishes (establish, reveal, follow, react, etc.)",
      "- framing: close-up, medium, wide, over-the-shoulder, etc.",
      "- cameraAngle: eye-level, low, high, dutch, etc.",
      "- cameraDirection: pan, tilt, dolly, static, handheld, etc.",
      "- action: what happens in this shot specifically",
      "- environment: set dressing, props, background activity",
      "- lighting: key, fill, practical, natural, mood lighting",
      "- continuity: continuity notes for this shot (match to prior/next)",
      "- estimatedDurationSeconds: how long this shot lasts (positive integer, max 180)",
      "",
      "The shots must cover the entire scene. Their durations should roughly total the scene's estimated duration.",
      "Each shot must be filmable in a single take. Do not combine unrelated actions into one shot.",
      "Maintain visual continuity between shots. Respect screen direction (180-degree rule).",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function requestShotPlan(
  transport: StageTransport,
  input: ShotPlanPrompt,
  options: StoryCallOptions = {},
): Promise<{ shots: ShotPlan[]; usage?: TokenUsage }> {
  const instructions = shotPlanInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    SHOT_PLAN_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    options.signal ?? AbortSignal.timeout(120_000),
    4_000,
  );
  const parsed = parseStructured(
    transport.label,
    response.text,
    z.object({ shots: shotPlanSetSchema }),
    "shot plan",
  );
  const shots = parsed.shots.map((shot) => ({
    shotNumber: shot.shotNumber,
    purpose: shot.purpose,
    framing: shot.framing ?? "",
    cameraAngle: shot.cameraAngle ?? "",
    cameraDirection: shot.cameraDirection ?? "",
    action: shot.action ?? "",
    environment: shot.environment ?? "",
    lighting: shot.lighting ?? "",
    continuity: shot.continuity ?? "",
    estimatedDurationSeconds: shot.estimatedDurationSeconds ?? null,
  }));
  assertShotPlan(input, shots);
  return { shots, usage: response.usage };
}

function assertShotPlan(input: ShotPlanPrompt, shots: ShotPlan[]): void {
  const numbers = shots.map((s) => s.shotNumber);
  if (new Set(numbers).size !== numbers.length) {
    throw new Error("Shot plan repeats a shot number.");
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const expected = sorted.map((_, i) => i + 1);
  if (sorted.join(",") !== expected.join(",")) {
    throw new Error("Shot numbers must be a complete 1..n sequence.");
  }
  if (input.estimatedDurationSeconds && input.estimatedDurationSeconds > 0) {
    const total = shots.reduce((sum, s) => sum + (s.estimatedDurationSeconds ?? 0), 0);
    if (total > 0 && total > input.estimatedDurationSeconds * 3) {
      throw new Error(
        `Shot durations total ${total}s but the scene is ${input.estimatedDurationSeconds}s. Scale the estimates.`,
      );
    }
  }
}