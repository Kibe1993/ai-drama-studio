import { z } from "zod";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { StageTransport } from "@/lib/providers/llm/stageTasks";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { RichValidationFinding } from "@/lib/validation/seasonPlanValidation";

export type SeasonPlanReasoningPrompt = {
  seriesTitle: string;
  seasonPlan: SeasonPlan;
  bibleContent: StoryBibleContent | null;
  deterministicFindings: RichValidationFinding[];
  narrativeContract: unknown;
  eventDependencies: unknown;
  characterStateTransitions: unknown;
  setupPayoffRecords: unknown;
};

export const aiReasoningFindingSchema = z.object({
  findingId: z.string().trim().min(1).max(80),
  category: z.enum([
    "narrative_integrity",
    "episode_progression",
    "character_state",
    "temporal_continuity",
    "setup_payoff",
    "climax_resolution",
    "canon_contradiction",
    "relationship_integrity",
  ]),
  severity: z.enum(["blocking", "high", "medium", "low"]),
  episodeNumber: z.number().int().positive().max(100).optional(),
  affectedField: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(600),
  explanation: z.string().trim().max(1000).optional(),
  evidence: z.array(z.string().trim().max(500)).max(6).optional(),
  whyItMatters: z.string().trim().max(500).optional(),
  recommendation: z.string().trim().max(600).optional(),
  requiresHumanReview: z.boolean().optional(),
  isContradiction: z.boolean().optional(),
  isCreativeRecommendation: z.boolean().optional(),
});

export const aiReasoningResultSchema = z.object({
  findings: z.array(aiReasoningFindingSchema).max(20),
  summary: z.string().trim().max(500).optional(),
});

export type AIReasoningFinding = z.infer<typeof aiReasoningFindingSchema>;
export type AIReasoningResult = z.infer<typeof aiReasoningResultSchema>;

export const SEASON_PLAN_REASONING_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "summary"],
  properties: {
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "findingId", "category", "severity", "message",
          "evidence", "requiresHumanReview",
          "isContradiction", "isCreativeRecommendation",
        ],
        properties: {
          findingId: { type: "string", maxLength: 80 },
          category: {
            type: "string",
            enum: [
              "narrative_integrity", "episode_progression", "character_state",
              "temporal_continuity", "setup_payoff", "climax_resolution",
              "canon_contradiction", "relationship_integrity",
            ],
          },
          severity: { type: "string", enum: ["blocking", "high", "medium", "low"] },
          episodeNumber: { type: "integer" },
          affectedField: { type: "string", maxLength: 200 },
          message: { type: "string", maxLength: 600 },
          explanation: { type: "string", maxLength: 1000 },
          evidence: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 6 },
          whyItMatters: { type: "string", maxLength: 500 },
          recommendation: { type: "string", maxLength: 600 },
          requiresHumanReview: { type: "boolean" },
          isContradiction: { type: "boolean" },
          isCreativeRecommendation: { type: "boolean" },
        },
      },
    },
    summary: { type: "string", maxLength: 500 },
  },
} as const;

export function reasoningInstructions(input: SeasonPlanReasoningPrompt): { system: string; prompt: string } {
  const plan = input.seasonPlan;
  const episodeSummary = plan.episodeProgression.map((ep) =>
    `  Episode ${ep.episodeNumber}: ${ep.workingTitle} — ${ep.narrativePurpose.slice(0, 100)}`
  ).join("\n");

  const deterministicSummary = input.deterministicFindings.length > 0
    ? input.deterministicFindings.map((f) =>
        `  [${f.severity}] ${f.category}${f.episodeNumber ? ` (ep ${f.episodeNumber})` : ""}: ${f.message}`
      ).join("\n")
    : "  (no deterministic findings)";

  return {
    system: [
      "You are a narrative continuity editor for a serialized drama season.",
      "You evaluate season plans for narrative coherence, not style.",
      "",
      "Your job:",
      "1. Evaluate whether the season forms a coherent story.",
      "2. Check whether episode transitions are logical.",
      "3. Assess whether character motivations are credible.",
      "4. Verify that revelations are appropriately timed.",
      "5. Check whether conflicts escalate naturally.",
      "6. Evaluate whether the finale fulfills the season's narrative promise.",
      "7. Determine whether unresolved questions are intentional.",
      "8. Identify any apparent contradictions explainable by genre or narrative rules.",
      "",
      "Rules:",
      "- Distinguish confirmed contradictions from subjective creative recommendations.",
      "- Set isContradiction=true only when you can identify the conflicting source statements.",
      "- Set isCreativeRecommendation=true for subjective improvements, not logical problems.",
      "- Never invent evidence. Quote from the plan or canon.",
      "- Never claim a contradiction without identifying the conflicting statements.",
      "- If there are no concrete issues, return an empty findings array.",
      "- Do not repeat findings already identified in the deterministic validation.",
    ].join("\n"),
    prompt: [
      `Series: ${input.seriesTitle}`,
      "",
      `Season Objective: ${plan.seasonObjective}`,
      `Central Conflict: ${plan.centralConflictOrMystery}`,
      `Intended Conclusion: ${plan.intendedSeasonConclusion}`,
      "",
      `Episodes (${plan.episodeProgression.length}):`,
      episodeSummary,
      "",
      "Deterministic validation findings already identified:",
      deterministicSummary,
      "",
      input.bibleContent
        ? `Approved Story Bible (canon):\n${JSON.stringify(input.bibleContent, null, 2).slice(0, 8000)}`
        : "(no Story Bible available)",
      "",
      `Narrative Contract:\n${JSON.stringify(input.narrativeContract, null, 2).slice(0, 4000)}`,
      "",
      input.eventDependencies
        ? `Event Dependencies:\n${JSON.stringify(input.eventDependencies, null, 2).slice(0, 3000)}`
        : "",
      input.characterStateTransitions
        ? `Character State Transitions:\n${JSON.stringify(input.characterStateTransitions, null, 2).slice(0, 3000)}`
        : "",
      input.setupPayoffRecords
        ? `Setup/Payoff Records:\n${JSON.stringify(input.setupPayoffRecords, null, 2).slice(0, 3000)}`
        : "",
      "",
      "Complete Season Plan:",
      JSON.stringify(plan, null, 2).slice(0, 12000),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function requestSeasonPlanReasoning(
  transport: StageTransport,
  input: SeasonPlanReasoningPrompt,
  options: StoryCallOptions = {}
): Promise<{ result: AIReasoningResult; usage?: TokenUsage }> {
  const instructions = reasoningInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    SEASON_PLAN_REASONING_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    options.signal ?? AbortSignal.timeout(120_000),
    8_000
  );
  const parsed = parseStructured(
    transport.label,
    response.text,
    aiReasoningResultSchema,
    "season plan reasoning"
  );
  return { result: parsed, usage: response.usage };
}

export function convertAIToRichFindings(aiFindings: AIReasoningFinding[]): RichValidationFinding[] {
  return aiFindings.map((f) => ({
    findingId: f.findingId,
    category: f.category,
    severity: f.severity,
    episodeNumber: f.episodeNumber,
    affectedField: f.affectedField,
    message: f.message,
    explanation: f.explanation,
    evidence: f.evidence,
    whyItMatters: f.whyItMatters,
    recommendation: f.recommendation,
    requiresHumanReview: f.requiresHumanReview ?? false,
    source: "ai_reasoning" as const,
    canonIssueType: f.category === "canon_contradiction" ? "CANON_CONTRADICTION" : undefined,
  }));
}