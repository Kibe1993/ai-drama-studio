import type { StoryPrompt } from "@/lib/providers/llm/types";
import { PRODUCTION_TYPES } from "@/lib/domain/projectCatalog";
import { resolveSceneRange, type SceneRange } from "@/lib/providers/llm/budget";

export function storySystemPrompt(): string {
  return [
    "You write complete, production-ready cinematic screenplays.",
    "Return only the JSON object described by the schema.",
    "Write a fully developed episode with a compelling opening, meaningful character introductions, escalating dramatic tension, character decisions with consequences, a developed climax, and a satisfying resolution or deliberate cliffhanger.",
    "Every scene must advance the story. Do not write filler scenes or scenes that only repeat information already established.",
    "Show events happening through action and dialogue. Do not have characters explain things they already know to each other.",
    "Write natural spoken dialogue that reveals character, advances conflict, or discloses subtext.",
    "Scale scene count, action length, and dialogue to the requested target duration. Do not rush or pad.",
  ].join(" ");
}

/**
 * Derive a concrete scene-count guidance range from the target duration.
 * The range is shared with validation so the prompt and the pacing gate agree.
 */
export function sceneCountGuidance(targetDurationSeconds: number, sceneRange?: SceneRange | null): string {
  const minutes = targetDurationSeconds / 60;
  const { min, max } = resolveSceneRange(targetDurationSeconds, sceneRange);
  return `Write ${min}–${max} screenplay scenes to fill the requested ${Math.round(minutes)}-minute duration. Never produce only one scene unless the episode is under 60 seconds and the story is already complete.`;
}

export function storyUserPrompt(input: StoryPrompt): string {
  const minutes = Math.max(1, Math.round(input.targetDurationSeconds / 60));
  const category = PRODUCTION_TYPES.find((item) => item.id === input.productionType) ?? PRODUCTION_TYPES[0];
  return [
    `Content category: ${category.label}`,
    `Category direction: ${category.description}`,
    `Category example (inspiration only): ${category.example}`,
    `Working title: ${input.title}`,
    `Genre: ${input.genre}`,
    `Language: ${input.language}`,
    `Visual style: ${input.visualStyle}`,
    `Tone: ${input.tone}`,
    `Aspect ratio: ${input.aspectRatio}`,
    `Target duration: ${input.targetDurationSeconds} seconds, about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    "The requested target duration is authoritative, including targets longer than three minutes.",
    sceneCountGuidance(input.targetDurationSeconds, input.sceneRange),
    ...(category.id === "documentary_educational"
      ? ["For documentary-style or educational output, do not invent factual claims, quotations, sources, or historical details. Mark claims that require research as requiring verification; this application does not yet provide a research-verification stage."]
      : []),
    ...(input.narrativeAuthority?.trim()
      ? [input.narrativeAuthority.trim()]
      : []),
    ...(input.continuityContext?.trim()
      ? ["Approved Story Bible context (follow these established facts and boundaries):", input.continuityContext.trim()]
      : []),
    ...(input.seasonPlan
      ? ["Approved Season Plan (the season's direction; your episode must serve it):", JSON.stringify(input.seasonPlan)]
      : []),
    ...(input.episodePlan
      ? ["Episode-specific plan (write exactly this episode; do not skip or reorder its developments):", JSON.stringify(input.episodePlan)]
      : []),
    ...(input.continuityLedger
      ? ["Established canon from earlier approved episodes (never contradict it):", JSON.stringify(input.continuityLedger)]
      : []),
    ...(input.previousEpisode
      ? [`The immediately previous approved episode was ${input.previousEpisode.episodeNumber}: "${input.previousEpisode.title}" — ${input.previousEpisode.synopsis}`, "Continue from that ending. Do not restage its events."]
      : []),
    ...(input.seasonPlan || input.episodePlan || input.continuityLedger
      ? [
          "This is one episode of a continuous story. It must inherit what earlier episodes established, advance the season meaningfully, create consequences that later episodes will carry, and end where the plan says it ends.",
          "Do not repeat a conflict, discovery, decision, or cliffhanger that an approved earlier episode already used.",
        ]
      : []),
    "Story idea:",
    input.idea.trim() || "A short family conflict with a private choice at the center.",
    "Structure the drama in three acts.",
    "Act 1 — Setup: introduce the main characters and their world, establish the setting, present the initial situation, and deliver a clear inciting incident that disrupts the status quo.",
    "Act 2 — Conflict: build rising tension through escalating obstacles, force meaningful character decisions, and reach a turning point that changes the story's direction.",
    "Act 3 — Resolution: build to a climax that resolves the central conflict, then deliver a resolution and a final outcome that earns its emotional weight.",
    "Distribute scenes across all three acts. Do not write only an Act 1 opening unless the story is too short for a full three-act structure.",
    "Each screenplay scene requires: sceneNumber (integer, starting at 1), heading (slugline format e.g. EXT. MARKET - DUSK), location, timeOfDay, charactersPresent (array of names who are physically present), visualDescription (what the camera sees — environment, light, mood), action (what the characters physically do), and dialogue (array of {characterName, line} objects).",
    "Characters should speak naturally. Avoid exposition dumps where characters explain their own backstory to people who already know it.",
    "Return one JSON object with exactly these keys: title, synopsis, structure, screenplay.",
    "synopsis is one paragraph summarising the whole episode including its ending.",
    "structure.act1 requires introduction, mainCharacters, setting, initialSituation, and incitingIncident.",
    "structure.act2 requires risingTension, obstacles, characterDecisions, and turningPoint.",
    "structure.act3 requires climax, resolution, and finalOutcome.",
    "screenplay is an array of scenes as described above.",
  ].join("\n");
}
