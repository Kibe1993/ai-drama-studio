import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { FindingGroup } from "@/lib/validation/seasonPlanValidation";

/**
 * Source Investigator — retrieves the relevant source material for a finding
 * group so the diagnoser can inspect the actual story before deciding whether
 * and how to revise it.
 *
 * The investigator is a pure projection function: it takes all available
 * artifacts and returns only the subset relevant to the finding group.
 * It never modifies anything and never calls an LLM.
 */

export interface SourceEvidence {
  bibleSummary: string;
  seasonObjective: string;
  affectedEpisodePlans: EpisodePlanItem[];
  previousEpisodePlans: EpisodePlanItem[];
  subsequentEpisodePlans: EpisodePlanItem[];
  characterRecords: string[];
  relationshipRecords: string[];
  locationRecords: string[];
  ledgerCharacterStates: string[];
  ledgerEvents: string[];
  ledgerUnresolvedThreads: string[];
  setupPayoffRecords: string[];
  importantRevelations: string[];
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function bibleCharacterNames(bible: StoryBibleContent | null): string[] {
  if (!bible) return [];
  return bible.characters.characters.map((c) => c.name);
}

function bibleLocationNames(bible: StoryBibleContent | null): string[] {
  if (!bible) return [];
  return bible.world.geographyAndLocations.map((l) => l.name);
}

function bibleRelationships(bible: StoryBibleContent | null): string[] {
  if (!bible) return [];
  const relationships: string[] = [];
  for (const character of bible.characters.characters) {
    for (const rel of character.relationships) {
      relationships.push(`${character.name} → ${rel.characterName}: ${rel.relationship}`);
    }
  }
  return relationships;
}

function bibleSummary(bible: StoryBibleContent | null): string {
  if (!bible) return "No Story Bible available.";
  const parts: string[] = [
    `Title: ${bible.identity.title}`,
    `Premise: ${bible.identity.centralPremise}`,
    `Central Conflict: ${bible.identity.centralConflict}`,
    `Characters: ${bible.characters.characters.map((c) => `${c.name} (${c.storyRole})`).join(", ")}`,
    `Locations: ${bibleLocationNames(bible).join(", ")}`,
  ];
  if (bible.canon.confirmedFacts.length > 0) {
    parts.push(`Confirmed Facts: ${bible.canon.confirmedFacts.slice(0, 5).join("; ")}`);
  }
  if (bible.guidelines.mustRemainConsistent.length > 0) {
    parts.push(`Must Remain Consistent: ${bible.guidelines.mustRemainConsistent.slice(0, 5).join("; ")}`);
  }
  return parts.join("\n");
}

function findEpisode(plan: SeasonPlan, episodeNumber: number): EpisodePlanItem | null {
  return plan.episodeProgression.find((ep) => ep.episodeNumber === episodeNumber) ?? null;
}

function relevantLedgerCharacters(
  ledger: ContinuityLedger | null,
  entity: string | null,
): string[] {
  if (!ledger) return [];
  if (!entity) return ledger.characterStates.map((c) => `${c.name}: ${c.currentObjective}`);
  return ledger.characterStates
    .filter((c) => normalizeName(c.name).includes(normalizeName(entity)))
    .map((c) => `${c.name}: location=${c.currentLocation}, objective=${c.currentObjective}, emotional=${c.emotionalState}`);
}

function relevantLedgerEvents(
  ledger: ContinuityLedger | null,
  episodes: number[],
): string[] {
  if (!ledger) return [];
  if (episodes.length === 0) return ledger.events.slice(-5).map((e) => `Ep${e.episodeNumber}: ${e.event} → ${e.consequence}`);
  const episodeSet = new Set(episodes);
  return ledger.events
    .filter((e) => episodeSet.has(e.episodeNumber))
    .map((e) => `Ep${e.episodeNumber}: ${e.event} → ${e.consequence}`);
}

function relevantLedgerThreads(
  ledger: ContinuityLedger | null,
  entity: string | null,
): string[] {
  if (!ledger) return [];
  return ledger.unresolvedThreads
    .filter((t) => t.status !== "resolved")
    .filter((t) => !entity || normalizeName(t.thread).includes(normalizeName(entity)))
    .map((t) => `${t.thread} (introduced ep ${t.introducedInEpisode}, status: ${t.status})`);
}

export interface InvestigationInput {
  group: FindingGroup;
  plan: SeasonPlan;
  bible: StoryBibleContent | null;
  ledger: ContinuityLedger | null;
}

export function investigateFinding(input: InvestigationInput): SourceEvidence {
  const { group, plan, bible, ledger } = input;
  const episodes = group.affectedEpisodes;
  const entity = group.sharedEntity;

  const affectedEpisodePlans: EpisodePlanItem[] = [];
  const previousEpisodePlans: EpisodePlanItem[] = [];
  const subsequentEpisodePlans: EpisodePlanItem[] = [];

  for (const epNum of episodes) {
    const ep = findEpisode(plan, epNum);
    if (ep) affectedEpisodePlans.push(ep);

    for (let prev = epNum - 1; prev >= Math.max(1, epNum - 2); prev -= 1) {
      const prevEp = findEpisode(plan, prev);
      if (prevEp && !previousEpisodePlans.some((e) => e.episodeNumber === prev)) {
        previousEpisodePlans.push(prevEp);
      }
    }

    for (let next = epNum + 1; next <= epNum + 3; next += 1) {
      const nextEp = findEpisode(plan, next);
      if (nextEp && !subsequentEpisodePlans.some((e) => e.episodeNumber === next)) {
        subsequentEpisodePlans.push(nextEp);
      }
    }
  }

  previousEpisodePlans.sort((a, b) => a.episodeNumber - b.episodeNumber);
  subsequentEpisodePlans.sort((a, b) => a.episodeNumber - b.episodeNumber);

  return {
    bibleSummary: bibleSummary(bible),
    seasonObjective: plan.seasonObjective,
    affectedEpisodePlans,
    previousEpisodePlans,
    subsequentEpisodePlans,
    characterRecords: bibleCharacterNames(bible),
    relationshipRecords: bibleRelationships(bible),
    locationRecords: bibleLocationNames(bible),
    ledgerCharacterStates: relevantLedgerCharacters(ledger, entity),
    ledgerEvents: relevantLedgerEvents(ledger, episodes),
    ledgerUnresolvedThreads: relevantLedgerThreads(ledger, entity),
    setupPayoffRecords: plan.setupAndPayoff,
    importantRevelations: plan.importantRevelations,
  };
}