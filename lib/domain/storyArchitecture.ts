import { JobError } from "@/lib/pipeline/types";
import type {
  StoryDiagnosis,
  StoryArchitecture,
  CharacterArc,
  EpisodeBlueprint,
} from "@/lib/validation/storyArchitecture";

export function assertDiagnosis(diagnosis: StoryDiagnosis): void {
  if (diagnosis.strengths.length === 0 && diagnosis.weaknesses.length === 0) {
    throw new JobError(
      "Story diagnosis must identify at least one strength or weakness.",
      "invalid_schema",
      false,
    );
  }
  if (diagnosis.overallAssessment.trim().length < 20) {
    throw new JobError(
      "Story diagnosis overall assessment is too brief.",
      "invalid_schema",
      false,
    );
  }
}

export function assertArchitecture(architecture: StoryArchitecture): void {
  if (architecture.characterArcs.length === 0) {
    throw new JobError(
      "Story architecture must include at least one character arc.",
      "invalid_schema",
      false,
    );
  }
  const names = architecture.characterArcs.map((arc) => arc.characterName.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    throw new JobError(
      "Character arcs must not repeat a character name.",
      "invalid_schema",
      false,
    );
  }
  assertEpisodeBlueprint(architecture.episodeBlueprint);
}

export function assertEpisodeBlueprint(blueprint: EpisodeBlueprint): void {
  const all = [...blueprint.arcAdvancingEpisodes, ...blueprint.standaloneEpisodes];
  const unique = new Set(all);
  if (unique.size !== all.length) {
    throw new JobError(
      "An episode cannot be both arc-advancing and standalone.",
      "invalid_schema",
      false,
    );
  }
  for (const ep of all) {
    if (ep < 1 || ep > blueprint.totalEpisodes) {
      throw new JobError(
        `Episode ${ep} is out of range (1-${blueprint.totalEpisodes}).`,
        "invalid_schema",
        false,
      );
    }
  }
}

export function deriveSeasonFocus(
  architecture: StoryArchitecture,
  episodeNumber: number,
): { isArcAdvancing: boolean; arcFocus: CharacterArc | null } {
  const isArcAdvancing = architecture.episodeBlueprint.arcAdvancingEpisodes.includes(episodeNumber);
  const arcFocus = architecture.characterArcs.find((arc) =>
    arc.keyTurningPoints.some((point) =>
      point.toLowerCase().includes(`episode ${episodeNumber}`),
    ),
  ) ?? null;
  return { isArcAdvancing, arcFocus };
}

export function diagnosisToArchitectureGuidance(diagnosis: StoryDiagnosis): string {
  const lines: string[] = [];
  if (diagnosis.strengths.length > 0) {
    lines.push(`Strengths to preserve:\n${diagnosis.strengths.map((s) => `- ${s}`).join("\n")}`);
  }
  if (diagnosis.weaknesses.length > 0) {
    lines.push(`Weaknesses to address:\n${diagnosis.weaknesses.map((s) => `- ${s}`).join("\n")}`);
  }
  if (diagnosis.structuralIssues.length > 0) {
    lines.push(`Structural issues to fix:\n${diagnosis.structuralIssues.map((s) => `- ${s}`).join("\n")}`);
  }
  if (diagnosis.characterIssues.length > 0) {
    lines.push(`Character issues to fix:\n${diagnosis.characterIssues.map((s) => `- ${s}`).join("\n")}`);
  }
  if (diagnosis.recommendations.length > 0) {
    lines.push(`Recommendations to follow:\n${diagnosis.recommendations.map((s) => `- ${s}`).join("\n")}`);
  }
  lines.push(`Readiness score: ${diagnosis.readinessScore}/100`);
  return lines.join("\n\n");
}

export function architectureToBibleGuidance(architecture: StoryArchitecture): string {
  const lines: string[] = [];
  lines.push(`Central conflict: ${architecture.centralConflict.description}`);
  lines.push(`Conflict type: ${architecture.centralConflict.type}`);
  lines.push(`Stakes: ${architecture.centralConflict.stakes}`);
  lines.push(`Escalation: ${architecture.centralConflict.escalationPath}`);
  lines.push("");
  lines.push(`Plot structure: ${architecture.plotStructure.structure}`);
  lines.push(`Setup: ${architecture.plotStructure.setup}`);
  lines.push(`Inciting incident: ${architecture.plotStructure.incitingIncident}`);
  lines.push(`Rising action: ${architecture.plotStructure.risingAction}`);
  lines.push(`Climax: ${architecture.plotStructure.climax}`);
  lines.push(`Resolution: ${architecture.plotStructure.resolution}`);
  lines.push("");
  lines.push(`Primary theme: ${architecture.thematicFramework.primaryTheme}`);
  if (architecture.thematicFramework.secondaryThemes.length > 0) {
    lines.push(`Secondary themes: ${architecture.thematicFramework.secondaryThemes.join(", ")}`);
  }
  lines.push("");
  for (const arc of architecture.characterArcs) {
    lines.push(`Character arc — ${arc.characterName} (${arc.arcType}):`);
    lines.push(`  Start: ${arc.startState}`);
    lines.push(`  End: ${arc.endState}`);
    if (arc.keyTurningPoints.length > 0) {
      lines.push(`  Turning points: ${arc.keyTurningPoints.join("; ")}`);
    }
  }
  lines.push("");
  lines.push(`Episode blueprint: ${architecture.episodeBlueprint.structure}, ${architecture.episodeBlueprint.totalEpisodes} episodes`);
  if (architecture.episodeBlueprint.arcAdvancingEpisodes.length > 0) {
    lines.push(`Arc-advancing episodes: ${architecture.episodeBlueprint.arcAdvancingEpisodes.join(", ")}`);
  }
  if (architecture.episodeBlueprint.cliffhangerStrategy) {
    lines.push(`Cliffhanger strategy: ${architecture.episodeBlueprint.cliffhangerStrategy}`);
  }
  return lines.join("\n");
}