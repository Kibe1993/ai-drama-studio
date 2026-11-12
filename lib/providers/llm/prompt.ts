import type { StoryPrompt } from "@/lib/providers/llm/types";
import { PRODUCTION_TYPES } from "@/lib/domain/projectCatalog";

export function storySystemPrompt(): string {
  return [
    "You write cinematic scripts at the requested target length and category.",
    "Return only the JSON object described by the schema.",
    "Keep the story performable in the requested duration.",
    "Write natural spoken dialogue. Do not explain the theme in the dialogue.",
    "Scale scene count, action, and dialogue to the requested target duration without padding or rushing the story.",
  ].join(" ");
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
    ...(category.id === "documentary_educational"
      ? ["For documentary-style or educational output, do not invent factual claims, quotations, sources, or historical details. Mark claims that require research as requiring verification; this application does not yet provide a research-verification stage."]
      : []),
    ...(input.continuityContext?.trim()
      ? ["Approved Story Bible context (follow these established facts and boundaries):", input.continuityContext.trim()]
      : []),
    "Story idea:",
    input.idea.trim() || "A short family conflict with a private choice at the center.",
    "Structure the drama in three acts.",
    "Act 1 is setup: introduction, main characters, setting, initial situation, and inciting incident.",
    "Act 2 is conflict: rising tension, obstacles, character decisions, and a turning point.",
    "Act 3 is resolution: climax, resolution, and final outcome.",
    "The screenplay scenes need a heading, location, time of day, who is present, what the camera sees, what the characters do, and spoken lines.",
    "Return one JSON object with exactly these keys: title, synopsis, structure, screenplay.",
    "synopsis is one paragraph.",
    "structure.act1 requires introduction, mainCharacters, setting, initialSituation, and incitingIncident.",
    "structure.act2 requires risingTension, obstacles, characterDecisions, and turningPoint.",
    "structure.act3 requires climax, resolution, and finalOutcome.",
    "screenplay is an array of scenes. Each scene requires sceneNumber, heading, location, timeOfDay, charactersPresent, visualDescription, action, and dialogue.",
    "dialogue is an array of objects with characterName and line.",
  ].join("\n");
}
