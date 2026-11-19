import { log } from "@/lib/log";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { DerivedCanonState } from "@/lib/canon/schema";

export type ShadowDiff = {
  factsInLogNotInLedger: string[];
  ledgerEntriesWithoutEvidence: string[];
  characterStateDifferences: CharacterStateDifference[];
};

export type CharacterStateDifference = {
  characterName: string;
  field: string;
  ledgerValue: string;
  canonValue: string;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function textContains(haystack: string, needle: string): boolean {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (n.length === 0) return false;
  if (n.length <= 40) return h.includes(n);
  return h.includes(n.slice(0, 40));
}

function anyContains(haystacks: string[], needle: string): boolean {
  return haystacks.some((h) => textContains(h, needle));
}

function collectLedgerText(ledger: ContinuityLedger): string[] {
  const texts: string[] = [];
  for (const e of ledger.events) {
    texts.push(e.event);
    texts.push(e.consequence);
    texts.push(...e.revealedInformation);
  }
  texts.push(...ledger.revealedSecrets);
  texts.push(...ledger.consequences);
  for (const cs of ledger.characterStates) {
    texts.push(...cs.knowledge);
    texts.push(...cs.beliefs);
  }
  return texts;
}

export function compareCanonShadow(
  ledger: ContinuityLedger | null,
  canonState: DerivedCanonState,
): ShadowDiff {
  if (!ledger) {
    return {
      factsInLogNotInLedger: canonState.facts.map((f) => f.statement),
      ledgerEntriesWithoutEvidence: [],
      characterStateDifferences: [],
    };
  }

  const ledgerTexts = collectLedgerText(ledger);

  const factsInLogNotInLedger: string[] = [];
  for (const fact of canonState.facts) {
    if (!anyContains(ledgerTexts, fact.statement)) {
      factsInLogNotInLedger.push(fact.statement);
    }
  }

  const ledgerEntriesWithoutEvidence: string[] = [];

  for (const evt of ledger.events) {
    const found = canonState.events.some((ce) =>
      textContains(ce.description, evt.event) || textContains(evt.event, ce.description),
    );
    if (!found) {
      ledgerEntriesWithoutEvidence.push(`event:${evt.event}`);
    }
  }

  for (const secret of ledger.revealedSecrets) {
    const found = canonState.facts.some((f) => textContains(f.statement, secret));
    if (!found) {
      ledgerEntriesWithoutEvidence.push(`secret:${secret}`);
    }
  }

  for (const consequence of ledger.consequences) {
    const found = canonState.events.some((ce) =>
      textContains(ce.description, consequence),
    ) || canonState.facts.some((f) => textContains(f.statement, consequence));
    if (!found) {
      ledgerEntriesWithoutEvidence.push(`consequence:${consequence}`);
    }
  }

  const characterStateDifferences: CharacterStateDifference[] = [];
  const canonCharacters = canonState.entities.filter((e) => e.kind === "character");

  for (const cs of ledger.characterStates) {
    const entity = canonCharacters.find(
      (e) =>
        normalize(e.name) === normalize(cs.name) ||
        e.aliases.some((a) => normalize(a) === normalize(cs.name)),
    );

    if (!entity) {
      ledgerEntriesWithoutEvidence.push(`character:${cs.name}`);
      continue;
    }

    if (cs.currentObjective && entity.goals.length > 0) {
      if (!textContains(entity.goals[0]!, cs.currentObjective) &&
          !textContains(cs.currentObjective, entity.goals[0]!)) {
        characterStateDifferences.push({
          characterName: cs.name,
          field: "currentObjective",
          ledgerValue: cs.currentObjective,
          canonValue: entity.goals[0]!,
        });
      }
    }

    if (cs.emotionalState && entity.arc) {
      if (!textContains(entity.arc, cs.emotionalState) &&
          !textContains(cs.emotionalState, entity.arc)) {
        characterStateDifferences.push({
          characterName: cs.name,
          field: "emotionalState",
          ledgerValue: cs.emotionalState,
          canonValue: entity.arc,
        });
      }
    }

    if (cs.knowledge.length > 0) {
      for (const k of cs.knowledge) {
        const found = entity.secrets.some((s) => textContains(s, k)) ||
          canonState.facts.some((f) => textContains(f.statement, k));
        if (!found) {
          characterStateDifferences.push({
            characterName: cs.name,
            field: "knowledge",
            ledgerValue: k,
            canonValue: "(not found in canon)",
          });
        }
      }
    }
  }

  return {
    factsInLogNotInLedger,
    ledgerEntriesWithoutEvidence,
    characterStateDifferences,
  };
}

export function logShadowDiff(
  diff: ShadowDiff,
  context: { projectId: string; episodeId: string; episodeNumber: number },
): void {
  try {
    if (diff.factsInLogNotInLedger.length > 0) {
      log.info("canon-shadow", "facts in canon log not in legacy ledger", {
        ...context,
        count: diff.factsInLogNotInLedger.length,
        sample: diff.factsInLogNotInLedger.slice(0, 3).join(" | "),
      });
    }
    if (diff.ledgerEntriesWithoutEvidence.length > 0) {
      log.info("canon-shadow", "ledger entries with no evidence in canon log", {
        ...context,
        count: diff.ledgerEntriesWithoutEvidence.length,
        sample: diff.ledgerEntriesWithoutEvidence.slice(0, 3).join(" | "),
      });
    }
    if (diff.characterStateDifferences.length > 0) {
      log.info("canon-shadow", "character states differ between ledger and canon", {
        ...context,
        count: diff.characterStateDifferences.length,
        sample: diff.characterStateDifferences
          .slice(0, 3)
          .map((d) => `${d.characterName}.${d.field}`)
          .join(" | "),
      });
    }
    if (
      diff.factsInLogNotInLedger.length === 0 &&
      diff.ledgerEntriesWithoutEvidence.length === 0 &&
      diff.characterStateDifferences.length === 0
    ) {
      log.info("canon-shadow", "legacy ledger and canon log agree", context);
    }
  } catch {
    // Shadow comparison must never block or throw.
  }
}