import {
  type CanonFactEntry,
  type CanonFactKind,
  type DerivedCanonState,
  emptyDerivedCanonState,
  parsePayload,
} from "@/lib/canon/schema";
import type { FactClassification } from "@/lib/validation/narrativeControl";

export type ReduceMode = "strict" | "migration";

type Collection =
  | "entities"
  | "relationships"
  | "events"
  | "threads"
  | "facts"
  | "knowledge"
  | "rules";

const KIND_TO_COLLECTION: Record<CanonFactKind, Collection> = {
  entity: "entities",
  relationship: "relationships",
  event: "events",
  thread: "threads",
  fact: "facts",
  knowledge: "knowledge",
  rule: "rules",
};

type ItemWithId = { id: string };

export class ReduceError extends Error {
  readonly code = "reduce_error";
  readonly entrySequence: number;
  readonly targetId: string;
  readonly operation: string;

  constructor(
    message: string,
    entrySequence: number,
    targetId: string,
    operation: string,
  ) {
    super(message);
    this.name = "ReduceError";
    this.entrySequence = entrySequence;
    this.targetId = targetId;
    this.operation = operation;
  }
}

function sortBySequence(entries: CanonFactEntry[]): CanonFactEntry[] {
  return [...entries].sort((a, b) => a.sequence - b.sequence);
}

function deduplicateById(entries: CanonFactEntry[]): CanonFactEntry[] {
  const seen = new Set<string>();
  const result: CanonFactEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
}

function getCollection(state: DerivedCanonState, collection: Collection): ItemWithId[] {
  return state[collection] as ItemWithId[];
}

function findIndex(items: ItemWithId[], targetId: string): number {
  return items.findIndex((item) => item.id === targetId);
}

function applyEstablished(
  state: DerivedCanonState,
  entry: CanonFactEntry,
  mode: ReduceMode,
): void {
  const collection = KIND_TO_COLLECTION[entry.kind];
  const items = getCollection(state, collection);

  switch (entry.operation) {
    case "add": {
      if (entry.payload === null) return;
      const payload = parsePayload(entry.kind, entry.payload);
      const existing = findIndex(items, entry.targetId);
      if (existing >= 0) {
        if (mode === "strict") {
          throw new ReduceError(
            `add: target "${entry.targetId}" already exists in ${collection}`,
            entry.sequence,
            entry.targetId,
            entry.operation,
          );
        }
        items[existing] = payload as ItemWithId;
      } else {
        items.push(payload as ItemWithId);
      }
      break;
    }
    case "modify": {
      if (entry.payload === null) return;
      const payload = parsePayload(entry.kind, entry.payload);
      const index = findIndex(items, entry.targetId);
      if (index < 0) {
        if (mode === "strict") {
          throw new ReduceError(
            `modify: target "${entry.targetId}" not found in ${collection}`,
            entry.sequence,
            entry.targetId,
            entry.operation,
          );
        }
        items.push(payload as ItemWithId);
      } else {
        items[index] = payload as ItemWithId;
      }
      break;
    }
    case "retract": {
      const index = findIndex(items, entry.targetId);
      if (index < 0) {
        if (mode === "strict") {
          throw new ReduceError(
            `retract: target "${entry.targetId}" not found in ${collection}`,
            entry.sequence,
            entry.targetId,
            entry.operation,
          );
        }
      } else {
        items.splice(index, 1);
      }
      if (!state.retracted.includes(entry.targetId)) {
        state.retracted.push(entry.targetId);
      }
      break;
    }
    case "reinterpret": {
      if (entry.kind === "fact" && entry.newClassification) {
        const fact = state.facts.find((f) => f.id === entry.targetId);
        if (!fact) {
          if (mode === "strict") {
            throw new ReduceError(
              `reinterpret: target "${entry.targetId}" not found in facts`,
              entry.sequence,
              entry.targetId,
              entry.operation,
            );
          }
        } else {
          fact.classification = entry.newClassification as FactClassification;
        }
      }
      break;
    }
  }
}

function applySubjective(state: DerivedCanonState, entry: CanonFactEntry): void {
  if (entry.operation !== "add" && entry.operation !== "modify") return;
  if (entry.payload === null) return;

  const payload = parsePayload(entry.kind, entry.payload);
  state.subjective.push({
    entryId: entry.id,
    kind: entry.kind,
    targetId: entry.targetId,
    assertionKind: entry.assertionKind,
    narrativeMode: entry.narrativeMode,
    episode: entry.episode,
    sceneNumber: entry.evidence?.sceneNumber ?? null,
    asserterId: entry.asserterId,
    payload,
  });
}

function applyEntry(state: DerivedCanonState, entry: CanonFactEntry, mode: ReduceMode): void {
  if (entry.factualStatus === "not_established") {
    applySubjective(state, entry);
    return;
  }
  applyEstablished(state, entry, mode);
}

export function reduceCanon(
  projectId: string,
  entries: CanonFactEntry[],
  mode: ReduceMode = "strict",
): DerivedCanonState {
  const ordered = deduplicateById(sortBySequence(entries));
  const state = emptyDerivedCanonState(projectId);

  for (const entry of ordered) {
    if (entry.projectId !== projectId) continue;
    applyEntry(state, entry, mode);
    state.sequence = Math.max(state.sequence, entry.sequence);
    state.asOfEpisode = Math.max(state.asOfEpisode, entry.episode);
    state.factCount += 1;
  }

  return state;
}

export function reduceCanonIncremental(
  base: DerivedCanonState,
  newEntries: CanonFactEntry[],
  mode: ReduceMode = "strict",
): DerivedCanonState {
  const ordered = deduplicateById(sortBySequence(newEntries));
  const state: DerivedCanonState = {
    ...base,
    entities: [...base.entities],
    relationships: [...base.relationships],
    events: [...base.events],
    threads: [...base.threads],
    facts: [...base.facts],
    knowledge: [...base.knowledge],
    rules: [...base.rules],
    retracted: [...base.retracted],
    subjective: [...base.subjective],
  };

  for (const entry of ordered) {
    if (entry.projectId !== state.projectId) continue;
    if (entry.sequence <= base.sequence) continue;
    applyEntry(state, entry, mode);
    state.sequence = Math.max(state.sequence, entry.sequence);
    state.asOfEpisode = Math.max(state.asOfEpisode, entry.episode);
    state.factCount += 1;
  }

  return state;
}