import type { CanonState, NarrativeFact } from "@/lib/validation/narrativeControl";
import { isProtectedFact } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { normalizeName } from "@/lib/domain/narrativeControl/text";

const STOP = new Set([
  "the", "and", "that", "with", "have", "this", "from", "they", "them", "then",
  "there", "their", "into", "about", "after", "before", "because", "while",
  "where", "which", "would", "could", "should", "does", "your", "you", "for",
  "his", "her", "she", "him", "its", "are", "was", "were", "been", "being",
  "have", "had", "has", "not", "but", "what", "when", "who", "how", "why",
  "every", "years", "year", "another", "someone",
]);

const EVENT = /\b(disappears?|calls?|called|sacrifice|warns?|warning|hears?|photograph|ritual)\b/i;
const STAKE = /\b(door|fate|uncertain|climax)\b/i;
const CALL = /\b(calls?|called|phones?|phoned)\b/i;
const ROLES = ["brother", "sister", "journalist", "mother", "father", "daughter", "son"];

/**
 * Compare the synopsis, acts, and screenplay with protected canon.
 * A fact the synopsis still tells must be established on screen.
 * A whole-story revision must still carry every protected fact.
 */
export function agreementFindings(input: {
  canon: CanonState;
  episode: number;
  synopsis: string;
  acts: string;
  screenplayText: string;
  endingText: string;
  requireCanonCoverage: boolean;
}): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  const names = input.canon.entities.filter((entity) => entity.kind === "character").map((entity) => entity.name);
  const screenplay = input.screenplayText.toLocaleLowerCase();
  const ending = input.endingText.toLocaleLowerCase();
  const asserted = `${input.synopsis}\n${input.acts}`.toLocaleLowerCase();

  for (const fact of input.canon.facts) {
    if (!isProtectedFact(fact) || fact.classification !== "ESTABLISHED_CANON") continue;
    const factTokens = tokens(fact.statement);
    if (input.requireCanonCoverage) {
      const missing = uncovered(factTokens, screenplay);
      if (missing) {
        findings.push(coverageFinding(fact, input.episode, missing, "The screenplay drops a protected canonical fact."));
      }
    } else if (EVENT.test(fact.statement)) {
      const synopsisTokens = factTokens.filter((token) => asserted.includes(token));
      if (synopsisTokens.length >= Math.min(2, factTokens.length) && factTokens.length > 0) {
        const missing = uncovered(synopsisTokens, screenplay);
        if (missing) {
          findings.push(coverageFinding(
            fact,
            input.episode,
            missing,
            "The synopsis or acts keep this event, but the screenplay does not establish it.",
          ));
        }
      }
    }

    const denial = deniesFact(fact, names, input.screenplayText);
    if (denial) {
      findings.push(makeFinding({
        algorithm: "agreement",
        severity: "ERROR",
        category: "canon",
        entityId: fact.subjectEntityIds[0] ?? null,
        episode: input.episode,
        evidence: denial.slice(0, 180),
        expected: fact.statement,
        actual: denial.slice(0, 180),
        explanation: `The screenplay denies the protected fact "${fact.statement}".`,
        suggestedCorrection: "Restore the canonical identity or relationship, or request authorization to change it.",
        requiresCanonAuthorization: true,
      }));
    }

    const drift = callerDrift(fact, names, input.screenplayText);
    if (drift) {
      findings.push(makeFinding({
        algorithm: "agreement",
        severity: "ERROR",
        category: "identity",
        episode: input.episode,
        evidence: drift.slice(0, 180),
        expected: fact.statement,
        actual: drift.slice(0, 180),
        explanation: `The screenplay gives "${fact.statement}" to someone other than the canonical character.`,
        suggestedCorrection: "Keep the canonical character in that action, or request authorization to change it.",
        requiresCanonAuthorization: true,
      }));
    }

    const absent = absentPresentRole(fact, names, input.screenplayText);
    if (absent) {
      findings.push(makeFinding({
        algorithm: "agreement",
        severity: "ERROR",
        category: "canon",
        episode: input.episode,
        evidence: absent.slice(0, 180),
        expected: fact.statement,
        actual: absent.slice(0, 180),
        explanation: `The screenplay removes the character's present role without reconciling it with "${fact.statement}".`,
        suggestedCorrection: "Keep the character's present action, or explain how both the absence and the present role are true.",
        requiresCanonAuthorization: true,
      }));
    }

    const broken = brokenLink(fact, names, input.screenplayText);
    if (broken) {
      findings.push(makeFinding({
        algorithm: "agreement",
        severity: "ERROR",
        category: "causal",
        episode: input.episode,
        evidence: broken.slice(0, 180),
        expected: fact.statement,
        actual: broken.slice(0, 180),
        explanation: `The screenplay keeps the stakes of "${fact.statement}" but removes the canonical character from them.`,
        suggestedCorrection: "Keep the character connected to the event the approved canon assigns to them.",
      }));
    }

    if (STAKE.test(fact.statement)) {
      const stakeTokens = tokens(fact.statement).filter((token) => STAKE.test(token) || token.length >= 4);
      const actsAssert = stakeTokens.filter((token) => asserted.includes(token)).length >= 2;
      if ((input.requireCanonCoverage || actsAssert) && uncovered(stakeTokens.slice(0, 6), ending)) {
        findings.push(makeFinding({
          algorithm: "agreement",
          severity: "ERROR",
          category: "structure",
          episode: input.episode,
          evidence: input.endingText.slice(0, 180),
          expected: fact.statement,
          actual: input.endingText.slice(0, 180) || "The ending does not contain the stake.",
          explanation: `The climax drops the protected stake "${fact.statement}".`,
          suggestedCorrection: "Restore the confrontation, choice, or uncertainty the approved canon requires in the ending.",
        }));
      }
    }
  }

  return findings;
}

function coverageFinding(fact: NarrativeFact, episode: number, missing: string, explanation: string): NarrativeFinding {
  return makeFinding({
    algorithm: "agreement",
    severity: "ERROR",
    category: "continuity",
    episode,
    evidence: missing,
    expected: fact.statement,
    actual: `Missing from the screenplay: ${missing}`,
    explanation,
    suggestedCorrection: "Dramatize or explicitly establish the canonical fact in the screenplay.",
  });
}

function uncovered(factTokens: string[], haystack: string): string | null {
  if (factTokens.length === 0) return null;
  const missing = factTokens.filter((token) => !haystack.includes(token));
  const needed = Math.min(2, factTokens.length);
  const present = factTokens.length - missing.length;
  if (present >= needed) return null;
  return missing.slice(0, 4).join(", ");
}

function deniesFact(fact: NarrativeFact, names: string[], text: string): string | null {
  const role = ROLES.find((item) => fact.statement.toLocaleLowerCase().includes(item));
  const subject = names.find((name) => fact.statement.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (!role || !subject) return null;
  const pattern = new RegExp(`\\b${subject}\\b[^.?!\\n]{0,80}\\b(not|never|n't)\\b[^.?!\\n]{0,40}\\b${role}\\b`, "i");
  return pattern.exec(text)?.[0] ?? null;
}

function callerDrift(fact: NarrativeFact, names: string[], text: string): string | null {
  if (!CALL.test(fact.statement)) return null;
  const subject = names.find((name) => fact.statement.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (!subject) return null;
  for (const sentence of splitSentences(text)) {
    if (!CALL.test(sentence)) continue;
    if (sentence.toLocaleLowerCase().includes(subject.toLocaleLowerCase())) continue;
    if (/\b(anonymous|stranger|unknown|unrelated)\b/i.test(sentence)) return sentence;
  }
  return null;
}

function absentPresentRole(fact: NarrativeFact, names: string[], text: string): string | null {
  if (!CALL.test(fact.statement) && !/\bwarns?\b/i.test(fact.statement)) return null;
  const subject = names.find((name) => fact.statement.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (!subject) return null;
  const gone = new RegExp(
    `\\b${subject}\\b[^.?!\\n]{0,40}\\b(disappeared|vanished|gone)\\b[^.?!\\n]{0,24}\\b(twelve|12)\\s+years\\b`,
    "i",
  );
  const match = gone.exec(text);
  if (!match) return null;
  const stillActs = splitSentences(text).some((sentence) =>
    sentence.toLocaleLowerCase().includes(subject.toLocaleLowerCase()) && (CALL.test(sentence) || /\bwarns?\b/i.test(sentence)),
  );
  return stillActs ? null : match[0];
}

function brokenLink(fact: NarrativeFact, names: string[], text: string): string | null {
  if (!/\b(sacrifice|ritual)\b/i.test(fact.statement)) return null;
  const mentioned = names.filter((name) => fact.statement.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (mentioned.length === 0) return null;
  const stakeSentences = splitSentences(text).filter((sentence) => /\b(sacrifice|ritual)\b/i.test(sentence));
  if (stakeSentences.length === 0) return null;
  const linked = stakeSentences.some((sentence) =>
    mentioned.every((name) => sentence.toLocaleLowerCase().includes(name.toLocaleLowerCase())),
  );
  if (linked) return null;
  if (!mentioned.some((name) => text.toLocaleLowerCase().includes(name.toLocaleLowerCase()))) return null;
  return stakeSentences[0] ?? null;
}

function tokens(value: string): string[] {
  return [...new Set(normalizeName(value).split(" ").filter((word) => word.length >= 4 && !STOP.has(word)))];
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
