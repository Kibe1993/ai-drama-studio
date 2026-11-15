import { z } from "zod";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { ScreenplayScene } from "@/lib/validation/story";
import type { StageTransport } from "@/lib/providers/llm/stageTasks";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";

export type QualityQaPrompt = {
  seriesTitle: string;
  episodeNumber: number;
  synopsis: string;
  screenplay: ScreenplayScene[];
  targetDurationSeconds: number;
  episodePlan: unknown | null;
  seasonPlan: unknown | null;
  continuityLedger: unknown | null;
  bibleBrief: unknown | null;
};

export const qaDimensionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  score: z.number().int().min(0).max(100),
  rationale: z.string().trim().max(600).default(""),
  issues: z.array(
    z.object({
      severity: z.enum(["error", "warning", "info"]),
      message: z.string().trim().min(1).max(600),
    })
  ).max(10).default([]),
});

export const qaReportSchema = z.object({
  dimensions: z.array(qaDimensionSchema).min(1).max(8),
  overallScore: z.number().int().min(0).max(100),
  recommendation: z.enum(["approve", "revise", "reject"]).default("revise"),
  summary: z.string().trim().max(2000).default(""),
});

export type QaDimension = z.infer<typeof qaDimensionSchema>;
export type QaReport = z.infer<typeof qaReportSchema>;

export const QA_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dimensions", "overallScore"],
  properties: {
    dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "score"],
        properties: {
          name: { type: "string" },
          score: { type: "integer" },
          rationale: { type: "string" },
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["severity", "message"],
              properties: {
                severity: { type: "string", enum: ["error", "warning", "info"] },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
    overallScore: { type: "integer" },
    recommendation: { type: "string", enum: ["approve", "revise", "reject"] },
    summary: { type: "string" },
  },
} as const;

export function qaInstructions(input: QualityQaPrompt): { system: string; prompt: string } {
  return {
    system:
      "You are an independent quality assessor for a serialized drama. You evaluate a completed screenplay that was written by a different AI. You must judge it honestly — do not assume it is good just because it was generated. Return one JSON object and no other text.",
    prompt: [
      `Series: ${input.seriesTitle}`,
      `Episode: ${input.episodeNumber}`,
      `Target duration: ${input.targetDurationSeconds} seconds`,
      "",
      "Evaluate the screenplay on these dimensions, scoring each 0-100:",
      "- plot_coherence: Does the episode's plot make sense? Are cause and effect clear?",
      "- character_consistency: Do characters act consistently with their established traits and knowledge?",
      "- dialogue_quality: Is the dialogue natural, distinct per character, and purposeful?",
      "- pacing: Does the episode move at an appropriate pace for its duration and content?",
      "- thematic_resonance: Does the episode deliver on its thematic intent?",
      "- emotional_impact: Will the audience feel what the episode wants them to feel?",
      "",
      "For each dimension, provide:",
      "- score: 0-100 (be honest — 50 is average, 70 is good, 90 is excellent)",
      "- rationale: a brief explanation of the score",
      "- issues: specific problems with severity (error for serious issues, warning for moderate, info for minor)",
      "",
      "Also provide:",
      "- overallScore: weighted overall score 0-100",
      "- recommendation: approve (70+), revise (30-69), reject (<30 or any error-level issue)",
      "- summary: a brief overall assessment",
      "",
      "You are the INDEPENDENT quality gate. Your assessment can block approval. Be rigorous.",
      "Do not rubber-stamp the screenplay. If it has real problems, say so.",
      "",
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

export async function requestQualityQa(
  transport: StageTransport,
  input: QualityQaPrompt,
  options: StoryCallOptions = {},
): Promise<{ report: QaReport; usage?: TokenUsage }> {
  const instructions = qaInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    QA_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    options.signal ?? AbortSignal.timeout(120_000),
    4_000,
  );
  const parsed = parseStructured(transport.label, response.text, qaReportSchema, "quality QA report");
  const report: QaReport = {
    dimensions: parsed.dimensions.map((d) => ({
      name: d.name,
      score: d.score,
      rationale: d.rationale ?? "",
      issues: (d.issues ?? []).map((issue) => ({
        severity: issue.severity,
        message: issue.message,
      })),
    })),
    overallScore: parsed.overallScore,
    recommendation: parsed.recommendation ?? "revise",
    summary: parsed.summary ?? "",
  };
  return { report, usage: response.usage };
}