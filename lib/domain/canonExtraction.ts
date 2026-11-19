import type { ScreenplayScene } from "@/lib/validation/story";
import type { ContinuityLedger, CharacterState } from "@/lib/validation/continuityLedger";
import type { CanonExtractionResponse, CanonSuggestion } from "@/lib/validation/canonExtraction";

/**
 * Flatten a screenplay into the text the extraction model reads. Only the
 * narrative content is included — scene numbers and structural metadata are
 * omitted to keep the prompt focused on what characters say and do.
 */
export function screenplayToText(screenplay: ScreenplayScene[]): string {
  return screenplay
    .map((scene) => {
      const dialogue = scene.dialogue
        .map((line) => `${line.characterName}: ${line.line}`)
        .join("\n");
      return [
        scene.heading,
        scene.visualDescription,
        scene.action,
        dialogue,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

/**
 * Build the system and user prompt for the LLM canon extraction pass.
 *
 * The system prompt instructs the model to extract only canon facts that are
 * concretely present in the screenplay text — never to infer or invent. The
 * user prompt provides the screenplay text and a compact view of what the
 * ledger already records, so the model can avoid duplicating existing canon.
 */
export function buildCanonExtractionPrompt(input: {
  screenplay: ScreenplayScene[];
  ledger: ContinuityLedger | null;
  episodeNumber: number;
  seriesTitle: string;
}): { system: string; prompt: string } {
  const screenplayText = screenplayToText(input.screenplay);
  const ledgerSummary = compactLedgerForPrompt(input.ledger);

  const system = [
    "You are a canon extraction analyst for a serialized drama.",
    "Your job is to read an approved screenplay and extract structured continuity facts",
    "that are concretely present in the text — events that happen, knowledge characters",
    "express through dialogue, beliefs and motivations they state, relationships that",
    "change, secrets that are revealed, and threads that open or resolve.",
    "Rules:",
    "1. Extract only what is directly shown or stated in the screenplay. Never infer.",
    "2. Do not duplicate facts already in the continuity ledger.",
    "3. If nothing worth extracting is present, return all arrays empty.",
    "4. Keep each text field concise — one sentence where possible.",
    "5. Use character names exactly as they appear in the screenplay.",
  ].join(" ");

  const prompt = [
    `Series: ${input.seriesTitle}`,
    `Episode: ${input.episodeNumber}`,
    "",
    "Current continuity ledger (do not duplicate these):",
    ledgerSummary,
    "",
    "Approved screenplay:",
    screenplayText,
    "",
    "Extract canon facts from the screenplay that are NOT already in the ledger.",
    "Return a JSON object with the fields defined in the output contract.",
  ].join("\n");

  return { system, prompt };
}

function compactLedgerForPrompt(ledger: ContinuityLedger | null): string {
  if (!ledger) return "(no ledger yet)";

  const lines: string[] = [];

  if (ledger.events.length > 0) {
    lines.push("Events:");
    for (const event of ledger.events.slice(-8)) {
      lines.push(`  - E${event.episodeNumber}: ${event.event} → ${event.consequence}`);
    }
  }

  if (ledger.characterStates.length > 0) {
    lines.push("Character states:");
    for (const state of ledger.characterStates) {
      const knowledge = state.knowledge.length > 0 ? ` knows: ${state.knowledge.join("; ")}` : "";
      const beliefs = state.beliefs.length > 0 ? ` believes: ${state.beliefs.join("; ")}` : "";
      lines.push(`  - ${state.name} at ${state.currentLocation}, goal: ${state.currentObjective}${knowledge}${beliefs}`);
    }
  }

  if (ledger.revealedSecrets.length > 0) {
    lines.push(`Revealed secrets: ${ledger.revealedSecrets.join("; ")}`);
  }

  if (ledger.unresolvedThreads.length > 0) {
    lines.push("Unresolved threads:");
    for (const thread of ledger.unresolvedThreads) {
      lines.push(`  - [${thread.status}] ${thread.thread}`);
    }
  }

  if (ledger.consequences.length > 0) {
    lines.push(`Consequences: ${ledger.consequences.join("; ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "(ledger is empty)";
}

/**
 * Filter an extraction response to remove facts that are already in the ledger.
 * Uses the same normalization as the ledger merge (case-insensitive, whitespace
 * collapsed) so "Bob hid the document" and "bob  hid the document" are treated
 * as duplicates.
 */
export function diffCanonSuggestions(
  response: CanonExtractionResponse,
  ledger: ContinuityLedger | null
): CanonExtractionResponse {
  if (!ledger) return response;

  const existingEvents = new Set(
    ledger.events.map((e) => normalize(e.event))
  );
  const existingSecrets = new Set(
    ledger.revealedSecrets.map(normalize)
  );
  const existingThreads = new Set(
    ledger.unresolvedThreads.map((t) => normalize(t.thread))
  );
  const existingLocations = new Set(
    ledger.locationStates.map((l) => normalize(l.name))
  );
  const existingObjects = new Set(
    ledger.objectStates.map((o) => normalize(o.name))
  );
  const characterByName = new Map<string, CharacterState>();
  for (const state of ledger.characterStates) {
    characterByName.set(normalize(state.name), state);
  }

  return {
    events: response.events.filter((e) => !existingEvents.has(normalize(e.event))),
    characterKnowledge: response.characterKnowledge
      .map((entry) => {
        const existing = characterByName.get(normalize(entry.characterName));
        if (!existing) return entry;
        const existingKnowledge = new Set(existing.knowledge.map(normalize));
        const newKnowledge = entry.knowledge.filter((k) => !existingKnowledge.has(normalize(k)));
        return { characterName: entry.characterName, knowledge: newKnowledge };
      })
      .filter((entry) => entry.knowledge.length > 0),
    characterBeliefs: response.characterBeliefs
      .map((entry) => {
        const existing = characterByName.get(normalize(entry.characterName));
        if (!existing) return entry;
        const existingBeliefs = new Set(existing.beliefs.map(normalize));
        const newBeliefs = entry.beliefs.filter((b) => !existingBeliefs.has(normalize(b)));
        return { characterName: entry.characterName, beliefs: newBeliefs };
      })
      .filter((entry) => entry.beliefs.length > 0),
    characterMotivations: response.characterMotivations
      .map((entry) => {
        const existing = characterByName.get(normalize(entry.characterName));
        if (!existing) return entry;
        const existingMotivations = new Set(existing.motivations.map(normalize));
        const newMotivations = entry.motivations.filter((m) => !existingMotivations.has(normalize(m)));
        return { characterName: entry.characterName, motivations: newMotivations };
      })
      .filter((entry) => entry.motivations.length > 0),
    relationshipChanges: response.relationshipChanges
      .map((entry) => {
        const existing = characterByName.get(normalize(entry.characterName));
        if (!existing) return entry;
        const existingRels = new Set(
          existing.relationships.map((r) => `${normalize(r.characterName)}:${normalize(r.relationship)}`)
        );
        const newRels = entry.relationships.filter(
          (r) => !existingRels.has(`${normalize(r.characterName)}:${normalize(r.relationship)}`)
        );
        return { characterName: entry.characterName, relationships: newRels };
      })
      .filter((entry) => entry.relationships.length > 0),
    revealedSecrets: response.revealedSecrets.filter((s) => !existingSecrets.has(normalize(s))),
    unresolvedThreads: response.unresolvedThreads.filter(
      (t) => !existingThreads.has(normalize(t.thread))
    ),
    locationStates: response.locationStates.filter(
      (l) => !existingLocations.has(normalize(l.name))
    ),
    objectStates: response.objectStates.filter(
      (o) => !existingObjects.has(normalize(o.name))
    ),
  };
}

/**
 * Merge accepted canon suggestions into a Continuity Ledger. This is a pure
 * function — it returns a new ledger and never mutates the input.
 *
 * Character knowledge, beliefs, and motivations are appended to the existing
 * character state (deduplicated by normalization). Relationship changes
 * replace the relationships array for that character. Events, secrets, threads,
 * locations, and objects are merged by the same rules as applyCanonToLedger.
 */
export function applyCanonSuggestions(
  ledger: ContinuityLedger,
  suggestion: CanonSuggestion,
  episodeNumber: number
): ContinuityLedger {
  const events = [
    ...ledger.events,
    ...suggestion.events.map((event) => ({
      episodeNumber,
      event: event.event,
      consequence: event.consequence,
      affectedCharacters: event.affectedCharacters,
      revealedInformation: event.revealedInformation,
    })),
  ].slice(-200);

  const characterStates = mergeCharacterUpdates(
    ledger.characterStates,
    suggestion
  );

  const locationStates = mergeByName(
    ledger.locationStates,
    suggestion.locationStates
  );

  const objectStates = mergeByName(
    ledger.objectStates,
    suggestion.objectStates
  );

  const revealedSecrets = appendUnique(
    ledger.revealedSecrets,
    suggestion.revealedSecrets,
    20
  );

  const unresolvedThreads = mergeThreads(
    ledger.unresolvedThreads,
    suggestion.unresolvedThreads
  );


  return {
    events,
    characterStates,
    locationStates,
    objectStates,
    revealedSecrets,
    unresolvedThreads,
    consequences: ledger.consequences,
    timelineNotes: ledger.timelineNotes,
  };
}

/**
 * Check whether an extraction response contains any non-empty arrays.
 * Used to decide whether to store the suggestion for creator review.
 */
export function hasSuggestionContent(response: CanonExtractionResponse): boolean {
  return (
    response.events.length > 0 ||
    response.characterKnowledge.length > 0 ||
    response.characterBeliefs.length > 0 ||
    response.characterMotivations.length > 0 ||
    response.relationshipChanges.length > 0 ||
    response.revealedSecrets.length > 0 ||
    response.unresolvedThreads.length > 0 ||
    response.locationStates.length > 0 ||
    response.objectStates.length > 0
  );
}

/**
 * Return an empty extraction response — all arrays empty.
 * Used as a fallback when the LLM call fails or returns nothing.
 */
export function emptyCanonExtractionResponse(): CanonExtractionResponse {
  return {
    events: [],
    characterKnowledge: [],
    characterBeliefs: [],
    characterMotivations: [],
    relationshipChanges: [],
    revealedSecrets: [],
    unresolvedThreads: [],
    locationStates: [],
    objectStates: [],
  };
}

function mergeCharacterUpdates(
  existing: CharacterState[],
  suggestion: CanonSuggestion
): CharacterState[] {
  const map = new Map<string, CharacterState>();
  for (const state of existing) map.set(normalize(state.name), state);

  for (const entry of suggestion.characterKnowledge) {
    const key = normalize(entry.characterName);
    const current = map.get(key);
    if (current) {
      map.set(key, {
        ...current,
        knowledge: appendUnique(current.knowledge, entry.knowledge, 12),
      });
    }
  }

  for (const entry of suggestion.characterBeliefs) {
    const key = normalize(entry.characterName);
    const current = map.get(key);
    if (current) {
      map.set(key, {
        ...current,
        beliefs: appendUnique(current.beliefs, entry.beliefs, 8),
      });
    }
  }

  for (const entry of suggestion.characterMotivations) {
    const key = normalize(entry.characterName);
    const current = map.get(key);
    if (current) {
      map.set(key, {
        ...current,
        motivations: appendUnique(current.motivations, entry.motivations, 6),
      });
    }
  }

  for (const entry of suggestion.relationshipChanges) {
    const key = normalize(entry.characterName);
    const current = map.get(key);
    if (current) {
      map.set(key, {
        ...current,
        relationships: mergeRelationships(current.relationships, entry.relationships),
      });
    }
  }

  return [...map.values()];
}

function mergeRelationships(
  existing: CharacterState["relationships"],
  incoming: CharacterState["relationships"]
): CharacterState["relationships"] {
  const map = new Map<string, CharacterState["relationships"][number]>();
  for (const rel of existing) map.set(normalize(rel.characterName), rel);
  for (const rel of incoming) map.set(normalize(rel.characterName), rel);
  return [...map.values()].slice(-12);
}

function mergeByName<T extends { name: string }>(
  existing: T[],
  incoming: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of existing) map.set(normalize(item.name), item);
  for (const item of incoming) map.set(normalize(item.name), item);
  return [...map.values()];
}

function mergeThreads(
  existing: ContinuityLedger["unresolvedThreads"],
  incoming: ContinuityLedger["unresolvedThreads"]
): ContinuityLedger["unresolvedThreads"] {
  const map = new Map<string, ContinuityLedger["unresolvedThreads"][number]>();
  for (const thread of existing) map.set(normalize(thread.thread), thread);
  for (const thread of incoming) {
    const key = normalize(thread.thread);
    const current = map.get(key);
    map.set(key, current ? { ...current, ...thread } : thread);
  }
  return [...map.values()].slice(-30);
}

function appendUnique(existing: string[], incoming: string[], cap: number): string[] {
  const seen = new Set(existing.map(normalize));
  const result = [...existing];
  for (const value of incoming) {
    const key = normalize(value);
    if (!value.trim() || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.slice(-cap);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}