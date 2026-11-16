import type { CanonState, ProposedChange, WorldRule } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { includesText, normalizeName } from "@/lib/domain/narrativeControl/text";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const SKIP = new Set([
  "every", "years", "year", "months", "month", "weeks", "week", "days", "day",
  "twelve", "annual", "annually", "yearly", "someone", "something", "there",
  "their", "about", "after", "before", "which", "would", "could", "should",
  "involves", "involve", "performed", "performs", "perform",
]);

export interface CanonicalInterval {
  count: number;
  unit: "year" | "month" | "week" | "day";
}

export function describeWorldRule(description: string): {
  canonicalInterval: CanonicalInterval | null;
  conditions: string[];
} {
  const claim = firstAffirmativeInterval(description);
  if (!claim) return { canonicalInterval: null, conditions: [] };
  return {
    canonicalInterval: { count: claim.count, unit: claim.unit },
    conditions: [`interval=${claim.count} ${claim.unit}`],
  };
}

export function applicableExceptions(rule: WorldRule, episode: number): WorldRule["exceptions"] {
  return rule.exceptions.filter((exception) => exception.approved && exception.episode <= episode);
}

export function validateWorldRules(canon: CanonState, episode: number, text: string): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  for (const rule of canon.rules) {
    if (rule.approvalStatus !== "approved") continue;
    if (applicableExceptions(rule, episode).length > 0) continue;
    const pattern = rule.violationPatterns.find((item) => violatedPattern(text, item));
    if (pattern) findings.push(ruleFinding(rule, episode, pattern, pattern, false));
    const interval = intervalContradiction(rule, text);
    if (interval) findings.push(ruleFinding(rule, episode, interval, interval, true));
    const denial = denialContradiction(rule, text);
    if (denial) findings.push(ruleFinding(rule, episode, denial, denial, true));
  }
  return findings;
}

/** A world-rule contradiction is an unauthorized canon change, not a prose edit. */
export function contradictionChanges(canon: CanonState, episode: number, text: string): ProposedChange[] {
  return validateWorldRules(canon, episode, text).filter((finding) => finding.requiresCanonAuthorization).map((finding) => ({
    id: `change-${finding.id}`.slice(0, 160),
    kind: "MODIFY" as const,
    targetKind: "rule" as const,
    targetId: (finding.artifactId ?? "rule").slice(0, 160),
    currentValue: finding.expected.slice(0, 4000),
    proposedValue: finding.actual.slice(0, 8000),
    reason: "The proposal contradicts an approved world rule.",
    objective: "world-rule",
    evidence: finding.evidence.slice(0, 800),
    dependencies: [],
  }));
}

function ruleFinding(
  rule: WorldRule,
  episode: number,
  evidence: string,
  actual: string,
  requiresCanonAuthorization: boolean,
): NarrativeFinding {
  return makeFinding({
    algorithm: "world_rules",
    severity: "ERROR",
    category: "world_rule",
    artifactId: rule.id,
    episode,
    evidence: evidence.slice(0, 180),
    expected: rule.canonicalInterval
      ? `${rule.description} (every ${rule.canonicalInterval.count} ${rule.canonicalInterval.unit}${rule.canonicalInterval.count === 1 ? "" : "s"})`
      : rule.description,
    actual: actual.slice(0, 180),
    explanation: `The text breaks the approved rule "${rule.description}" without an approved exception.`,
    suggestedCorrection: "Remove the violation, or submit a separate authorized rule change.",
    requiresCanonAuthorization,
  });
}

interface IntervalClaim {
  count: number;
  unit: CanonicalInterval["unit"];
  raw: string;
  index: number;
}

function firstAffirmativeInterval(text: string): IntervalClaim | null {
  return intervalClaims(text).find((claim) => !negatedAt(text, claim.index)) ?? null;
}

function intervalContradiction(rule: WorldRule, text: string): string | null {
  if (!rule.canonicalInterval) return null;
  const subjects = subjectTokens(rule.description);
  for (const sentence of sentences(text)) {
    if (subjects.length > 0 && !subjects.some((token) => sentence.includes(token))) continue;
    for (const claim of intervalClaims(sentence)) {
      if (negatedAt(sentence, claim.index)) continue;
      if (claim.count === rule.canonicalInterval.count && claim.unit === rule.canonicalInterval.unit) continue;
      return claim.raw;
    }
  }
  return null;
}

function denialContradiction(rule: WorldRule, text: string): string | null {
  if (rule.canonicalInterval) return null;
  const subjects = subjectTokens(rule.description);
  if (subjects.length < 2) return null;
  const ruleNegation = negationWords(rule.description);
  for (const sentence of sentences(text)) {
    const hits = subjects.filter((token) => sentence.includes(token));
    if (hits.length < 2) continue;
    const extra = negationWords(sentence).filter((word) => !ruleNegation.includes(word));
    if (extra.length === 0) continue;
    return sentence.slice(0, 180);
  }
  return null;
}

function violatedPattern(text: string, pattern: string): boolean {
  if (!includesText(text, pattern)) return false;
  const index = text.toLocaleLowerCase().indexOf(pattern.toLocaleLowerCase());
  return !negatedAt(text, index);
}

function intervalClaims(text: string): IntervalClaim[] {
  const claims: IntervalClaim[] = [];
  const pattern = /\b(?:every|each|once\s+a|once\s+an)\s+([a-z0-9]+)?\s*(year|years|month|months|week|weeks|day|days)\b|\b(annual|annually|yearly)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    if (/annual|yearly/i.test(raw)) {
      claims.push({ count: 1, unit: "year", raw, index: match.index ?? 0 });
      continue;
    }
    const unit = normalizeUnit(match[2] ?? "");
    if (!unit) continue;
    const count = match[1] ? wordToNumber(match[1]) : 1;
    if (!count) continue;
    claims.push({ count, unit, raw, index: match.index ?? 0 });
  }
  return claims;
}

function wordToNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  return NUMBER_WORDS[value.toLocaleLowerCase()] ?? null;
}

function normalizeUnit(unit: string): CanonicalInterval["unit"] | null {
  const value = unit.toLocaleLowerCase();
  if (value.startsWith("year")) return "year";
  if (value.startsWith("month")) return "month";
  if (value.startsWith("week")) return "week";
  if (value.startsWith("day")) return "day";
  return null;
}

function negatedAt(text: string, index: number): boolean {
  const start = Math.max(0, index - 16);
  return /\b(not|never|no|n't)\b/i.test(text.slice(start, index));
}

function negationWords(text: string): string[] {
  return normalizeName(text).split(" ").filter((word) => word === "not" || word === "never" || word === "no");
}

function subjectTokens(description: string): string[] {
  return [...new Set(normalizeName(description).split(" ").filter((word) => word.length >= 6 && !SKIP.has(word)))];
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim().toLocaleLowerCase())
    .filter((part) => part.length > 0);
}
