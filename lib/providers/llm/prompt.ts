import type { StoryPrompt } from "@/lib/providers/llm/types";

export function storySystemPrompt(): string {
  return [
    "You write short cinematic drama screenplays.",
    "Return only the JSON object described by the schema.",
    "Keep the story performable in the requested duration.",
    "Write natural spoken dialogue. Do not explain the theme in the dialogue.",
    "Use two to five scenes unless the duration needs one more.",
  ].join(" ");
}

export function storyUserPrompt(input: StoryPrompt): string {
  const minutes = Math.max(1, Math.round(input.targetDurationSeconds / 60));
  return [
    `Working title: ${input.title}`,
    `Genre: ${input.genre}`,
    `Language: ${input.language}`,
    `Visual style: ${input.visualStyle}`,
    `Tone: ${input.tone}`,
    `Aspect ratio: ${input.aspectRatio}`,
    `Target duration: ${input.targetDurationSeconds} seconds, about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    "The finished drama should stay within one to three minutes unless the target says otherwise.",
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
