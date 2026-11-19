import type { CanonState } from "@/lib/validation/narrativeControl";
import { canonStateSchema } from "@/lib/validation/narrativeControl";
import { normalizeName } from "@/lib/domain/narrativeControl/text";

export interface CanonPort {
  latest(clerkUserId: string, projectId: string): Promise<CanonState | null>;
  commit(input: {
    clerkUserId: string;
    projectId: string;
    expectedVersion: number;
    state: CanonState;
    reason: string;
  }): Promise<CanonState>;
}

export interface CanonMerge {
  state: CanonState;
  changed: boolean;
}

/**
 * Stored canon wins on conflicts. New approved bible or ledger facts are added.
 * A derived snapshot never replaces a committed fact.
 *
 * Merges facts, entities, rules, events, relationships, knowledge entries, and
 * threads. Existing entity descriptions are updated from newer Bible versions
 * (permitted descriptive metadata only — identity, lifecycle, and protected
 * attributes are never overwritten).
 */
export function mergeDerivedCanon(stored: CanonState | null, derived: CanonState): CanonMerge {
  if (!stored) return { state: derived, changed: true };
  const next = structuredClone(stored);
  let changed = false;
  const factText = new Set(next.facts.map((fact) => normalizeName(fact.statement)));
  for (const fact of derived.facts) {
    const key = normalizeName(fact.statement);
    if (factText.has(key)) continue;
    next.facts.push(fact);
    factText.add(key);
    changed = true;
  }
  const entityIds = new Set(next.entities.map((entity) => entity.id));
  for (const entity of derived.entities) {
    if (entityIds.has(entity.id)) continue;
    next.entities.push(entity);
    entityIds.add(entity.id);
    changed = true;
  }
  // Update permitted descriptive metadata on existing entities from newer Bible
  // or ledger. Never overwrite identity (id, kind, name), lifecycle state, or
  // protected attributes (endedEpisode, permitsNonlivingAppearance).
  if (derived.basedOnBibleVersion > next.basedOnBibleVersion || derived.basedOnPlanVersion > next.basedOnPlanVersion) {
    for (const entity of derived.entities) {
      const existing = next.entities.find((e) => e.id === entity.id);
      if (!existing) continue;
      if (entity.description && entity.description !== existing.description) {
        existing.description = entity.description;
        changed = true;
      }
      if (entity.role && entity.role !== existing.role) {
        existing.role = entity.role;
        changed = true;
      }
      if (entity.motivations.length > 0 && entity.motivations.join("|") !== existing.motivations.join("|")) {
        existing.motivations = entity.motivations;
        changed = true;
      }
      if (entity.goals.length > 0 && entity.goals.join("|") !== existing.goals.join("|")) {
        existing.goals = entity.goals;
        changed = true;
      }
      if (entity.arc && entity.arc !== existing.arc) {
        existing.arc = entity.arc;
        changed = true;
      }
      if (entity.secrets.length > 0 && entity.secrets.join("|") !== existing.secrets.join("|")) {
        existing.secrets = entity.secrets;
        changed = true;
      }
    }
  }
  const ruleText = new Set(next.rules.map((rule) => normalizeName(rule.description)));
  for (const rule of derived.rules) {
    const key = normalizeName(rule.description);
    if (ruleText.has(key)) continue;
    next.rules.push(rule);
    ruleText.add(key);
    changed = true;
  }
  const eventIds = new Set(next.events.map((event) => event.id));
  for (const event of derived.events) {
    if (eventIds.has(event.id)) continue;
    next.events.push(event);
    eventIds.add(event.id);
    changed = true;
  }
  // Merge relationships by ID. Stored canon wins — a derived snapshot never
  // replaces a committed relationship.
  const relationshipIds = new Set(next.relationships.map((rel) => rel.id));
  for (const rel of derived.relationships) {
    if (relationshipIds.has(rel.id)) continue;
    next.relationships.push(rel);
    relationshipIds.add(rel.id);
    changed = true;
  }
  // Merge knowledge entries by ID. Knowledge is never transferred between
  // characters — each entry is bound to its characterId and factId.
  const knowledgeIds = new Set(next.knowledge.map((k) => k.id));
  for (const k of derived.knowledge) {
    if (knowledgeIds.has(k.id)) continue;
    next.knowledge.push(k);
    knowledgeIds.add(k.id);
    changed = true;
  }
  // Merge threads by ID. Stored lifecycle status is preserved — a derived
  // snapshot never changes a thread from "resolved" back to "active".
  const threadIds = new Set(next.threads.map((t) => t.id));
  for (const t of derived.threads) {
    if (threadIds.has(t.id)) continue;
    next.threads.push(t);
    threadIds.add(t.id);
    changed = true;
  }
  if (derived.basedOnBibleVersion > next.basedOnBibleVersion) {
    next.basedOnBibleVersion = derived.basedOnBibleVersion;
    changed = true;
  }
  if (derived.basedOnPlanVersion > next.basedOnPlanVersion) {
    next.basedOnPlanVersion = derived.basedOnPlanVersion;
    changed = true;
  }
  return { state: canonStateSchema.parse(next), changed };
}

async function commitOrReload(
  port: CanonPort,
  clerkUserId: string,
  projectId: string,
  expectedVersion: number,
  state: CanonState,
  reason: string,
): Promise<CanonState> {
  try {
    return await port.commit({ clerkUserId, projectId, expectedVersion, state, reason });
  } catch {
    const latest = await port.latest(clerkUserId, projectId);
    if (latest) return latest;
    throw new Error("The canon version changed and the current canon could not be reloaded.");
  }
}

/**
 * Merge stored canon with the derived bible snapshot without committing.
 * Generation and validation use this. A commit happens only after acceptance.
 */
export async function prepareWorkingCanon(input: {
  clerkUserId: string;
  projectId: string;
  derived: CanonState;
  port?: CanonPort | null;
}): Promise<CanonState> {
  if (!input.port) return input.derived;
  const stored = await input.port.latest(input.clerkUserId, input.projectId);
  return mergeDerivedCanon(stored, input.derived).state;
}

/**
 * Load the committed canon for a project. When none exists, commit the
 * derived bible and ledger snapshot. When the bible or ledger has new facts,
 * commit those additions without overwriting stored facts.
 */
export async function resolveWorkingCanon(input: {
  clerkUserId: string;
  projectId: string;
  derived: CanonState;
  port?: CanonPort | null;
}): Promise<CanonState> {
  if (!input.port) return input.derived;
  const stored = await input.port.latest(input.clerkUserId, input.projectId);
  const merged = mergeDerivedCanon(stored, input.derived);
  if (!stored) {
    return commitOrReload(
      input.port,
      input.clerkUserId,
      input.projectId,
      0,
      merged.state,
      "Establish canon from the approved bible and ledger",
    );
  }
  if (!merged.changed) return stored;
  return commitOrReload(
    input.port,
    input.clerkUserId,
    input.projectId,
    stored.version,
    merged.state,
    "Add facts from a newer approved bible or ledger",
  );
}
