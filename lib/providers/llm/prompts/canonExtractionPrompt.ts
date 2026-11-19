import type { ScreenplayScene } from "@/lib/validation/story";
import type { DerivedCanonState } from "@/lib/canon/schema";

export type CanonFactExtractionPromptInput = {
  seriesTitle: string;
  episodeNumber: number;
  screenplay: ScreenplayScene[];
  currentCanon: DerivedCanonState | null;
};

export function formatScreenplayForExtraction(screenplay: ScreenplayScene[]): string {
  return screenplay
    .map((scene) => {
      const lines: string[] = [
        `SCENE ${scene.sceneNumber}: ${scene.heading}`,
        `LOCATION: ${scene.location}`,
        `TIME: ${scene.timeOfDay}`,
        `CHARACTERS: ${scene.charactersPresent.join(", ")}`,
        `VISUAL: ${scene.visualDescription}`,
        `ACTION: ${scene.action}`,
      ];
      if (scene.dialogue.length > 0) {
        lines.push("DIALOGUE:");
        for (const line of scene.dialogue) {
          lines.push(`  ${line.characterName}: ${line.line}`);
        }
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function compactCanonSummary(state: DerivedCanonState | null): string {
  if (!state) return "(no canon yet)";
  const lines: string[] = [];

  if (state.entities.length > 0) {
    lines.push(
      "Entities: " +
        state.entities
          .map((e) => `${e.name} (${e.kind}, ${e.lifecycle})`)
          .join("; "),
    );
  }
  if (state.events.length > 0) {
    lines.push(
      "Events: " +
        state.events.map((e) => `${e.id}: ${e.description}`).join("; "),
    );
  }
  if (state.facts.length > 0) {
    lines.push(
      "Facts: " +
        state.facts.map((f) => `${f.id}: ${f.statement}`).join("; "),
    );
  }
  if (state.relationships.length > 0) {
    lines.push(
      "Relationships: " +
        state.relationships
          .map((r) => `${r.characterIds.join("↔")}: ${r.relationshipType}`)
          .join("; "),
    );
  }
  if (state.threads.length > 0) {
    lines.push(
      "Threads: " +
        state.threads.map((t) => `${t.id}: ${t.description}`).join("; "),
    );
  }

  return lines.length > 0 ? lines.join("\n") : "(canon is empty)";
}

export function buildCanonFactExtractionPrompt(
  input: CanonFactExtractionPromptInput,
): { system: string; prompt: string } {
  const screenplayText = formatScreenplayForExtraction(input.screenplay);
  const canonSummary = compactCanonSummary(input.currentCanon);

  const system = [
    "You are a canon extraction analyst for a serialized drama.",
    "Your job is to read an approved screenplay and extract structured canon facts",
    "that are concretely present in the text — entities, relationships, events, threads,",
    "facts, knowledge entries, and world rules.",
    "",
    "Rules:",
    "1. Extract only what is directly shown or stated in the screenplay. Never infer.",
    "2. For each fact, provide a `quote` that is a VERBATIM substring of the screenplay text.",
    "   The quote must appear exactly once in the cited scene so it can be located.",
    "3. Provide `sceneNumber` matching the scene where the quote appears.",
    "4. For dialogue, set `asserterId` to the speaking character's ID and `narrativeMode` to",
    "   the scene's mode (present, flashback, dream, vision).",
    "5. For action/visual text, provide `eventType`:",
    "   - `concrete` for definite physical events (e.g., 'Alice picks up the photo')",
    "   - `perceptual` for subjective perceptions (e.g., 'Alice sees a shadow')",
    "   - `ambiguous` if unclear",
    "6. Provide `narrativeMode` based on structural markers (FLASHBACK, DREAM, VISION)",
    "   or context. Use `present` for normal scenes.",
    "7. Provide `confidence` (0.0–1.0) for your extraction certainty. This is for auditing",
    "   only and does NOT affect classification.",
    "8. Do not duplicate facts already in the current canon.",
    "9. If nothing worth extracting is present, return an empty facts array.",
    "10. Use stable IDs for `targetId` (e.g., 'char-alice', 'evt-photo-found').",
  ].join("\n");

  const prompt = [
    `Series: ${input.seriesTitle}`,
    `Episode: ${input.episodeNumber}`,
    "",
    "Current canon (do not duplicate these):",
    canonSummary,
    "",
    "Approved screenplay:",
    screenplayText,
    "",
    "Extract canon facts from the screenplay that are NOT already in the current canon.",
    "Return a JSON object: { \"facts\": [ { kind, targetId, payload, narrativeMode,",
    "eventType, confidence, quote, sceneNumber, asserterId, reason } ] }",
  ].join("\n");

  return { system, prompt };
}