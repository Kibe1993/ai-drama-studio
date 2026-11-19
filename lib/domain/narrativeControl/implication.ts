import type { CanonState, NarrativeFact } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { knowledgeAt, validateDisclosures } from "@/lib/domain/narrativeControl/knowledge";
import { resolveIdentity } from "@/lib/domain/narrativeControl/identity";
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
  if (fact.classification === "ESTABLISHED_CANON" || fact.classification === "AUDIENCE_KNOWLEDGE" || fact.classification === "CHARACTER_KNOWLEDGE") {
    return fact.audienceRevealEpisode === null || episode >= fact.audienceRevealEpisode;
  }
  if (fact.audienceRevealEpisode === null) return false;
  return episode >= fact.audienceRevealEpisode;
}

/**
 * Infer knowledge from what a line presupposes.
 * Speaker knowledge and audience disclosure are evaluated independently:
 *
 * A. Speaker knowledge: Does the speaking character actually know the fact?
 *    A character who does not know a secret cannot confidently reveal it.
 * B. Audience disclosure: Is the fact permitted to be revealed to the audience?
 *    A character who knows a secret may discuss it when the narrative
 *    circumstances permit it (audience is ready or the line is indirect).
 * C. Speculation: A character may speculate about a concealed fact without
 *    triggering a confirmed-disclosure error, but speculating about a fact
 *    they have no knowledge of at all is a speaker-knowledge warning.
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
        ? (() => {
            const resolved = resolveIdentity(line.speaker, canon.entities);
            return resolved.canonicalId
              ? canon.entities.find((entity) => entity.id === resolved.canonicalId) ?? null
              : null;
          })()
        : null;
      const covered = coveredByAudienceFact(line.text, fact, canon, episode, names);
      const audienceCanHear = audienceReady(fact, episode);

      // A. Speaker knowledge — evaluate the actual speaking character.
      //    Public facts (ESTABLISHED_CANON, AUDIENCE_KNOWLEDGE) are known to
      //    everyone; only check speaker knowledge for facts that a character
      //    might not know (CHARACTER_KNOWLEDGE, HIDDEN_TRUTH, AUTHOR_TRUTH).
      const isPublicFact = fact.classification === "ESTABLISHED_CANON" || fact.classification === "AUDIENCE_KNOWLEDGE";
      if (speaker && !isPublicFact) {
        const view = knowledgeAt(canon, speaker.id, fact.id, episode);
        if (level === "certain" && view.certainty !== "certain") {
          findings.push(speakerKnowledgeFinding(fact, episode, line, speaker.name, speaker.id, "error",
            `${speaker.name} asserts "${fact.statement}" as established knowledge, but ${speaker.name} does not have certain knowledge of this fact in episode ${episode}.`));
        }
        if (level === "suspected" && view.certainty !== "suspected" && view.certainty !== "certain") {
          findings.push(speakerKnowledgeFinding(fact, episode, line, speaker.name, speaker.id, "warning",
            `${speaker.name} speculates about "${fact.statement}", but ${speaker.name} has no knowledge or suspicion of this fact in episode ${episode}.`));
        }
      }

      // B. Audience disclosure — only for certain assertions, not speculation
      if (level === "certain" && !audienceCanHear && !covered) {
        findings.push(audienceDisclosureFinding(fact, episode, line, speaker?.name ?? null, speaker?.id ?? null,
          `The line reveals "${fact.statement}" to the audience before its permitted reveal episode${fact.audienceRevealEpisode ? ` ${fact.audienceRevealEpisode}` : ""}.`));
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

function speakerKnowledgeFinding(
  fact: NarrativeFact,
  episode: number,
  line: SpokenLine,
  speakerName: string,
  speakerId: string,
  severity: "error" | "warning",
  explanation: string,
): NarrativeFinding {
  return makeFinding({
    algorithm: "implication:speaker_knowledge",
    severity: severity === "error" ? "ERROR" : "WARNING",
    category: "knowledge",
    entityId: speakerId,
    episode,
    evidence: line.text.slice(0, 180),
    expected: `${speakerName} should not know "${fact.statement}" in episode ${episode}.`,
    actual: `${speakerName} says: "${line.text.slice(0, 120)}"`,
    explanation,
    suggestedCorrection: severity === "error"
      ? `Remove the assertion, or add a knowledge entry allowing ${speakerName} to know this fact by episode ${episode}.`
      : `Remove the speculation, or add a knowledge entry allowing ${speakerName} to suspect this fact by episode ${episode}.`,
    automaticRepairSafe: true,
    title: `Speaker knowledge: ${speakerName}`,
    confidence: "high",
  });
}

function audienceDisclosureFinding(
  fact: NarrativeFact,
  episode: number,
  line: SpokenLine,
  speakerName: string | null,
  speakerId: string | null,
  explanation: string,
): NarrativeFinding {
  return makeFinding({
    algorithm: "implication:audience_disclosure",
    severity: "ERROR",
    category: "knowledge",
    entityId: speakerId ?? fact.subjectEntityIds[0] ?? null,
    episode,
    evidence: line.text.slice(0, 180),
    expected: fact.audienceRevealEpisode
      ? `Audience reveal no earlier than episode ${fact.audienceRevealEpisode}.`
      : "This fact stays concealed from the audience.",
    actual: `Disclosed in episode ${episode}${speakerName ? ` by ${speakerName}` : ""}.`,
    explanation,
    suggestedCorrection: "Remove the disclosure from this episode, or wait until the audience reveal episode.",
    automaticRepairSafe: true,
    title: `Audience disclosure: ${fact.key}`,
    confidence: "high",
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
