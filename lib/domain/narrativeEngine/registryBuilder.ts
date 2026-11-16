import type {
  NarrativeRegistry,
  NarrativeEntity,
  NarrativeEvent,
  RelationshipState,
  NarrativeThread,
  EpisodeNarrativeState,
  CausalLink,
  KnowledgeChange,
  EntityId,
  NarrativeRegistryContext,
  LifecycleStatus,
  EntityImportance,
  ThreadImportance,
  EventType,
  NarrativeThreadStatus,
} from "@/lib/validation/narrativeEngine";
import {
  normalizeEntityName,
  NARRATIVE_REGISTRY_SCHEMA_VERSION,
} from "@/lib/validation/narrativeEngine";
import type { CanonicalEntityRegistry, EntityLifecycle } from "@/lib/validation/canonicalRegistry";
import { makeCanonicalId } from "@/lib/validation/canonicalRegistry";
import { resolveCanonicalId } from "@/lib/domain/canonicalRegistry";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { SeasonPlan } from "@/lib/validation/seasonPlan";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { CharacterProfile } from "@/lib/validation/productionStages";

const DEATH_KEYWORDS = /\b(dies?|death|killed|perishes?|falls?\s+to\s+death|lifeless|corpse)\b/i;
const DEPARTURE_KEYWORDS = /\b(leaves?|departs?|exits?|goes\s+away|vanishes?|disappears?|retreats?)\b/i;
const REVELATION_KEYWORDS = /\b(reveal|discovers?|learns?|realizes?|uncovers?|finds?\s+out|remembers?|confesses?)\b/i;
const DECISION_KEYWORDS = /\b(decides?|chooses?|commits?\s+to|resolves?\s+to|determines?)\b/i;
const CONFLICT_KEYWORDS = /\b(confronts?|clashes?|fights?|battles?|opposes?|resists?)\b/i;
const ARRIVAL_KEYWORDS = /\b(arrives?|appears?|enters?|shows\s+up|steps\s+out|comes\s+in|materializes?)\b/i;
const DISCOVERY_KEYWORDS = /\b(discover|finds?|uncovers?|stumbles?\s+upon|locates?|identifies?)\b/i;
const LOCATION_CHANGE_KEYWORDS = /\b(travels?\s+to|goes?\s+to|moves?\s+to|returns?\s+to|heads?\s+to)\b/i;
const OBJECT_INTRODUCTION_KEYWORDS = /\b(finds?|obtains?|receives?|acquires?|picks?\s+up|takes?\s+possession)\b/i;
const RULE_ESTABLISHED_KEYWORDS = /\b(establishes?|sets?\s+up|creates?\s+a\s+rule|the\s+rule\s+is)\b/i;
const RULE_BROKEN_KEYWORDS = /\b(breaks?\s+the\s+rule|violates?|defies?|circumvents?)\b/i;


const UNRESOLVED_INDICATORS = /\b(unresolved|open.?ended|carry.*forward|next\s+season|remain|unanswered)\b/i;
const ABANDONED_INDICATORS = /\b(abandoned|dropped|forgotten|no\s+longer\s+pursued?)\b/i;
const CARRY_FORWARD_INDICATORS = /\b(carry.*forward|next\s+season|future\s+season|to\s+be\s+continued|sequel|series\s+hook)\b/i;
const SETUP_INDICATORS = /\b(setup|sets?\s+up|prepares?|plants?|foreshadow|hints?|promises?|establishes?)\b/i;
const PAYOFF_INDICATORS = /\b(pays?\s+off|payoff|resolves?|answers?|fulfils?|fulfills?|delivers?\s+on|reveals?)\b/i;
const MAJOR_INDICATORS = /\b(major|central|key|primary|critical|main)\b/i;

function classifyEventType(text: string): EventType {
  if (DEATH_KEYWORDS.test(text)) return "death";
  if (DEPARTURE_KEYWORDS.test(text)) return "departure";
  if (ARRIVAL_KEYWORDS.test(text)) return "arrival";
  if (REVELATION_KEYWORDS.test(text)) return "revelation";
  if (DISCOVERY_KEYWORDS.test(text)) return "discovery";
  if (DECISION_KEYWORDS.test(text)) return "decision";
  if (CONFLICT_KEYWORDS.test(text)) return "conflict";
  if (LOCATION_CHANGE_KEYWORDS.test(text)) return "location_change";
  if (OBJECT_INTRODUCTION_KEYWORDS.test(text)) return "object_introduction";
  if (RULE_ESTABLISHED_KEYWORDS.test(text)) return "rule_established";
  if (RULE_BROKEN_KEYWORDS.test(text)) return "rule_broken";
  return "other";
}

function classifyThreadStatus(text: string): NarrativeThreadStatus {
  if (ABANDONED_INDICATORS.test(text)) return "abandoned";
  if (CARRY_FORWARD_INDICATORS.test(text)) return "intentionally_carried_forward";
  if (UNRESOLVED_INDICATORS.test(text)) return "unresolved";
  return "developing";
}

function classifyImportance(text: string): ThreadImportance {
  if (MAJOR_INDICATORS.test(text)) return "major";
  return "minor";
}

function entityImportance(role: string): EntityImportance {
  const r = role.toLowerCase();
  if (r.includes("protagonist") || r.includes("antagonist")) return "primary";
  if (r.includes("supporting") || r.includes("recurring")) return "supporting";
  return "minor";
}

function lifecycleFromCanonical(lc: EntityLifecycle | undefined): LifecycleStatus {
  if (!lc) return "unknown";
  if (lc.currentStatus === "deceased") return "deceased";
  if (lc.currentStatus === "departed") return "departed";
  if (lc.currentStatus === "concealed_identity") return "active";
  if (lc.currentStatus === "appeared" || lc.currentStatus === "introduced") return "active";
  if (lc.currentStatus === "mentioned_not_appeared") return "mentioned";
  if (lc.currentStatus === "temporarily_absent") return "temporarily_absent";
  if (lc.currentStatus === "off_screen_active") return "offscreen_active";
  if (lc.currentStatus === "not_yet_introduced") return "not_introduced";
  return "unknown";
}

function buildEntities(
  canonical: CanonicalEntityRegistry,
  bible: StoryBibleContent | null,
  characterProfiles?: CharacterProfile[],
): NarrativeEntity[] {
  const entities: NarrativeEntity[] = [];
  const profileMap = new Map<string, CharacterProfile>();
  for (const p of characterProfiles ?? []) {
    profileMap.set(normalizeEntityName(p.name), p);
  }

  for (const ce of canonical.entities) {
    if (ce.type === "relationship" || ce.type === "thread" || ce.type === "event") continue;

    const lc = canonical.lifecycles.find((l) => l.canonicalId === ce.canonicalId);
    const normalized = normalizeEntityName(ce.primaryName);
    const profile = profileMap.get(normalized);

    const aliases = ce.aliases.map((a) => ({
      value: a.name,
      normalizedValue: normalizeEntityName(a.name),
    }));

    let authorTruth: string | undefined;
    if (bible && ce.type === "character") {
      const char = bible.characters.characters.find((c) => normalizeEntityName(c.name) === normalized);
      if (char) {
        const truths: string[] = [];
        if (char.secrets) truths.push(...(Array.isArray(char.secrets) ? char.secrets : [char.secrets]));
        if (char.background) truths.push(char.background);
        const confirmed = bible.canon.confirmedFacts.filter((f) =>
          normalizeEntityName(f).includes(normalized),
        );
        if (confirmed.length > 0) truths.push(confirmed.join("; "));
        const hidden = bible.canon.hiddenInformation.filter((h) =>
          normalizeEntityName(h).includes(normalized),
        );
        if (hidden.length > 0) truths.push(hidden.join("; "));
        if (truths.length > 0) authorTruth = truths.join(" | ");
      }
    }

    const entityType: "character" | "location" | "object" | "organization" =
      ce.type === "character" ? "character" : ce.type === "location" ? "location" : "object";

    entities.push({
      id: ce.canonicalId,
      canonicalName: ce.primaryName,
      aliases,
      type: entityType,
      authorTruth,
      firstIntroductionEpisode: lc?.plannedIntroductionEpisode ?? lc?.firstAppearanceEpisode ?? undefined,
      firstAppearanceEpisode: lc?.firstAppearanceEpisode ?? undefined,
      lifecycle: lifecycleFromCanonical(lc),
      importance: entityImportance(ce.storyRole || profile?.role || ""),
    });
  }

  return entities;
}

function buildEvents(
  plan: SeasonPlan,
  canonical: CanonicalEntityRegistry,
  bible: StoryBibleContent | null,
): { events: NarrativeEvent[]; causalLinks: CausalLink[] } {
  const events: NarrativeEvent[] = [];
  const causalLinks: CausalLink[] = [];
  let eventCounter = 0;
  let occurrenceCounter = 0;

  for (const ep of plan.episodeProgression) {
    const epNum = ep.episodeNumber;

    for (const beat of ep.majorStoryBeats) {
      eventCounter += 1;
      occurrenceCounter += 1;
      const eventId = `event:${epNum}:${eventCounter}`;
      const type = classifyEventType(beat);
      const participants = extractParticipants(beat, canonical);
      const knowledgeChanges = extractKnowledgeChanges(beat, epNum, canonical, bible);

      events.push({
        id: eventId,
        episode: epNum,
        type,
        description: beat,
        occurrenceOrder: occurrenceCounter,
        audienceRevealEpisode: REVELATION_KEYWORDS.test(beat) ? epNum : undefined,
        audienceRevealOrder: REVELATION_KEYWORDS.test(beat) ? occurrenceCounter : undefined,
        participants,
        knowledgeChanges,
        causedBy: [],
        consequences: [],
        source: "season_plan",
        confidence: 1,
      });
    }

    for (const reveal of ep.informationRevealed) {
      eventCounter += 1;
      occurrenceCounter += 1;
      const eventId = `event:${epNum}:${eventCounter}`;
      const participants = extractParticipants(reveal, canonical);
      const knowledgeChanges = extractKnowledgeChanges(reveal, epNum, canonical, bible);

      events.push({
        id: eventId,
        episode: epNum,
        type: "revelation",
        description: reveal,
        occurrenceOrder: occurrenceCounter,
        audienceRevealEpisode: epNum,
        audienceRevealOrder: occurrenceCounter,
        participants,
        knowledgeChanges,
        causedBy: [],
        consequences: [],
        source: "season_plan",
        confidence: 1,
      });
    }

    for (const evt of ep.importantEvents) {
      eventCounter += 1;
      occurrenceCounter += 1;
      const eventId = `event:${epNum}:${eventCounter}`;
      const type = classifyEventType(evt);
      const participants = extractParticipants(evt, canonical);
      const knowledgeChanges = extractKnowledgeChanges(evt, epNum, canonical, bible);

      events.push({
        id: eventId,
        episode: epNum,
        type,
        description: evt,
        occurrenceOrder: occurrenceCounter,
        audienceRevealEpisode: REVELATION_KEYWORDS.test(evt) ? epNum : undefined,
        audienceRevealOrder: REVELATION_KEYWORDS.test(evt) ? occurrenceCounter : undefined,
        participants,
        knowledgeChanges,
        causedBy: [],
        consequences: [],
        source: "season_plan",
        confidence: 1,
      });
    }
  }

  for (let i = 0; i < events.length; i++) {
    const evt = events[i]!;
    if (evt.type === "consequence" || evt.type === "revelation" || evt.type === "discovery") {
      for (let j = 0; j < i; j++) {
        const prev = events[j]!;
        if (prev.episode < evt.episode && sharesKeyword(prev.description, evt.description)) {
          evt.causedBy.push(prev.id);
          prev.consequences.push(evt.id);
          causalLinks.push({
            sourceEventId: prev.id,
            targetEventId: evt.id,
            relationship: evt.type === "revelation" ? "reveals" : "causes",
            evidence: `"${prev.description.slice(0, 60)}" → "${evt.description.slice(0, 60)}"`,
          });
        }
      }
    }
  }

  for (const consequence of plan.consequencesCarriedBetween) {
    const sourceMatch = events.find((e) => e.description.includes(consequence.slice(0, 20)));
    if (sourceMatch) {
      const laterEvents = events.filter((e) => e.episode > sourceMatch.episode);
      const targetMatch = laterEvents.find((e) => sharesKeyword(e.description, consequence));
      if (targetMatch) {
        causalLinks.push({
          sourceEventId: sourceMatch.id,
          targetEventId: targetMatch.id,
          relationship: "causes",
          evidence: consequence,
        });
      }
    }
  }

  return { events, causalLinks };
}

function extractParticipants(text: string, canonical: CanonicalEntityRegistry): EntityId[] {
  const participants: EntityId[] = [];
  const seen = new Set<string>();
  for (const entity of canonical.entities) {
    if (entity.type !== "character") continue;
    const names = [entity.primaryName, ...entity.aliases.map((a) => a.name)];
    for (const name of names) {
      if (text.toLowerCase().includes(name.toLowerCase()) && !seen.has(entity.canonicalId)) {
        seen.add(entity.canonicalId);
        participants.push(entity.canonicalId);
        break;
      }
    }
  }
  return participants;
}

function extractKnowledgeChanges(
  text: string,
  episode: number,
  canonical: CanonicalEntityRegistry,
  bible: StoryBibleContent | null,
): KnowledgeChange[] {
  const changes: KnowledgeChange[] = [];
  if (!bible) return changes;

  const revealed = REVELATION_KEYWORDS.test(text);
  if (!revealed) return changes;

  for (const entity of canonical.entities) {
    if (entity.type !== "character") continue;
    const names = [entity.primaryName, ...entity.aliases.map((a) => a.name)];
    const mentioned = names.some((n) => text.toLowerCase().includes(n.toLowerCase()));
    if (!mentioned) continue;

    const normalized = normalizeEntityName(entity.primaryName);
    const char = bible.characters.characters.find((c) => normalizeEntityName(c.name) === normalized);
    if (!char) continue;

    const secrets = char.secrets ?? [];
    const hidden = bible.canon.hiddenInformation.filter((h) =>
      normalizeEntityName(h).includes(normalized),
    );
    const truthStrings = [...secrets, ...hidden];
    const matchesTruth = truthStrings.some((t) => sharesKeyword(text, t));
    if (!matchesTruth) continue;

    const factId = `fact:${entity.canonicalId}:truth`;
    changes.push({
      characterId: entity.canonicalId,
      factId,
      change: "learned",
      visibility: "character_and_audience",
      episode,
    });
  }

  return changes;
}

function sharesKeyword(a: string, b: string): boolean {
  const wordsA = new Set(
    a.toLowerCase().split(/\s+/).filter((w) => w.length > 5),
  );
  const wordsB = new Set(
    b.toLowerCase().split(/\s+/).filter((w) => w.length > 5),
  );
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared += 1;
  return shared >= 2;
}

function buildRelationships(
  plan: SeasonPlan,
  canonical: CanonicalEntityRegistry,
): RelationshipState[] {
  const relationships: RelationshipState[] = [];
  const relMap = new Map<string, RelationshipState>();

  function getRelId(a: string, b: string): string {
    const aId = resolveCanonicalId(canonical, a, "character") ?? makeCanonicalId("character", a);
    const bId = resolveCanonicalId(canonical, b, "character") ?? makeCanonicalId("character", b);
    return [aId, bId].sort().join("↔");
  }

  for (const ep of plan.episodeProgression) {
    for (const change of ep.relationshipChanges) {
      const relId = getRelId(change.from, change.to);
      const fromId = resolveCanonicalId(canonical, change.from, "character") ?? makeCanonicalId("character", change.from);
      const toId = resolveCanonicalId(canonical, change.to, "character") ?? makeCanonicalId("character", change.to);

      let rel = relMap.get(relId);
      if (!rel) {
        rel = {
          id: relId,
          characterA: fromId,
          characterB: toId,
          relationshipType: "general",
          initialState: "unknown",
          currentState: change.change,
          introducedEpisode: ep.episodeNumber,
          changes: [],
        };
        relMap.set(relId, rel);
        relationships.push(rel);
      } else {
        rel.changes.push({
          episode: ep.episodeNumber,
          previousState: rel.currentState,
          newState: change.change,
        });
        rel.currentState = change.change;
      }
    }
  }

  for (const rel of relationships) {
    if (rel.changes.length > 0) {
      rel.initialState = rel.changes[0]!.previousState;
    }
  }

  return relationships;
}

function buildThreads(
  plan: SeasonPlan,
  canonical: CanonicalEntityRegistry,
  events: NarrativeEvent[],
): NarrativeThread[] {
  const threads: NarrativeThread[] = [];
  let threadCounter = 0;
  const seenDescriptions = new Set<string>();

  for (const ep of plan.episodeProgression) {
    for (const thread of ep.unresolvedThreads) {
      const normalized = normalizeEntityName(thread);
      if (seenDescriptions.has(normalized)) continue;
      seenDescriptions.add(normalized);

      threadCounter += 1;
      const threadId = `thread:${threadCounter}`;
      const status = classifyThreadStatus(thread);
      const importance = classifyImportance(thread);

      const setupEvents = events.filter(
        (e) => e.episode <= ep.episodeNumber && sharesKeyword(e.description, thread),
      ).map((e) => e.id);

      threads.push({
        id: threadId,
        title: thread.slice(0, 120),
        description: thread,
        introducedEpisode: ep.episodeNumber,
        status,
        questions: [{ question: thread, status: "open" }],
        setupEventIds: setupEvents,
        developmentEventIds: [],
        payoffEventIds: [],
        importance,
        carryForwardReason: status === "intentionally_carried_forward" ? thread : undefined,
      });
    }
  }

  for (const sp of plan.setupAndPayoff) {
    const isPayoff = PAYOFF_INDICATORS.test(sp);
    const isSetup = SETUP_INDICATORS.test(sp);

    threadCounter += 1;
    const threadId = `thread:${threadCounter}`;
    const importance = classifyImportance(sp);

    const matchedEvents = events.filter((e) => sharesKeyword(e.description, sp)).map((e) => e.id);

    threads.push({
      id: threadId,
      title: sp.slice(0, 120),
      description: sp,
      introducedEpisode: 1,
      status: isPayoff ? "resolved" : "developing",
      questions: [],
      setupEventIds: isSetup ? matchedEvents : [],
      developmentEventIds: [],
      payoffEventIds: isPayoff ? matchedEvents : [],
      importance,
    });
  }

  for (const q of plan.unresolvedQuestions) {
    threadCounter += 1;
    const threadId = `thread:${threadCounter}`;
    const status: NarrativeThreadStatus = CARRY_FORWARD_INDICATORS.test(q)
      ? "intentionally_carried_forward"
      : "unresolved";

    threads.push({
      id: threadId,
      title: q.slice(0, 120),
      description: q,
      introducedEpisode: 1,
      status,
      questions: [{ question: q, status: "open" }],
      setupEventIds: [],
      developmentEventIds: [],
      payoffEventIds: [],
      importance: "minor",
      carryForwardReason: status === "intentionally_carried_forward" ? q : undefined,
    });
  }

  return threads;
}

function buildEpisodeStates(
  plan: SeasonPlan,
  entities: NarrativeEntity[],
  events: NarrativeEvent[],
  threads: NarrativeThread[],
  relationships: RelationshipState[],
): EpisodeNarrativeState[] {
  const states: EpisodeNarrativeState[] = [];

  for (const ep of plan.episodeProgression) {
    const epNum = ep.episodeNumber;

    const introducedEntities: EntityId[] = [];
    const activeEntities: EntityId[] = [];
    const absentEntities: EntityId[] = [];

    for (const entity of entities) {
      const firstIntro = entity.firstIntroductionEpisode;
      const firstApp = entity.firstAppearanceEpisode;

      if (firstIntro === epNum) {
        introducedEntities.push(entity.id);
      }

      if (firstApp !== undefined && firstApp <= epNum) {
        if (entity.lifecycle === "deceased" || entity.lifecycle === "departed") {
          absentEntities.push(entity.id);
        } else {
          activeEntities.push(entity.id);
        }
      } else if (firstIntro !== undefined && firstIntro < epNum && (firstApp === undefined || firstApp > epNum)) {
        absentEntities.push(entity.id);
      }
    }

    const epEvents = events.filter((e) => e.episode === epNum).map((e) => e.id);
    const epKnowledge = events
      .filter((e) => e.episode === epNum)
      .flatMap((e) => e.knowledgeChanges);

    const epRelChanges = relationships
      .filter((r) => r.changes.some((c) => c.episode === epNum))
      .map((r) => r.id);

    const activeThreads = threads
      .filter((t) => t.introducedEpisode <= epNum && t.status !== "resolved" && t.status !== "abandoned")
      .map((t) => t.id);
    const resolvedThreads = threads
      .filter((t) => t.payoffEventIds.some((id) => events.find((e) => e.id === id)?.episode === epNum))
      .map((t) => t.id);

    const outgoingConsequences = events
      .filter((e) => e.episode === epNum && e.consequences.length > 0)
      .flatMap((e) => e.consequences);
    const incomingConsequences = events
      .filter((e) => e.episode === epNum && e.causedBy.length > 0)
      .flatMap((e) => e.causedBy);

    states.push({
      episode: epNum,
      introducedEntities,
      activeEntities,
      absentEntities,
      events: epEvents,
      relationshipChanges: epRelChanges,
      knowledgeAcquired: epKnowledge,
      incomingConsequences,
      outgoingConsequences,
      activeThreads,
      resolvedThreads,
      unresolvedQuestions: ep.unresolvedThreads,
    });
  }

  return states;
}

function applyLedgerToThreads(
  threads: NarrativeThread[],
  ledger: ContinuityLedger | null,
): NarrativeThread[] {
  if (!ledger) return threads;

  for (const lt of ledger.unresolvedThreads) {
    const normalized = normalizeEntityName(lt.thread);
    const thread = threads.find((t) => normalizeEntityName(t.description) === normalized);
    if (thread) {
      if (lt.status === "resolved") {
        thread.status = "resolved";
        for (const q of thread.questions) {
          q.status = "answered";
        }
      } else if (lt.status === "developing") {
        if (thread.status === "unresolved") {
          thread.status = "developing";
        }
      }
    }
  }

  return threads;
}

export function buildNarrativeRegistry(ctx: NarrativeRegistryContext): NarrativeRegistry {
  const { canonicalRegistry, bible, plan, ledger } = ctx;

  const entities = buildEntities(canonicalRegistry, bible, ctx.characterProfiles);
  const { events, causalLinks } = buildEvents(plan, canonicalRegistry, bible);
  const relationships = buildRelationships(plan, canonicalRegistry);
  let threads = buildThreads(plan, canonicalRegistry, events);
  threads = applyLedgerToThreads(threads, ledger);
  const episodeStates = buildEpisodeStates(plan, entities, events, threads, relationships);

  const seasonId = `season:${plan.episodeProgression.length}`;

  return {
    schemaVersion: NARRATIVE_REGISTRY_SCHEMA_VERSION,
    seasonId,
    entities,
    events,
    relationships,
    threads,
    episodeStates,
    causalLinks,
  };
}