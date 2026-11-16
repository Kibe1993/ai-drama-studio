import type { CanonState, KnowledgeEntry, NarrativeFact } from "@/lib/validation/narrativeControl";
import { isProtectedFact } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { extractDates, includesText, windowAround } from "@/lib/domain/narrativeControl/text";

export interface KnowledgeView {
  knows: boolean;
  believes: boolean;
  certainty: KnowledgeEntry["certainty"] | "unknown";
  entry: KnowledgeEntry | null;
}

export function knowledgeAt(
  canon: CanonState,
  characterId: string,
  factId: string,
  episode: number,
): KnowledgeView {
  const entries = canon.knowledge
    .filter((entry) => entry.characterId === characterId && entry.factId === factId && entry.knownFromEpisode <= episode)
    .sort((left, right) => left.knownFromEpisode - right.knownFromEpisode);
  const entry = entries[entries.length - 1] ?? null;
  if (!entry) return { knows: false, believes: false, certainty: "unknown", entry: null };
  return {
    knows: entry.believes && entry.certainty === "certain",
    believes: entry.believes,
    certainty: entry.certainty,
    entry,
  };
}

function audienceCanHear(fact: NarrativeFact, episode: number): boolean {
  if (fact.classification === "ESTABLISHED_CANON" || fact.classification === "AUDIENCE_KNOWLEDGE") {
    return fact.audienceRevealEpisode === null || episode >= fact.audienceRevealEpisode;
  }
  if (fact.audienceRevealEpisode === null) return false;
  return episode >= fact.audienceRevealEpisode;
}

/**
 * Deterministic disclosure checks. They catch explicit assertions stored on
 * the fact. Sentence-level implication is applied by validateKnowledge.
 */
export function validateDisclosures(canon: CanonState, episode: number, text: string): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  const labels = canon.entities.filter((entity) => entity.kind === "character").map((entity) => entity.name);

  for (const fact of canon.facts) {
    if (fact.classification === "RETRACTED" || fact.classification === "PROVISIONAL") continue;

    const certain = fact.certainPatterns.some((pattern) => includesText(text, pattern));
    const suspected = fact.suspectedPatterns.some((pattern) => includesText(text, pattern));
    const verbatimHidden = (fact.classification === "HIDDEN_TRUTH" || fact.classification === "AUTHOR_TRUTH")
      && fact.statement.length >= 24
      && includesText(text, fact.statement)
      && !audienceCanHear(fact, episode);

    if ((certain || verbatimHidden) && !audienceCanHear(fact, episode)) {
      findings.push(disclosureFinding(fact, episode, "The audience learns this fact before its reveal episode."));
    }

    if (certain || suspected) {
      for (const characterId of fact.subjectEntityIds) {
        const view = knowledgeAt(canon, characterId, fact.id, episode);
        const character = canon.entities.find((entity) => entity.id === characterId);
        if (certain && view.certainty !== "certain") {
          findings.push(makeFinding({
            algorithm: "knowledge",
            severity: "ERROR",
            category: "knowledge",
            entityId: characterId,
            episode,
            evidence: fact.certainPatterns.find((pattern) => includesText(text, pattern)) ?? fact.statement,
            expected: `${character?.name ?? characterId} does not have certain knowledge of ${fact.key} in episode ${episode}.`,
            actual: `The text asserts ${fact.key} as known.`,
            explanation: `${character?.name ?? characterId} does not yet know "${fact.statement}" in episode ${episode}.`,
            suggestedCorrection: "Remove the assertion or wait until the knowledge entry says the character is certain.",
          }));
        }
      }
    }

    if (isProtectedFact(fact) && fact.rolePhrase && fact.value) {
      const other = contradictsRole(text, fact.rolePhrase, fact.value, labels);
      if (other) {
        findings.push(makeFinding({
          algorithm: "knowledge",
          severity: "ERROR",
          category: "canon",
          entityId: fact.subjectEntityIds[0] ?? null,
          episode,
          evidence: windowAround(text, fact.rolePhrase),
          expected: `${fact.value} remains ${fact.rolePhrase}.`,
          actual: `${other} is described as ${fact.rolePhrase}.`,
          explanation: `Protected fact "${fact.statement}" says ${fact.value} is ${fact.rolePhrase}. The text assigns that role to ${other}.`,
          suggestedCorrection: "Restore the canonical role. Changing it requires a separate authorized canon revision.",
        }));
      }
    }

    if (isProtectedFact(fact) && fact.literalKind === "date" && fact.value) {
      const dates = extractDates(text);
      const foreign = dates.find((date) => date.toLocaleLowerCase() !== fact.value.toLocaleLowerCase());
      if (foreign) {
        findings.push(literalFinding(fact, episode, foreign));
      }
    }

    for (const literal of fact.forbiddenLiterals) {
      if (isProtectedFact(fact) && includesText(text, literal)) {
        findings.push(literalFinding(fact, episode, literal));
      }
    }
  }

  return findings;
}

function contradictsRole(text: string, rolePhrase: string, valueLabel: string, labels: string[]): string | null {
  const window = windowAround(text, rolePhrase);
  if (!window) return null;
  if (window.includes(valueLabel.toLocaleLowerCase())) return null;
  return labels.find((label) => label.toLocaleLowerCase() !== valueLabel.toLocaleLowerCase() && window.includes(label.toLocaleLowerCase())) ?? null;
}

function disclosureFinding(fact: NarrativeFact, episode: number, explanation: string): NarrativeFinding {
  return makeFinding({
    algorithm: "knowledge",
    severity: "ERROR",
    category: "knowledge",
    entityId: fact.subjectEntityIds[0] ?? null,
    episode,
    evidence: fact.statement.slice(0, 180),
    expected: fact.audienceRevealEpisode
      ? `Audience reveal no earlier than episode ${fact.audienceRevealEpisode}.`
      : "This author-only fact stays concealed.",
    actual: `Disclosed in episode ${episode}.`,
    explanation,
    suggestedCorrection: "Remove the disclosure from this episode.",
    automaticRepairSafe: true,
  });
}

function literalFinding(fact: NarrativeFact, episode: number, actual: string): NarrativeFinding {
  return makeFinding({
    algorithm: "knowledge",
    severity: "ERROR",
    category: "canon",
    entityId: fact.subjectEntityIds[0] ?? null,
    episode,
    evidence: actual,
    expected: fact.value || fact.statement,
    actual,
    explanation: `Protected fact ${fact.key} is "${fact.value || fact.statement}". The text uses "${actual}" instead.`,
    suggestedCorrection: "Restore the canonical value. Changing it requires a separate authorized canon revision.",
  });
}
