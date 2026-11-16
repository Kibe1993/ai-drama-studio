import type { CanonState, NarrativeFact, NarrativeGenerationRequest } from "@/lib/validation/narrativeControl";
import { isProtectedFact } from "@/lib/validation/narrativeControl";

export interface NarrativeContextPacket {
  request: NarrativeGenerationRequest;
  canonVersion: number;
  mandatoryFacts: NarrativeFact[];
  mandatoryRuleIds: string[];
  relevantEntityIds: string[];
  relevantEventIds: string[];
  relevantThreadIds: string[];
  knowledgeIds: string[];
  optionalNotes: string[];
  prohibitedDisclosures: { factId: string; statement: string; availableEpisode: number | null }[];
  prohibitedChanges: string[];
}

const cache = new Map<string, NarrativeContextPacket>();
const CACHE_LIMIT = 32;

export function invalidateContextCache(projectId?: string): void {
  if (!projectId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${projectId}:`)) cache.delete(key);
  }
}

function hiddenFromEpisode(fact: NarrativeFact, episode: number): boolean {
  if (fact.classification === "RETRACTED" || fact.classification === "PROVISIONAL") return false;
  if (fact.classification === "HIDDEN_TRUTH" || fact.classification === "AUTHOR_TRUTH") {
    return fact.audienceRevealEpisode === null || episode < fact.audienceRevealEpisode;
  }
  return fact.audienceRevealEpisode !== null && episode < fact.audienceRevealEpisode;
}

/**
 * Build a bounded context packet from one canon version.
 * Hidden facts are constraints, not creative material. Protected facts that
 * the episode could violate are never dropped.
 */
export function assembleNarrativeContext(input: {
  canon: CanonState;
  request: NarrativeGenerationRequest;
  scopeEntityIds?: string[];
}): NarrativeContextPacket {
  const episode = input.request.episode ?? 1;
  const scope = new Set(input.scopeEntityIds ?? []);
  const key = [
    input.canon.projectId,
    input.canon.version,
    episode,
    input.request.objective,
    input.request.targetArtifact,
    [...scope].sort().join(","),
  ].join(":");
  const cached = cache.get(key);
  if (cached) return cached;

  const packet = buildPacket(input.canon, input.request, scope, episode);
  cache.set(key, packet);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return packet;
}

function buildPacket(
  canon: CanonState,
  request: NarrativeGenerationRequest,
  scope: Set<string>,
  episode: number,
): NarrativeContextPacket {
  const inScope = (ids: string[]) => ids.length === 0 || ids.some((id) => scope.size === 0 || scope.has(id));
  const mandatoryFacts = canon.facts.filter((fact) => {
    if (fact.classification === "PROVISIONAL") return false;
    if (isProtectedFact(fact) || fact.classification === "RETRACTED") return true;
    return inScope(fact.subjectEntityIds);
  });
  const prohibitedDisclosures = canon.facts
    .filter((fact) => hiddenFromEpisode(fact, episode))
    .map((fact) => ({
      factId: fact.id,
      statement: fact.statement,
      availableEpisode: fact.audienceRevealEpisode,
    }));
  const hiddenIds = new Set(prohibitedDisclosures.map((item) => item.factId));
  const relevantEvents = canon.events.filter((event) => {
    if (event.episode > episode) return false;
    if (event.audienceEpisode !== null && event.audienceEpisode > episode) return false;
    return event.episode >= episode - 1 || event.participantIds.some((id) => scope.has(id));
  });
  const relevantThreads = canon.threads.filter((thread) =>
    thread.introducedEpisode <= episode
    && thread.status !== "resolved"
    && thread.status !== "paid_off",
  );
  const knowledge = canon.knowledge.filter((entry) =>
    entry.knownFromEpisode <= episode && (scope.size === 0 || scope.has(entry.characterId)),
  );

  return {
    request,
    canonVersion: canon.version,
    mandatoryFacts: mandatoryFacts.filter((fact) => !hiddenIds.has(fact.id) || fact.classification === "RETRACTED"),
    mandatoryRuleIds: canon.rules.filter((rule) => rule.approvalStatus === "approved").map((rule) => rule.id),
    relevantEntityIds: canon.entities
      .filter((entity) => scope.size === 0 || scope.has(entity.id))
      .map((entity) => entity.id),
    relevantEventIds: relevantEvents.map((event) => event.id),
    relevantThreadIds: relevantThreads.map((thread) => thread.id),
    knowledgeIds: knowledge.map((entry) => entry.id),
    optionalNotes: [],
    prohibitedDisclosures,
    prohibitedChanges: canon.facts.filter(isProtectedFact).map((fact) => fact.id),
  };
}

export function renderNarrativeContext(canon: CanonState, packet: NarrativeContextPacket): string {
  const byId = new Map(canon.facts.map((fact) => [fact.id, fact]));
  const rules = canon.rules.filter((rule) => packet.mandatoryRuleIds.includes(rule.id));
  const entities = canon.entities.filter((entity) => packet.relevantEntityIds.includes(entity.id));
  const knowledge = canon.knowledge.filter((entry) => packet.knowledgeIds.includes(entry.id));
  const lines = [
    "NARRATIVE AUTHORITY. The application owns canon. You may propose a change. You cannot approve or commit one.",
    "Priority 1 — Safety: do not reveal concealed facts and do not change protected facts.",
    "Priority 2 — Approved canonical facts:",
    ...packet.mandatoryFacts.map((fact) => `- [${fact.classification}] ${fact.key}: ${fact.statement}`),
    "Priority 3 — Protected decisions:",
    ...packet.prohibitedChanges.map((factId) => {
      const fact = byId.get(factId);
      return fact ? `- Do not change ${fact.key} (${fact.value || fact.statement}).` : `- Do not change ${factId}.`;
    }),
    "Priority 4 — Task constraints:",
    `Objective: ${packet.request.objective}`,
    `Canon version: ${packet.canonVersion}. Target: ${packet.request.targetArtifact}.`,
    "Priority 5 — Output: return the artifact in the schema the application requested. You cannot approve or commit canon.",
    "Priority 6 — Creative objective: improve the requested artifact inside the boundaries above.",
    "Priority 7 — Style is optional and yields to every boundary above.",
    "Concealed until the stated episode. Do not dramatize these as known:",
    ...packet.prohibitedDisclosures.map((item) =>
      `- ${item.statement} (fact ${item.factId}, available episode ${item.availableEpisode ?? "unset"}).`,
    ),
    "Relevant identities:",
    ...entities.map((entity) => `- ${entity.id}: ${entity.name}; aliases: ${entity.aliases.join(", ") || "none"}.`),
    "Relevant rules:",
    ...rules.map((rule) => `- ${rule.id}: ${rule.description}`),
    "Knowledge already available to characters:",
    ...knowledge.map((entry) => `- ${entry.characterId} / ${entry.factId}: ${entry.certainty} from episode ${entry.knownFromEpisode}.`),
  ];
  return lines.join("\n");
}
