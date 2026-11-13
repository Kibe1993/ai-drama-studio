function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return {};
}

function firstText(source: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const found = text(source[name]);
    if (found) return found;
  }
  return "";
}

function repairAct(value: unknown, fields: readonly string[], aliases: Record<string, string[]>): Record<string, string> {
  const source = typeof value === "string" ? { [fields[0] ?? "introduction"]: value } : record(value);
  return Object.fromEntries(fields.map((field) => [field, firstText(source, [field, ...(aliases[field] ?? [])])]));
}

function repairDialogue(value: unknown): { characterName: string; line: string }[] {
  if (typeof value === "string") {
    const line = value.trim();
    return line ? [{ characterName: "Narrator", line }] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") {
      const line = item.trim();
      return line ? [{ characterName: "Narrator", line }] : [];
    }
    const row = record(item);
    const line = firstText(row, ["line", "text", "dialogue", "speech"]);
    const characterName = firstText(row, ["characterName", "character", "speaker", "name"]);
    if (!line || !characterName) return [];
    return [{ characterName, line }];
  });
}

function namesFrom(value: unknown, dialogue: { characterName: string }[]): string[] {
  const collected = Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : text(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  if (collected.length > 0) return collected.slice(0, 8);
  const speakers = [...new Set(dialogue.map((item) => item.characterName))];
  return speakers.length > 0 ? speakers.slice(0, 8) : ["Narrator"];
}

const ACT1 = ["introduction", "mainCharacters", "setting", "initialSituation", "incitingIncident"] as const;
const ACT2 = ["risingTension", "obstacles", "characterDecisions", "turningPoint"] as const;
const ACT3 = ["climax", "resolution", "finalOutcome"] as const;

const ACT_ALIASES: Record<string, string[]> = {
  introduction: ["intro", "setup"],
  mainCharacters: ["main_characters", "characters"],
  initialSituation: ["initial_situation", "situation"],
  incitingIncident: ["inciting_incident", "incident"],
  risingTension: ["rising_tension", "tension"],
  characterDecisions: ["character_decisions", "decisions"],
  turningPoint: ["turning_point"],
  finalOutcome: ["final_outcome", "outcome"],
};

/** Resolve the object that actually holds the story fields, unwrapping one nesting level. */
function storySource(value: unknown): Record<string, unknown> {
  const root = record(value);
  const nested = record(root.story ?? root.data ?? root.result);
  return firstText(nested, ["title"]) && !firstText(root, ["title"]) ? nested : root;
}

/** The raw screenplay array a payload holds, accepting either key name. */
export function screenplaySource(value: unknown): unknown[] {
  const source = storySource(value);
  const scenes = source.screenplay ?? source.scenes;
  return Array.isArray(scenes) ? scenes : [];
}

/**
 * How many screenplay entries the raw payload declared, before repair drops
 * any that carried no content. A repaired count below this means the model
 * returned scenes that were incomplete, which is how a truncated screenplay
 * reaches us as valid JSON.
 */
export function screenplayEntryCount(value: unknown): number {
  return screenplaySource(value).length;
}

/** Coerce the loose shapes Groq emits. Empty story content stays empty so Zod can reject it. */
export function repairStoryPayload(value: unknown): unknown {
  const source = storySource(value);
  const structure = record(source.structure ?? source.acts);
  const act1 = repairAct(structure.act1 ?? structure.act_1, ACT1, ACT_ALIASES);
  const screenplay = repairScreenplayScenes(source.screenplay ?? source.scenes);
  const synopsis = firstText(source, ["synopsis", "summary", "logline", "description"]) || act1.introduction || "";
  return {
    title: firstText(source, ["title", "name"]) || synopsis.slice(0, 120),
    synopsis,
    structure: {
      act1,
      act2: repairAct(structure.act2 ?? structure.act_2, ACT2, ACT_ALIASES),
      act3: repairAct(structure.act3 ?? structure.act_3, ACT3, ACT_ALIASES),
    },
    screenplay,
  };
}

export function repairScreenplayScenes(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((scene, index) => {
    const row = record(scene);
    const dialogue = repairDialogue(row.dialogue ?? row.lines);
    const visualDescription = firstText(row, ["visualDescription", "visual_description", "visual", "description"]);
    const action = firstText(row, ["action", "actionText"]);
    const seen = visualDescription || action;
    const spoken = dialogue[0]?.line ?? "";
    if (!seen && !spoken) return [];
    const sceneNumber = Number(row.sceneNumber ?? row.scene_number ?? index + 1);
    const heading = firstText(row, ["heading", "slugline"]) || `Scene ${index + 1}`;
    const location = firstText(row, ["location", "place"]) || heading;
    return [
      {
        sceneNumber: Number.isInteger(sceneNumber) && sceneNumber > 0 ? sceneNumber : index + 1,
        heading,
        location,
        timeOfDay: firstText(row, ["timeOfDay", "time_of_day", "time"]) || "unspecified",
        charactersPresent: namesFrom(row.charactersPresent ?? row.characters_present ?? row.characters, dialogue),
        visualDescription: visualDescription || action || spoken,
        action: action || visualDescription || spoken,
        dialogue,
      },
    ];
  });
}
