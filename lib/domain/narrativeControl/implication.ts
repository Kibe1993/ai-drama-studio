import type { CanonState, NarrativeFact } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { knowledgeAt, validateDisclosures } from "@/lib/domain/narrativeControl/knowledge";
import { normalizeName } from "@/lib/domain/narrativeControl/text";

const STOP = new Set([
  "the", "and", "that", "with", "have", "this", "from", "they", "them", "then",
  "there", "their", "into", "about", "after", "before", "because", "while",
  "where", "which", "would", "could", "should", "does", "your", "you", "for",
  "his", "her", "she", "him", "its", "are", "was", "were", "been", "being",
  "have", "had", "has", "not", "but", "what", "when", "who", "how", "why",
  "happened", "night", "says", "said", "tells", "told",
]);

const VARIANTS: Record<string, string[]> = {
  caused: ["cause", "causing", "responsible"],
  cause: ["caused", "causing", "responsible"],
  accident: ["crash", "collision", "wreck"],
  crash: ["accident", "collision", "wreck"],
  driver: ["driving", "drove", "driven"],
  driving: ["driver", "drove", "driven"],
  died: ["dead", "death", "killed"],
  killed: ["died", "dead", "death"],
  remember: ["remembers", "remembered", "memory"],
  remembered: ["remember", "memory"],
  secret: ["secrets", "hidden"],
  hidden: ["secret", "secrets"],
};

export type ImplicationLevel = "certain" | "suspected";

export interface SpokenLine {
  speaker: string | null;
  text: string;
}

function words(value: string): string[] {
  return normalizeName(value).split(" ").filter((word) => word.length >= 4 && !STOP.has(word));
}

function termsFor(fact: NarrativeFact, names: Set<string>): string[] {
  if (fact.literalKind === "date") return [];
  const seeds = words(`${fact.statement} ${fact.value} ${fact.rolePhrase}`)
    .filter((word) => !names.has(word));
  const terms = new Set<string>();
  for (const seed of seeds) {
    terms.add(seed);
    for (const variant of VARIANTS[seed] ?? []) terms.add(variant);
  }
  return [...terms];
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function spokenLines(text: string): SpokenLine[] {
  return splitSentences(text).map((line) => {
    const labeled = /^([^:]{1,80}):\s+(.+)$/.exec(line);
    if (!labeled) return { speaker: null, text: line };
    const speaker = labeled[1]?.trim() ?? "";
    const body = labeled[2]?.trim() ?? "";
    if (!speaker || !body || speaker.split(" ").length > 4) return { speaker: null, text: line };
    return { speaker, text: body };
  });
}

function negated(sentence: string): boolean {
  return /\b(not|never|no|without|denies|denied|forgets|forgot|unaware|didn't|did not|wasn't|was not)\b/i.test(sentence);
}

function hedged(sentence: string): boolean {
  return /\b(maybe|perhaps|might|suspects?|wonders?|whether|possibly|could have|may have)\b/i.test(sentence);
}

function knowledgeVerb(sentence: string): boolean {
  return /\b(remember|remembers|remembered|knew|knows|known|admit|admits|admitted|confess|confessed|realize|realizes|realized|responsible)\b/i.test(sentence);
}

function roleAssertion(sentence: string, fact: NarrativeFact, names: string[]): boolean {
  const role = fact.rolePhrase.trim().toLocaleLowerCase();
  if (!role) return false;
  const variants = [role, ...(VARIANTS[role] ?? [])].join("|");
  const speakers = ["i", "he", "she", "they", ...names.map((name) => name.toLocaleLowerCase())].join("|");
  const pattern = new RegExp(`\\b(?:${speakers})\\b(?:\\s+\\w+){0,4}\\s+(?:was|were|is|am|'m)\\s+(?:the\\s+)?(?:${variants})\\b`, "i");
  return pattern.test(sentence);
}

export function implicationLevel(sentence: string, fact: NarrativeFact, names: string[]): ImplicationLevel | null {
  if (negated(sentence)) return null;
  const terms = termsFor(fact, new Set(names.map((name) => normalizeName(name))));
  const hits = terms.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(sentence));
  const asserted = roleAssertion(sentence, fact, names) || hits.length >= 2 || (hits.length >= 1 && knowledgeVerb(sentence));
  if (!asserted) return null;
  return hedged(sentence) ? "suspected" : "certain";
}

function audienceReady(fact: NarrativeFact, episode: number): boolean {
  if (fact.classification === "ESTABLISHED_CANON" || fact.classification === "AUDIENCE_KNOWLEDGE") {
    return fact.audienceRevealEpisode === null || episode >= fact.audienceRevealEpisode;
  }
  if (fact.audienceRevealEpisode === null) return false;
  return episode >= fact.audienceRevealEpisode;
}

/**
 * Infer knowledge from what a line presupposes.
 * A suspicion is allowed only after the character's knowledge entry allows it.
 * A certain assertion is allowed only when that character is certain and the
 * audience is allowed to hear it.
 */
export function impliedKnowledgeFindings(canon: CanonState, episode: number, text: string): NarrativeFinding[] {
  const names = canon.entities.filter((entity) => entity.kind === "character").map((entity) => entity.name);
  const findings: NarrativeFinding[] = [];
  for (const line of spokenLines(text)) {
    for (const fact of canon.facts) {
      if (fact.classification === "RETRACTED" || fact.classification === "PROVISIONAL") continue;
      const level = implicationLevel(line.text, fact, names);
      if (!level) continue;
      const speaker = line.speaker
        ? canon.entities.find((entity) => normalizeName(entity.name) === normalizeName(line.speaker ?? ""))
        : null;
      const subjects = fact.subjectEntityIds.length > 0
        ? fact.subjectEntityIds
        : speaker && !audienceReady(fact, episode) ? [speaker.id] : [];
      const covered = coveredByAudienceFact(line.text, fact, canon, episode, names);
      if (level === "certain" && !audienceReady(fact, episode) && !covered) {
        findings.push(impliedFinding(fact, episode, line.text, "The line states a concealed fact before the audience may hear it."));
      }
      for (const characterId of subjects) {
        const view = knowledgeAt(canon, characterId, fact.id, episode);
        const character = canon.entities.find((entity) => entity.id === characterId);
        const label = character?.name ?? characterId;
        if (level === "certain" && view.certainty !== "certain") {
          findings.push(impliedFinding(fact, episode, line.text, `${label} speaks or is described as if they already know "${fact.statement}".`));
        }
        if (level === "suspected" && view.certainty !== "suspected" && view.certainty !== "certain") {
          findings.push(impliedFinding(fact, episode, line.text, `${label} raises "${fact.statement}" before the story allows even a suspicion.`));
        }
      }
      if (level === "suspected" && subjects.length === 0 && !audienceReady(fact, episode)) {
        findings.push(impliedFinding(fact, episode, line.text, "The line hints at a concealed fact before the audience may hear it."));
      }
    }
  }
  return findings;
}

function matchedTerms(sentence: string, fact: NarrativeFact, names: string[]): string[] {
  const terms = termsFor(fact, new Set(names.map((name) => normalizeName(name))));
  return terms.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(sentence));
}

/**
 * A concealed fact that only repeats words the audience may already hear
 * is not a premature reveal. The hidden fact must add something of its own.
 */
function coveredByAudienceFact(
  sentence: string,
  fact: NarrativeFact,
  canon: CanonState,
  episode: number,
  names: string[],
): boolean {
  if (audienceReady(fact, episode)) return false;
  const hits = matchedTerms(sentence, fact, names);
  if (hits.length === 0) return false;
  return canon.facts.some((other) => {
    if (other.id === fact.id || !audienceReady(other, episode)) return false;
    const ready = new Set(termsFor(other, new Set(names.map((name) => normalizeName(name)))));
    return hits.every((term) => ready.has(term));
  });
}

function impliedFinding(fact: NarrativeFact, episode: number, evidence: string, explanation: string): NarrativeFinding {
  return makeFinding({
    algorithm: "implication",
    severity: "ERROR",
    category: "knowledge",
    entityId: fact.subjectEntityIds[0] ?? null,
    episode,
    evidence: evidence.slice(0, 180),
    expected: fact.audienceRevealEpisode
      ? `No certain disclosure before episode ${fact.audienceRevealEpisode}.`
      : "This fact stays concealed until a knowledge entry allows it.",
    actual: evidence.slice(0, 180),
    explanation,
    suggestedCorrection: "Remove the implication, or wait until the knowledge ledger allows it.",
    automaticRepairSafe: true,
  });
}

export function validateKnowledge(canon: CanonState, episode: number, text: string): NarrativeFinding[] {
  const explicit = validateDisclosures(canon, episode, text);
  const implied = impliedKnowledgeFindings(canon, episode, text);
  const seen = new Set<string>();
  const combined = [];
  for (const finding of [...explicit, ...implied]) {
    if (seen.has(finding.id)) continue;
    seen.add(finding.id);
    combined.push(finding);
  }
  return combined;
}

export interface CriticClaim {
  category: string;
  severity: string;
  message: string;
  sceneNumber?: number;
}

export interface AdjudicatedClaim {
  category: "canon" | "continuity" | "knowledge" | "timeline" | "quality";
  severity: "warning" | "error";
  sceneNumber?: number;
  message: string;
}

/**
 * The critic proposes. The knowledge ledger decides canon.
 * A critic error blocks the draft. Only a confirmed canon breach is recorded
 * as a knowledge finding, and neither path writes canon.
 */
export function adjudicateCriticFindings(input: {
  canon: CanonState;
  episode: number;
  scenes: { sceneNumber: number; text: string }[];
  findings: CriticClaim[];
}): AdjudicatedClaim[] {
  return input.findings.map((finding) => {
    const scene = input.scenes.find((item) => item.sceneNumber === finding.sceneNumber);
    const text = [scene?.text ?? "", finding.message].filter(Boolean).join("\n");
    const confirmed = validateKnowledge(input.canon, input.episode, text).find((item) => item.severity === "ERROR");
    const category = finding.category === "knowledge"
      ? "knowledge"
      : finding.category === "canon"
        ? "canon"
        : finding.category === "timeline"
          ? "timeline"
          : "quality";
    if (confirmed && (finding.category === "knowledge" || finding.category === "canon" || finding.category === "timeline")) {
      return {
        category,
        severity: "error" as const,
        ...(finding.sceneNumber ? { sceneNumber: finding.sceneNumber } : {}),
        message: confirmed.explanation.slice(0, 600),
      };
    }
    if (finding.severity === "error") {
      return {
        category,
        severity: "error" as const,
        ...(finding.sceneNumber ? { sceneNumber: finding.sceneNumber } : {}),
        message: `[continuity critic] ${finding.message} The application did not confirm this as a canon change.`.slice(0, 600),
      };
    }
    return {
      category,
      severity: "warning" as const,
      ...(finding.sceneNumber ? { sceneNumber: finding.sceneNumber } : {}),
      message: `[continuity critic] ${finding.message}`.slice(0, 600),
    };
  });
}
