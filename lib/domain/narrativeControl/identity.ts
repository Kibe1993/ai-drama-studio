import type { CanonEntity } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { contentTokens, normalizeName } from "@/lib/domain/narrativeControl/text";

export type IdentityMethod =
  | "canonical_id"
  | "canonical_name"
  | "alias"
  | "honorific"
  | "constrained_name"
  | "fuzzy_review"
  | "unresolved";

export interface IdentityResolution {
  originalText: string;
  canonicalId: string | null;
  method: IdentityMethod;
  confidence: number;
  evidence: string;
  ambiguous: boolean;
  candidateIds: string[];
}

function levenshtein(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 2) return 3;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid: number[] = Array.from({ length: cols }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    let previous = grid[0] ?? 0;
    grid[0] = row;
    for (let col = 1; col < cols; col += 1) {
      const current = grid[col] ?? 0;
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      grid[col] = Math.min((grid[col] ?? 0) + 1, (grid[col - 1] ?? 0) + 1, previous + cost);
      previous = current;
    }
  }
  return grid[cols - 1] ?? 3;
}

function firstNameOnly(reference: string[], entity: string[]): boolean {
  return reference.length === 1
    && entity.length > 1
    && reference[0] === entity[0]
    && entity[0] !== entity[entity.length - 1];
}

function subset(reference: string[], entity: string[]): boolean {
  return reference.every((token) => entity.includes(token));
}

function unique(matches: CanonEntity[]): CanonEntity | null {
  return matches.length === 1 ? matches[0] ?? null : null;
}

/**
 * Resolve one narrative reference against the canonical entity registry.
 * Fuzzy similarity never assigns an id. A short name matches a longer name
 * only through a registered alias, or through a unique surname/honorific.
 */
export function resolveIdentity(reference: string, entities: readonly CanonEntity[]): IdentityResolution {
  const trimmed = reference.trim();
  const normalized = normalizeName(trimmed);
  const byId = entities.find((entity) => entity.id === trimmed);
  if (byId) {
    return resolution(trimmed, byId.id, "canonical_id", 1, "Exact canonical id.", false, [byId.id]);
  }

  const nameMatches = entities.filter((entity) => normalizeName(entity.name) === normalized);
  if (nameMatches.length > 1) {
    return resolution(trimmed, null, "canonical_name", 0.4, "More than one entity has this name.", true, nameMatches.map((entity) => entity.id));
  }
  const named = unique(nameMatches);
  if (named) {
    return resolution(trimmed, named.id, "canonical_name", 1, `Canonical name "${named.name}".`, false, [named.id]);
  }

  const aliasMatches = entities.filter((entity) =>
    entity.aliases.some((alias) => normalizeName(alias) === normalized),
  );
  if (aliasMatches.length > 1) {
    return resolution(trimmed, null, "alias", 0.4, "This alias is registered on more than one entity.", true, aliasMatches.map((entity) => entity.id));
  }
  const aliased = unique(aliasMatches);
  if (aliased) {
    return resolution(trimmed, aliased.id, "alias", 1, `Registered alias of "${aliased.name}".`, false, [aliased.id]);
  }

  const tokens = contentTokens(trimmed);
  if (tokens.length > 0) {
    const constrained = entities.filter((entity) => {
      const entityTokens = contentTokens(entity.name);
      if (entityTokens.length === 0 || !subset(tokens, entityTokens)) return false;
      if (tokens[tokens.length - 1] !== entityTokens[entityTokens.length - 1]) return false;
      if (firstNameOnly(tokens, entityTokens)) return false;
      return true;
    });
    if (constrained.length > 1) {
      return resolution(trimmed, null, "constrained_name", 0.35, "The shortened name matches more than one entity.", true, constrained.map((entity) => entity.id));
    }
    const match = unique(constrained);
    if (match) {
      const sameTokens = contentTokens(match.name).join(" ") === tokens.join(" ");
      return resolution(
        trimmed,
        match.id,
        sameTokens ? "honorific" : "constrained_name",
        sameTokens ? 0.95 : 0.86,
        sameTokens
          ? `Honorific variant of "${match.name}".`
          : `Unique surname or qualified short form of "${match.name}".`,
        false,
        [match.id],
      );
    }
  }

  if (normalized.length >= 6) {
    const close = entities.filter((entity) => {
      const candidate = normalizeName(entity.name);
      return candidate !== normalized && levenshtein(normalized, candidate) <= 2;
    });
    if (close.length > 0) {
      return resolution(
        trimmed,
        null,
        "fuzzy_review",
        0.3,
        "Similar spelling is not enough to merge identities.",
        true,
        close.map((entity) => entity.id),
      );
    }
  }

  return resolution(trimmed, null, "unresolved", 0, "No canonical entity or alias matches this reference.", false, []);
}

function resolution(
  originalText: string,
  canonicalId: string | null,
  method: IdentityMethod,
  confidence: number,
  evidence: string,
  ambiguous: boolean,
  candidateIds: string[],
): IdentityResolution {
  return { originalText, canonicalId, method, confidence, evidence, ambiguous, candidateIds };
}

export function identityFindings(resolutions: readonly IdentityResolution[], episode: number | null = null): NarrativeFinding[] {
  return resolutions
    .filter((item) => item.ambiguous)
    .map((item) => makeFinding({
      algorithm: "identity",
      severity: "WARNING",
      category: "identity",
      entityId: item.candidateIds[0] ?? null,
      episode,
      evidence: item.originalText,
      expected: "One canonical entity or an explicit clarification.",
      actual: item.candidateIds.join(", ") || "no unique entity",
      explanation: `"${item.originalText}" is ambiguous. ${item.evidence}`,
      suggestedCorrection: "Register an alias or choose the canonical entity explicitly.",
      automaticRepairSafe: false,
    }));
}
