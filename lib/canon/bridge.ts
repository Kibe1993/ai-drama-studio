import {
  NARRATIVE_CONTROL_SCHEMA_VERSION,
  type CanonState,
} from "@/lib/validation/narrativeControl";
import type { DerivedCanonState } from "@/lib/canon/schema";

/**
 * Bridge a DerivedCanonState (from the append-only fact log) into a CanonState
 * snapshot (used by the narrativeControl validators). The fact log is the
 * authoritative source; the snapshot is a derived view for the validation
 * engine.
 *
 * Shared collections (entities, relationships, events, threads, facts,
 * knowledge, rules) use identical schemas and are copied by reference.
 * Snapshot-only fields (resolvedFindingSignatures, revisionLog) default to
 * empty — they are maintained by the canon commit flow, not the fact log.
 */
export function derivedToCanonState(
  derived: DerivedCanonState,
  options?: {
    basedOnBibleVersion?: number;
    basedOnPlanVersion?: number;
  },
): CanonState {
  return {
    schemaVersion: NARRATIVE_CONTROL_SCHEMA_VERSION,
    projectId: derived.projectId,
    version: derived.sequence,
    basedOnBibleVersion: options?.basedOnBibleVersion ?? 0,
    basedOnPlanVersion: options?.basedOnPlanVersion ?? 0,
    entities: derived.entities,
    relationships: derived.relationships,
    events: derived.events,
    threads: derived.threads,
    facts: derived.facts,
    knowledge: derived.knowledge,
    rules: derived.rules,
    resolvedFindingSignatures: [],
    revisionLog: [],
  };
}