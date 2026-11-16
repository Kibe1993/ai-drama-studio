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
