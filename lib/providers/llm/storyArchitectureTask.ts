import { parseStructured } from "@/lib/providers/llm/parse";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import {
  storyDiagnosisSchema,
  storyArchitectureSchema,
  STORY_DIAGNOSIS_RESPONSE_SCHEMA,
  STORY_ARCHITECTURE_RESPONSE_SCHEMA,
  type StoryDiagnosis,
  type StoryArchitecture,
} from "@/lib/validation/storyArchitecture";
import {
  assertDiagnosis,
  assertArchitecture,
  diagnosisToArchitectureGuidance,
} from "@/lib/domain/storyArchitecture";

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

export type DiagnosisPrompt = {
  title: string;
  idea: string;
  creativeDirection?: string;
  targetEpisodeCount?: number;
  targetDurationSeconds?: number;
};

export function diagnosisInstructions(input: DiagnosisPrompt): { system: string; prompt: string } {
  return {
    system:
      "You are a story development analyst. You diagnose an initial story concept and identify its strengths, weaknesses, and areas for improvement. Return one JSON object and no other text.",
    prompt: [
      `Story title: ${input.title}`,
      `Story idea:\n${input.idea}`,
      input.creativeDirection ? `Creative direction:\n${input.creativeDirection}` : "",
      input.targetEpisodeCount ? `Target episode count: ${input.targetEpisodeCount}` : "",
      input.targetDurationSeconds ? `Target episode duration: ${input.targetDurationSeconds} seconds` : "",
      "",
      "Analyse the concept and provide:",
      "- strengths: what works well (at least 1)",
      "- weaknesses: what needs improvement",
      "- structuralIssues: plot structure problems",
      "- characterIssues: character development problems",
      "- thematicIssues: theme or messaging problems",
      "- recommendations: specific, actionable recommendations for improvement",
      "- overallAssessment: a summary of the concept's viability (at least 20 characters)",
      "- readinessScore: 0-100, how ready this concept is for production",
      "",
      "Be honest and specific. Do not sugarcoat weaknesses. Do not invent strengths that are not evident from the idea.",
    ].filter(Boolean).join("\n"),
  };
}

export async function requestDiagnosis(
  transport: StageTransport,
  input: DiagnosisPrompt,
  options: StoryCallOptions = {},
): Promise<{ diagnosis: StoryDiagnosis; usage?: TokenUsage }> {
  const instructions = diagnosisInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    STORY_DIAGNOSIS_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options),
  );
  const parsed = parseStructured(transport.label, response.text, storyDiagnosisSchema, "story diagnosis");
  const diagnosis: StoryDiagnosis = {
    strengths: parsed.strengths,
    weaknesses: parsed.weaknesses,
    structuralIssues: parsed.structuralIssues,
    characterIssues: parsed.characterIssues,
    thematicIssues: parsed.thematicIssues,
    recommendations: parsed.recommendations,
    overallAssessment: parsed.overallAssessment,
    readinessScore: parsed.readinessScore,
  };
  assertDiagnosis(diagnosis);
  return { diagnosis, usage: response.usage };
}

export type ArchitecturePrompt = {
  title: string;
  idea: string;
  creativeDirection?: string;
  diagnosis: StoryDiagnosis;
  targetEpisodeCount: number;
  targetDurationSeconds: number;
};

export function architectureInstructions(input: ArchitecturePrompt): { system: string; prompt: string } {
  const guidance = diagnosisToArchitectureGuidance(input.diagnosis);
  return {
    system:
      "You are a story architect. You design the structural blueprint for a drama series based on a story concept and its diagnosis. Return one JSON object and no other text.",
    prompt: [
      `Story title: ${input.title}`,
      `Story idea:\n${input.idea}`,
      input.creativeDirection ? `Creative direction:\n${input.creativeDirection}` : "",
      `Target: ${input.targetEpisodeCount} episodes, ${input.targetDurationSeconds} seconds each.`,
      "",
      "Story diagnosis (use this to address weaknesses and preserve strengths):",
      guidance,
      "",
      "Design the story architecture:",
      "- centralConflict: the central conflict with type, stakes, and escalation path",
      "- characterArcs: arc for each major character (transformation, growth, fall, flat, redemption, tragic)",
      "- plotStructure: the overall plot structure (three_act, five_act, hero_journey, episodic, serialized, hybrid)",
      "- thematicFramework: primary theme, secondary themes, motifs, symbolism",
      "- episodeBlueprint: episode structure (procedural, serialized, hybrid), total episodes, which episodes advance the arc",
      "- pacingStrategy: pacing description, tension curve, key set pieces",
      "",
      "The architecture must be specific and actionable. It will guide the Story Bible generation.",
      "Do not contradict the story idea or creative direction.",
    ].join("\n"),
  };
}

export async function requestArchitecture(
  transport: StageTransport,
  input: ArchitecturePrompt,
  options: StoryCallOptions = {},
): Promise<{ architecture: StoryArchitecture; usage?: TokenUsage }> {
  const instructions = architectureInstructions(input);
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    STORY_ARCHITECTURE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signalOf(options),
  );
  const parsed = parseStructured(transport.label, response.text, storyArchitectureSchema, "story architecture");
  const architecture: StoryArchitecture = {
    centralConflict: {
      description: parsed.centralConflict.description,
      type: parsed.centralConflict.type ?? "man_vs_man",
      stakes: parsed.centralConflict.stakes,
      escalationPath: parsed.centralConflict.escalationPath,
    },
    characterArcs: parsed.characterArcs.map((arc) => ({
      characterName: arc.characterName,
      arcType: arc.arcType ?? "flat",
      startState: arc.startState,
      endState: arc.endState,
      keyTurningPoints: arc.keyTurningPoints ?? [],
    })),
    plotStructure: {
      structure: parsed.plotStructure.structure ?? "serialized",
      setup: parsed.plotStructure.setup,
      incitingIncident: parsed.plotStructure.incitingIncident,
      risingAction: parsed.plotStructure.risingAction,
      climax: parsed.plotStructure.climax,
      resolution: parsed.plotStructure.resolution,
    },
    thematicFramework: {
      primaryTheme: parsed.thematicFramework.primaryTheme,
      secondaryThemes: parsed.thematicFramework.secondaryThemes ?? [],
      recurringMotifs: parsed.thematicFramework.recurringMotifs ?? [],
      symbolism: parsed.thematicFramework.symbolism ?? [],
    },
    episodeBlueprint: {
      structure: parsed.episodeBlueprint.structure ?? "serialized",
      totalEpisodes: parsed.episodeBlueprint.totalEpisodes,
      arcAdvancingEpisodes: parsed.episodeBlueprint.arcAdvancingEpisodes ?? [],
      standaloneEpisodes: parsed.episodeBlueprint.standaloneEpisodes ?? [],
      cliffhangerStrategy: parsed.episodeBlueprint.cliffhangerStrategy ?? "",
    },
    pacingStrategy: {
      description: parsed.pacingStrategy.description,
      tensionCurve: parsed.pacingStrategy.tensionCurve,
      keySetPieces: parsed.pacingStrategy.keySetPieces ?? [],
    },
  };
  assertArchitecture(architecture);
  return { architecture, usage: response.usage };
}