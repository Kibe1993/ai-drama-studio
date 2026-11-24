import type { ScreenplayScene } from "@/lib/validation/story";

export function toFountain(scenes: ScreenplayScene[], title?: string): string {
  const lines: string[] = [];
  if (title) {
    lines.push(`Title: ${title}`);
    lines.push("");
  }
  for (const scene of scenes) {
    lines.push(scene.heading);
    lines.push("");
    if (scene.visualDescription) {
      lines.push(scene.visualDescription);
      lines.push("");
    }
    if (scene.action) {
      lines.push(scene.action);
      lines.push("");
    }
    for (const dlg of scene.dialogue) {
      lines.push(dlg.characterName.toUpperCase());
      lines.push(dlg.line);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function fromFountain(text: string): ScreenplayScene[] {
  const lines = text.split("\n");
  const scenes: ScreenplayScene[] = [];
  let currentHeading = "";
  let currentLocation = "";
  let currentTimeOfDay = "";
  let currentAction = "";
  let currentVisual = "";
  let currentDialogue: Array<{ characterName: string; line: string }> = [];
  let currentCharacters: Set<string> = new Set();
  let expectingDialogue = false;
  let currentCharacter = "";
  let hasScene = false;

  function flushScene() {
    if (!hasScene) return;
    scenes.push({
      sceneNumber: scenes.length + 1,
      heading: currentHeading || "INT. SCENE - DAY",
      location: currentLocation || "UNKNOWN",
      timeOfDay: currentTimeOfDay || "DAY",
      charactersPresent: Array.from(currentCharacters).length > 0 ? Array.from(currentCharacters) : ["UNKNOWN"],
      visualDescription: currentVisual || "Scene description",
      action: currentAction || "Action description",
      dialogue: currentDialogue,
    });
    currentHeading = "";
    currentLocation = "";
    currentTimeOfDay = "";
    currentAction = "";
    currentVisual = "";
    currentDialogue = [];
    currentCharacters = new Set();
    hasScene = false;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      expectingDialogue = false;
      continue;
    }

    const isHeading = /^(INT\.|EXT\.|INT\/EXT\.|EST\.)/i.test(line);
    if (isHeading) {
      flushScene();
      currentHeading = line;
      const parts = line.split(" - ");
      currentLocation = parts[0]?.replace(/^(INT\.|EXT\.|INT\/EXT\.|EST\.)\s*/i, "").trim() || "UNKNOWN";
      currentTimeOfDay = parts[1]?.trim() || "DAY";
      hasScene = true;
      expectingDialogue = false;
      continue;
    }

    if (!hasScene) {
      currentHeading = "INT. SCENE - DAY";
      currentLocation = "UNKNOWN";
      currentTimeOfDay = "DAY";
      hasScene = true;
    }

    const isCharacter = /^[A-Z][A-Z\s.'-]+$/.test(line) && line.length < 40;
    if (isCharacter && !expectingDialogue) {
      currentCharacter = line;
      currentCharacters.add(line);
      expectingDialogue = true;
      continue;
    }

    if (expectingDialogue) {
      if (line.startsWith("(") && line.endsWith(")")) {
        continue;
      }
      currentDialogue.push({ characterName: currentCharacter, line });
      continue;
    }

    if (!currentAction) {
      currentAction = line;
    } else {
      currentAction += "\n" + line;
    }
  }

  flushScene();
  return scenes;
}