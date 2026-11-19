import type {
  ContinuityLedger,
  ContinuityLocationState,
  UnresolvedThread,
} from "@/lib/validation/continuityLedger";
import type { EpisodeCanonSummary } from "@/lib/validation/casna";

/**
 * Merge one approved episode's canon into the existing Continuity Ledger.
 *
 * This is the only path by which new facts become established canon. It is a
 * pure function of the existing ledger and an episode canon summary that was
 * produced from approved material, so it can be tested without a database and
 * cannot read from an unapproved draft.
 */
export function applyCanonToLedger(
  existing: ContinuityLedger | null,
  summary: EpisodeCanonSummary
): ContinuityLedger {
  return {
    events: [
      ...(existing?.events ?? []),
      ...summary.events.map((event) => ({
        episodeNumber: summary.episodeNumber,
        event: event.event,
        consequence: event.consequence,
        affectedCharacters: event.affectedCharacters,
        revealedInformation: event.revealedInformation,
      })),
    ].slice(-200),
    characterStates: mergeByName(existing?.characterStates ?? [], summary.characterStates, "name"),
    locationStates: mergeByName(
      existing?.locationStates ?? [],
      summary.locationStates,
      "name"
    ),
    objectStates: mergeByName(existing?.objectStates ?? [], summary.objectStates, "name"),
    revealedSecrets: appendUnique(existing?.revealedSecrets ?? [], summary.revealedSecrets, 20),
    unresolvedThreads: mergeThreads(existing?.unresolvedThreads ?? [], summary.unresolvedThreads),
    consequences: appendUnique(existing?.consequences ?? [], summary.consequences, 20),
    timelineNotes: truncate(
      [existing?.timelineNotes, `Episode ${summary.episodeNumber}: ${summary.title}`]
        .filter(Boolean)
        .join(" | "),
      800
    ),
  };
}

function mergeByName<T extends Record<K, string>, K extends keyof T>(
  existing: T[],
  incoming: T[],
  key: K
): T[] {
  const map = new Map<string, T>();
  for (const item of existing) map.set(normalize(item[key]), item);
  for (const item of incoming) map.set(normalize(item[key]), item);
  return [...map.values()];
}

function mergeThreads(existing: UnresolvedThread[], incoming: UnresolvedThread[]): UnresolvedThread[] {
  const map = new Map<string, UnresolvedThread>();
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

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(-max);
}

/** Re-exported so callers can type location state merges. */
export type LedgerLocationState = ContinuityLocationState;
