import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import { canonStateSchema, type CanonState, type FactClassification } from "@/lib/validation/narrativeControl";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import { normalizeName, slugId } from "@/lib/domain/narrativeControl/text";
import { describeWorldRule } from "@/lib/domain/narrativeControl/worldRules";

const TOKEN_STOP = new Set([
  "the", "and", "that", "with", "have", "this", "from", "they", "them", "then",
  "there", "their", "into", "about", "after", "before", "because", "while",
  "where", "which", "would", "could", "should", "does", "your", "you", "for",
  "his", "her", "she", "him", "its", "are", "was", "were", "been", "being",
  "had", "has", "not", "but", "what", "when", "who", "how", "why", "every",
]);

/**
 * Project an approved Story Bible and Continuity Ledger into a canon snapshot.
 * This is a starting version for projects that do not yet have a stored canon.
 * Later revisions are committed through the narrative-control store, not by
 * rereading the latest screenplay.
 */
export function canonFromApprovedSources(input: {
  projectId: string;
  bible: StoryBibleContent | null;
  ledger?: ContinuityLedger | null;
  bibleVersion?: number;
  planVersion?: number;
}): CanonState {
  const entities: Record<string, unknown>[] = [];
  const relationships: Record<string, unknown>[] = [];
  const facts: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const threads: Record<string, unknown>[] = [];
  const knowledge: Record<string, unknown>[] = [];
  const establishedStatements: string[] = [];
  const seen = new Set<string>();

  const addEntity = (entity: Record<string, unknown>) => {
    const id = String(entity.id);
    if (seen.has(id)) return;
    seen.add(id);
    entities.push(entity);
  };

  const addFact = (
    key: string,
    statement: string,
    classification: FactClassification,
    isProtected: boolean,
  ) => {
    const id = slugId("fact", `${key}-${statement}`);
    if (seen.has(id)) return;
    seen.add(id);
    if (classification === "ESTABLISHED_CANON" || classification === "AUDIENCE_KNOWLEDGE") {
      establishedStatements.push(statement);
    }
    facts.push({ id, key, statement, classification, protected: isProtected, ...roleFields(statement) });
  };

  const bible = input.bible;
  if (bible) {
    for (const character of bible.characters.characters) {
      addEntity({
        id: slugId("character", character.name),
        kind: "character",
        name: character.name,
        aliases: extractAliases(character.name, [
          character.roleDescription,
          character.physicalDescription,
          character.background,
        ]),
        description: character.roleDescription,
        role: character.storyRole,
        motivations: character.motivations,
        goals: character.fearsAndWeaknesses,
        arc: character.developmentPotential,
        secrets: character.secrets,
        lifecycle: "unknown",
      });
    }
    for (const location of bible.world.geographyAndLocations) {
      addEntity({
        id: slugId("location", location.name),
        kind: "location",
        name: location.name,
        description: location.description,
        locationRules: [],
        lifecycle: "unknown",
      });
    }
    const characterId = (name: string) => slugId("character", name);
    for (const character of bible.characters.characters) {
      for (const relation of character.relationships) {
        const otherId = characterId(relation.characterName);
        if (!seen.has(otherId)) continue;
        const pair = [characterId(character.name), otherId].sort() as [string, string];
        const id = slugId("relationship", `${pair[0]}-${pair[1]}-${relation.relationship}`);
        if (seen.has(id)) continue;
        seen.add(id);
        relationships.push({
          id,
          characterIds: pair,
          relationshipType: relation.relationship,
          initialState: relation.tensionOrChange,
          currentState: relation.tensionOrChange,
          introducedEpisode: 1,
          historical: true,
        });
      }
    }
    for (const statement of bible.canon.confirmedFacts) addFact("confirmed", statement, "ESTABLISHED_CANON", true);
    for (const statement of bible.guidelines.mustRemainConsistent) addFact("consistent", statement, "ESTABLISHED_CANON", true);
    for (const statement of bible.canon.hiddenInformation) addFact("hidden", statement, "HIDDEN_TRUTH", true);
    for (const statement of bible.canon.proposedDetails) addFact("proposed", statement, "PROVISIONAL", false);
    for (const statement of bible.canon.audienceKnowledge) addFact("audience", statement, "AUDIENCE_KNOWLEDGE", true);
    for (const character of bible.characters.characters) {
      const characterId = slugId("character", character.name);
      for (const secret of character.secrets) {
        if (overlapsEstablished(secret, establishedStatements)) continue;
        const id = slugId("fact", `secret-${secret}`);
        if (seen.has(id)) continue;
        seen.add(id);
        facts.push({
          id,
          key: "secret",
          statement: secret,
          classification: "AUTHOR_TRUTH",
          protected: true,
          subjectEntityIds: [characterId],
          ...roleFields(secret),
        });
        knowledge.push({
          id: slugId("knowledge", `${characterId}-${id}`),
          characterId,
          factId: id,
          knownFromEpisode: 1,
          learnedVia: "Recorded as this character's secret in the approved Story Bible.",
          believes: true,
          certainty: "certain",
        });
      }
    }
    for (const rule of bible.world.rules) {
      const id = slugId("rule", rule);
      if (seen.has(id)) continue;
      seen.add(id);
      const described = describeWorldRule(rule);
      rules.push({
        id,
        description: rule,
        scope: "story",
        approvalStatus: "approved",
        establishedRef: `bible:${input.bibleVersion ?? 0}`,
        canonicalInterval: described.canonicalInterval,
        conditions: described.conditions,
      });
    }
    for (const entry of bible.canon.characterKnowledge) {
      const characterId = slugId("character", entry.characterName);
      if (!seen.has(characterId)) continue;
      for (const statement of entry.knows) {
        const factId = slugId("fact", `knowledge-${statement}`);
        if (!seen.has(factId)) {
          seen.add(factId);
          facts.push({
            id: factId,
            key: "character_knowledge",
            statement,
            classification: "CHARACTER_KNOWLEDGE",
            protected: false,
            subjectEntityIds: [characterId],
            ...roleFields(statement),
          });
        }
        const knowledgeId = slugId("knowledge", `${characterId}-${factId}`);
        if (seen.has(knowledgeId)) continue;
        seen.add(knowledgeId);
        knowledge.push({
          id: knowledgeId,
          characterId,
          factId,
          knownFromEpisode: 1,
          learnedVia: "Recorded as this character's knowledge in the approved Story Bible.",
          believes: true,
          certainty: "certain",
        });
      }
      for (const statement of entry.believes) {
        const factId = slugId("fact", `belief-${statement}`);
        if (!seen.has(factId)) {
          seen.add(factId);
          facts.push({
            id: factId,
            key: "character_belief",
            statement,
            classification: "CHARACTER_KNOWLEDGE",
            protected: false,
            subjectEntityIds: [characterId],
            ...roleFields(statement),
          });
        }
        const knowledgeId = slugId("knowledge", `${characterId}-${factId}`);
        if (seen.has(knowledgeId)) continue;
        seen.add(knowledgeId);
        knowledge.push({
          id: knowledgeId,
          characterId,
          factId,
          knownFromEpisode: 1,
          learnedVia: "Recorded as this character's belief in the approved Story Bible.",
          believes: true,
          certainty: "suspected",
        });
      }
    }
  }

  const ledger = input.ledger;
  if (ledger) {
    for (const location of ledger.locationStates) {
      addEntity({
        id: slugId("location", location.name),
        kind: "location",
        name: location.name,
        description: location.currentState,
        lifecycle: "active",
        appearances: [location.lastSeenEpisode],
      });
    }
    for (const object of ledger.objectStates) {
      addEntity({
        id: slugId("object", object.name),
        kind: "object",
        name: object.name,
        description: object.condition,
        significance: object.ownership,
        lifecycle: "active",
      });
    }
    for (const event of ledger.events) {
      const id = slugId("event", `${event.episodeNumber}-${event.event}`);
      if (seen.has(id)) continue;
      seen.add(id);
      events.push({
        id,
        description: event.event,
        episode: event.episodeNumber,
        acknowledgement: "optional",
      });
    }
    for (const thread of ledger.unresolvedThreads) {
      const id = slugId("thread", thread.thread);
      if (seen.has(id)) continue;
      seen.add(id);
      threads.push({
        id,
        description: thread.thread,
        category: "mystery",
        status: thread.status === "resolved" ? "resolved" : "active",
        scope: "secondary",
        introducedEpisode: thread.introducedInEpisode,
      });
    }
    for (const secret of ledger.revealedSecrets) addFact("audience", secret, "AUDIENCE_KNOWLEDGE", true);
    for (const state of ledger.characterStates) {
      const id = slugId("character", state.name);
      const existing = entities.find((e) => e.id === id);
      const desc = [
        `Currently at ${state.currentLocation}.`,
        `Objective: ${state.currentObjective}.`,
        state.emotionalState,
        state.physicalState ? `Physical state: ${state.physicalState}.` : "",
      ].filter(Boolean).join(" ");
      if (existing) {
        existing.description = desc;
      } else {
        addEntity({
          id,
          kind: "character",
          name: state.name,
          description: desc,
          lifecycle: "active",
        });
      }
      for (const item of state.knowledge) {
        const factId = slugId("fact", `ledger-knowledge-${item}`);
        if (!seen.has(factId)) {
          seen.add(factId);
          facts.push({
            id: factId,
            key: "ledger_knowledge",
            statement: item,
            classification: "CHARACTER_KNOWLEDGE",
            protected: false,
            subjectEntityIds: [id],
            ...roleFields(item),
          });
        }
        const knowledgeId = slugId("knowledge", `${id}-${factId}`);
        if (!seen.has(knowledgeId)) {
          seen.add(knowledgeId);
          knowledge.push({
            id: knowledgeId,
            characterId: id,
            factId,
            knownFromEpisode: 1,
            learnedVia: "Established through the continuity ledger.",
            believes: true,
            certainty: "certain",
          });
        }
      }
    }
    const revealEpisodeByStatement = new Map<string, number>();
    for (const event of ledger.events) {
      for (const info of event.revealedInformation) {
        const key = normalizeName(info);
        if (!revealEpisodeByStatement.has(key)) {
          revealEpisodeByStatement.set(key, event.episodeNumber);
        }
      }
    }
    const latestEpisode = ledger.events.length > 0
      ? Math.max(...ledger.events.map((e) => e.episodeNumber))
      : 1;
    for (const secret of ledger.revealedSecrets) {
      const key = normalizeName(secret);
      if (!revealEpisodeByStatement.has(key)) {
        revealEpisodeByStatement.set(key, latestEpisode);
      }
    }
    for (const fact of facts) {
      if (fact.classification !== "HIDDEN_TRUTH") continue;
      if (fact.audienceRevealEpisode !== null && fact.audienceRevealEpisode !== undefined) continue;
      for (const [revealed, episode] of revealEpisodeByStatement) {
        if (overlapsEstablished(String(fact.statement), [revealed])) {
          fact.audienceRevealEpisode = episode;
          break;
        }
      }
    }
  }

  return canonStateSchema.parse({
    projectId: input.projectId,
    version: 0,
    basedOnBibleVersion: input.bibleVersion ?? 0,
    basedOnPlanVersion: input.planVersion ?? 0,
    entities,
    relationships,
    events,
    threads,
    facts,
    knowledge,
    rules,
  });
}

function roleFields(statement: string): { value?: string; rolePhrase?: string } {
  const role = /\b(brother|sister|journalist|mother|father|daughter|son)\b/i.exec(statement);
  const name = /^([A-Za-z][A-Za-z'-]{1,40})\b/.exec(statement.trim());
  const label = name?.[1];
  const phrase = role?.[1];
  if (!label || !phrase || !/\bis\b/i.test(statement)) return {};
  return { value: label, rolePhrase: phrase.toLocaleLowerCase() };
}

function overlapsEstablished(secret: string, statements: string[]): boolean {
  const left = contentTokens(secret);
  if (left.length === 0) return false;
  return statements.some((statement) => {
    const right = new Set(contentTokens(statement));
    const shared = left.filter((token) => right.has(token));
    const needed = Math.min(2, left.length);
    const smaller = Math.min(left.length, right.size || 1);
    return shared.length >= needed && shared.length / smaller >= 0.5;
  });
}

function contentTokens(value: string): string[] {
  return normalizeName(value).split(" ").filter((word) => word.length >= 4 && !TOKEN_STOP.has(word));
}
/**
 * Extract alternate names (aliases) for a character from their text fields.
 * Looks for patterns like "called Robert", "named Alice", "known as Bob",
 * "aka Robert" in the role description, physical description, and background.
 * The character's own name is excluded, as are duplicates.
 */
function extractAliases(canonicalName: string, texts: string[]): string[] {
  const aliases = new Set<string>();
  const normalizedSelf = normalizeName(canonicalName);
  const selfParts = new Set(normalizedSelf.split(" ").filter((p) => p.length > 0));
  const pattern = /\b(?:called|named|known\s+as|aka|a\.k\.a\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(pattern)) {
      const alias = match[1]!.trim();
      if (!alias) continue;
      const normalized = normalizeName(alias);
      if (normalized === normalizedSelf) continue;
      if (selfParts.has(normalized)) continue;
      if (normalizedSelf.split(" ").includes(normalized)) continue;
      aliases.add(alias);
    }
  }
  return [...aliases].slice(0, 24);
}
