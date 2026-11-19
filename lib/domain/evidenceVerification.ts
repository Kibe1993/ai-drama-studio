import type { ScreenplayScene } from "@/lib/validation/story";

export type EvidenceElementType =
  | "heading"
  | "location"
  | "timeOfDay"
  | "visualDescription"
  | "action"
  | "dialogue";

export type EvidenceLocator = {
  sceneNumber: number;
  elementType: EvidenceElementType;
  elementIndex: number;
  charStart: number;
  charEnd: number;
};

const ELEMENT_TYPE_RANK: Record<EvidenceElementType, number> = {
  heading: 0,
  location: 1,
  timeOfDay: 2,
  visualDescription: 3,
  action: 4,
  dialogue: 5,
};

export function computeEvidencePosition(locator: EvidenceLocator): number {
  return (
    locator.sceneNumber * 1_000_000 +
    ELEMENT_TYPE_RANK[locator.elementType] * 100_000 +
    locator.elementIndex * 1_000 +
    locator.charStart
  );
}

export type EvidenceVerificationResult =
  | { ok: true; locator: EvidenceLocator }
  | {
      ok: false;
      code: "quote_not_found" | "quote_ambiguous";
      occurrences: EvidenceLocator[];
    };

function findOccurrences(
  text: string,
  quote: string,
  sceneNumber: number,
  elementType: EvidenceElementType,
  elementIndex: number,
): EvidenceLocator[] {
  const occurrences: EvidenceLocator[] = [];
  let fromIndex = 0;
  while (true) {
    const idx = text.indexOf(quote, fromIndex);
    if (idx === -1) break;
    occurrences.push({
      sceneNumber,
      elementType,
      elementIndex,
      charStart: idx,
      charEnd: idx + quote.length,
    });
    fromIndex = idx + 1;
  }
  return occurrences;
}

export function verifyEvidenceInScene(
  scene: ScreenplayScene,
  quote: string,
): EvidenceVerificationResult {
  const all: EvidenceLocator[] = [];

  all.push(...findOccurrences(scene.heading, quote, scene.sceneNumber, "heading", 0));
  all.push(...findOccurrences(scene.location, quote, scene.sceneNumber, "location", 0));
  all.push(...findOccurrences(scene.timeOfDay, quote, scene.sceneNumber, "timeOfDay", 0));
  all.push(
    ...findOccurrences(
      scene.visualDescription,
      quote,
      scene.sceneNumber,
      "visualDescription",
      0,
    ),
  );
  all.push(...findOccurrences(scene.action, quote, scene.sceneNumber, "action", 0));
  for (let i = 0; i < scene.dialogue.length; i += 1) {
    const line = scene.dialogue[i];
    if (!line) continue;
    const fullLine = `${line.characterName}: ${line.line}`;
    all.push(...findOccurrences(fullLine, quote, scene.sceneNumber, "dialogue", i));
  }

  if (all.length === 0) {
    return { ok: false, code: "quote_not_found", occurrences: [] };
  }
  if (all.length > 1) {
    return { ok: false, code: "quote_ambiguous", occurrences: all };
  }
  return { ok: true, locator: all[0] };
}