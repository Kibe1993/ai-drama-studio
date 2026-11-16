import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { ContinuityLedger } from "@/lib/validation/continuityLedger";
import type { CharacterProfile } from "@/lib/validation/productionStages";
import {
  type CanonicalEntityRegistry,
  type CanonicalEntity,
  type EntityLifecycle,
  type CanonicalEntityType,
  type CharacterStatus,
  type CanonicalAlias,
  normalizeName,
  makeCanonicalId,
  makeRelationshipId,
} from "@/lib/validation/canonicalRegistry";

const INTRODUCTION_KEYWORDS = /\b(introduc|first appear|new character|new location|arrives|enters|debuts|makes (?:their|her|his) (?:first|debut))\b/i;
const DEATH_KEYWORDS = /\b(die|dies|died|dead|death|deceased|killed|murder|fatal|perish)\b/i;
const DEPARTURE_KEYWORDS = /\b(depart|leave|exit|goes away|moves away|exits|withdraws)\b/i;
const CONCEALED_KEYWORDS = /\b(disguise|codename|alias|secret identity|concealed|hidden identity|reveals? (?:themself|himself|herself) (?:as|to be))\b/i;
const FLASHBACK_INDICATORS = /\b(flashback|memory|recall|remember|years? ago|previously|back then|in the past|vision|dream|hallucinat)\b/i;
const OFFSCREEN_INDICATORS = /\b(off[- ]screen|not present|absent|away|elsewhere|mentioned(?: only)?|referenced)\b/i;
const FORESHADOWING_INDICATORS = /\b(foreshadow|hint|clue|teaser|promise|setup|plant|seed)\b/i;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function mentionsName(text: string, name: string): boolean {
  const norm = normalize(name);
  const normText = normalize(text);
  if (norm.length < 2) return false;
  return normText.includes(norm);
}

function episodeText(item: EpisodePlanItem): string {
  return [
    item.workingTitle,
    item.narrativePurpose,
    item.startingSituation,
    item.mainObjective,
    item.centralConflict,
    item.characterDevelopment,
    item.storyContribution,
    item.endingOrCliffhanger,
    item.continuityRequirements,
    ...item.majorStoryBeats,
    ...item.informationRevealed,
    ...item.importantEvents,
    ...item.consequences,
    ...item.unresolvedThreads,
    ...item.characterArcChanges.map((c) => `${c.name} ${c.change}`),
    ...item.relationshipChanges.map((c) => `${c.from} ${c.to} ${c.change}`),
    ...item.locationChanges.map((c) => `${c.name} ${c.change}`),
    ...item.objectChanges.map((c) => `${c.name} ${c.condition}`),
  ].join(" ");
}

export interface RegistryBuildContext {
  bible: StoryBibleContent | null;
  plan: SeasonPlan;
  ledger: ContinuityLedger | null;
  ledgerAsOfEpisode?: number;
  characterProfiles?: CharacterProfile[] | null;
}

export function buildRegistryFromBible(
  bible: StoryBibleContent | null,
  characterProfiles?: CharacterProfile[] | null,
): CanonicalEntity[] {
  const entities: CanonicalEntity[] = [];
  const seen = new Set<string>();

  function addEntity(
    type: CanonicalEntityType,
    primaryName: string,
    storyRole?: string,
    description?: string,
    aliases?: CanonicalAlias[],
  ): void {
    const canonicalId = makeCanonicalId(type, primaryName);
    if (seen.has(canonicalId)) return;
    seen.add(canonicalId);
    entities.push({
      canonicalId,
      type,
      primaryName,
      aliases: aliases ?? [],
      storyRole: storyRole ?? "",
      description: description ?? "",
    });
  }

  if (bible) {
    for (const char of bible.characters.characters) {
      const profileAliases: CanonicalAlias[] = [];
      if (characterProfiles) {
        const profile = characterProfiles.find(
          (p) => normalizeName(p.name) === normalizeName(char.name),
        );
        if (profile) {
          for (const alias of profile.aliases ?? []) {
            profileAliases.push({
              name: alias.name,
              type: alias.type,
              description: alias.description,
            });
          }
        }
      }
      addEntity(
        "character",
        char.name,
        char.storyRole,
        char.roleDescription,
        profileAliases,
      );
    }

    for (const loc of bible.world.geographyAndLocations) {
      addEntity("location", loc.name, undefined, loc.description);
    }

    for (const char of bible.characters.characters) {
      for (const rel of char.relationships) {
        const relId = makeRelationshipId(char.name, rel.characterName);
        if (seen.has(relId)) continue;
        seen.add(relId);
        entities.push({
          canonicalId: relId,
          type: "relationship",
          primaryName: `${char.name} → ${rel.characterName}`,
          aliases: [],
          storyRole: "",
          description: rel.relationship,
        });
      }
    }
  }

  if (characterProfiles) {
    for (const profile of characterProfiles) {
      const canonicalId = makeCanonicalId("character", profile.name);
      if (seen.has(canonicalId)) continue;
      seen.add(canonicalId);
      const aliases: CanonicalAlias[] = (profile.aliases ?? []).map((a) => ({
        name: a.name,
        type: a.type,
        description: a.description,
      }));
      entities.push({
        canonicalId,
        type: "character",
        primaryName: profile.name,
        aliases,
        storyRole: profile.role ?? "",
        description: profile.background ?? "",
      });
    }
  }

  return entities;
}

export function enrichRegistryFromPlan(
  entities: CanonicalEntity[],
  plan: SeasonPlan,
): { entities: CanonicalEntity[]; lifecycles: EntityLifecycle[] } {
  const allEntities = [...entities];
  const lifecycles: EntityLifecycle[] = [];
  const lifecycleMap = new Map<string, EntityLifecycle>();
  const entitySet = new Set(allEntities.map((e) => e.canonicalId));

  function ensureEntity(
    type: CanonicalEntityType,
    name: string,
    storyRole?: string,
  ): string {
    const canonicalId = makeCanonicalId(type, name);
    if (!entitySet.has(canonicalId)) {
      entitySet.add(canonicalId);
      allEntities.push({
        canonicalId,
        type,
        primaryName: name,
        aliases: [],
        storyRole: storyRole ?? "",
        description: "",
      });
    }
    return canonicalId;
  }

  function ensureLifecycle(canonicalId: string): EntityLifecycle {
    let lc = lifecycleMap.get(canonicalId);
    if (!lc) {
      lc = {
        canonicalId,
        plannedIntroductionEpisode: null,
        firstReferenceEpisode: null,
        firstAppearanceEpisode: null,
        appearances: [],
        currentStatus: "not_yet_introduced",
        statusHistory: [],
        setupEpisodes: [],
        payoffEpisodes: [],
        developmentEpisodes: [],
        threadStatus: null,
        intendedResolutionEpisode: null,
        isIntentionalCarryForward: false,
        chronologicalOrder: null,
        presentationOrder: null,
        isNonLinear: false,
      };
      lifecycleMap.set(canonicalId, lc);
      lifecycles.push(lc);
    }
    return lc;
  }

  const charFirstSeen = new Map<string, number>();
  const locFirstSeen = new Map<string, number>();

  for (const ep of plan.episodeProgression) {
    const epNum = ep.episodeNumber;
    const fullText = episodeText(ep);

    for (const arc of ep.characterArcChanges) {
      const canonicalId = ensureEntity("character", arc.name);
      const lc = ensureLifecycle(canonicalId);

      const prevSeen = charFirstSeen.get(canonicalId);
      if (prevSeen === undefined) {
        charFirstSeen.set(canonicalId, epNum);

        const isBibleChar = entities.some(
          (e) => e.canonicalId === canonicalId,
        );
        if (isBibleChar) {
          lc.firstAppearanceEpisode = epNum;
          lc.firstReferenceEpisode = lc.firstReferenceEpisode ?? epNum;
          lc.appearances.push({
            episodeNumber: epNum,
            appearanceType: "first_appearance",
            evidence: arc.change,
          });
        } else {
          lc.plannedIntroductionEpisode = epNum;
          lc.firstAppearanceEpisode = epNum;
          lc.firstReferenceEpisode = lc.firstReferenceEpisode ?? epNum;
          lc.appearances.push({
            episodeNumber: epNum,
            appearanceType: "planned_introduction",
            evidence: arc.change,
          });
        }
      } else {
        lc.appearances.push({
          episodeNumber: epNum,
          appearanceType: "appearance",
          evidence: arc.change,
        });
      }

      if (DEATH_KEYWORDS.test(arc.change)) {
        lc.currentStatus = "deceased";
        lc.statusHistory.push({ episodeNumber: epNum, status: "deceased", reason: arc.change });
        lc.appearances.push({
          episodeNumber: epNum,
          appearanceType: "death",
          evidence: arc.change,
        });
      } else if (DEPARTURE_KEYWORDS.test(arc.change)) {
        lc.currentStatus = "departed";
        lc.statusHistory.push({ episodeNumber: epNum, status: "departed", reason: arc.change });
        lc.appearances.push({
          episodeNumber: epNum,
          appearanceType: "departure",
          evidence: arc.change,
        });
      } else if (CONCEALED_KEYWORDS.test(arc.change)) {
        lc.currentStatus = "concealed_identity";
        lc.statusHistory.push({ episodeNumber: epNum, status: "concealed_identity", reason: arc.change });
      } else if (lc.currentStatus === "not_yet_introduced" || lc.currentStatus === "mentioned_not_appeared") {
        lc.currentStatus = "appeared";
        lc.statusHistory.push({ episodeNumber: epNum, status: "appeared", reason: arc.change });
      }

      lc.developmentEpisodes.push(epNum);
    }

    for (const locChange of ep.locationChanges) {
      const canonicalId = ensureEntity("location", locChange.name);
      const lc = ensureLifecycle(canonicalId);

      const prevSeen = locFirstSeen.get(canonicalId);
      if (prevSeen === undefined) {
        locFirstSeen.set(canonicalId, epNum);
        const isBibleLoc = entities.some((e) => e.canonicalId === canonicalId);
        if (isBibleLoc) {
          lc.firstAppearanceEpisode = epNum;
          lc.firstReferenceEpisode = lc.firstReferenceEpisode ?? epNum;
          lc.appearances.push({
            episodeNumber: epNum,
            appearanceType: "first_appearance",
            evidence: locChange.change,
          });
        } else {
          lc.plannedIntroductionEpisode = epNum;
          lc.firstAppearanceEpisode = epNum;
          lc.firstReferenceEpisode = lc.firstReferenceEpisode ?? epNum;
          lc.appearances.push({
            episodeNumber: epNum,
            appearanceType: "planned_introduction",
            evidence: locChange.change,
          });
        }
      } else {
        lc.appearances.push({
          episodeNumber: epNum,
          appearanceType: "appearance",
          evidence: locChange.change,
        });
      }
    }

    for (const relChange of ep.relationshipChanges) {
      const fromId = ensureEntity("character", relChange.from);
      const toId = ensureEntity("character", relChange.to);
      const relId = makeRelationshipId(relChange.from, relChange.to);
      if (!entitySet.has(relId)) {
        entitySet.add(relId);
        allEntities.push({
          canonicalId: relId,
          type: "relationship",
          primaryName: `${relChange.from} → ${relChange.to}`,
          aliases: [],
          storyRole: "",
          description: relChange.change,
        });
      }
      const lc = ensureLifecycle(relId);
      lc.developmentEpisodes.push(epNum);
      ensureLifecycle(fromId);
      ensureLifecycle(toId);
    }

    for (const thread of ep.unresolvedThreads) {
      const threadId = makeCanonicalId("thread", thread);
      if (!entitySet.has(threadId)) {
        entitySet.add(threadId);
        allEntities.push({
          canonicalId: threadId,
          type: "thread",
          primaryName: thread.slice(0, 120),
          aliases: [],
          storyRole: "",
          description: thread,
        });
      }
      const lc = ensureLifecycle(threadId);
      if (lc.firstReferenceEpisode === null) {
        lc.firstReferenceEpisode = epNum;
        lc.appearances.push({
          episodeNumber: epNum,
          appearanceType: "first_reference",
          evidence: thread,
        });
      }
      if (lc.threadStatus === null) {
        lc.threadStatus = "open";
      }
      lc.developmentEpisodes.push(epNum);
    }


    for (const event of ep.importantEvents) {
      const eventId = makeCanonicalId("event", `${epNum}:${event}`);
      if (!entitySet.has(eventId)) {
        entitySet.add(eventId);
        allEntities.push({
          canonicalId: eventId,
          type: "event",
          primaryName: event.slice(0, 120),
          aliases: [],
          storyRole: "",
          description: event,
        });
      }
      const lc = ensureLifecycle(eventId);
      lc.presentationOrder = epNum;
      lc.isNonLinear = FLASHBACK_INDICATORS.test(event);
    }

    for (const char of allEntities.filter((e) => e.type === "character")) {
      const lc = lifecycleMap.get(char.canonicalId);
      if (!lc) continue;
      if (lc.firstReferenceEpisode === null && mentionsName(fullText, char.primaryName)) {
        lc.firstReferenceEpisode = epNum;
        lc.appearances.push({
          episodeNumber: epNum,
          appearanceType: "first_reference",
          evidence: `Mentioned in ${ep.workingTitle}`,
        });
        if (lc.currentStatus === "not_yet_introduced") {
          lc.currentStatus = "mentioned_not_appeared";
          lc.statusHistory.push({
            episodeNumber: epNum,
            status: "mentioned_not_appeared",
            reason: "Mentioned by name before appearing",
          });
        }
      }
      for (const alias of char.aliases) {
        if (lc.firstReferenceEpisode === null && mentionsName(fullText, alias.name)) {
          lc.firstReferenceEpisode = epNum;
          lc.appearances.push({
            episodeNumber: epNum,
            appearanceType: "first_reference",
            evidence: `Alias "${alias.name}" mentioned in ${ep.workingTitle}`,
          });
        }
      }
    }
  }

  for (const setup of plan.setupAndPayoff) {
    const threadId = makeCanonicalId("thread", setup);
    if (!entitySet.has(threadId)) {
      entitySet.add(threadId);
      allEntities.push({
        canonicalId: threadId,
        type: "thread",
        primaryName: setup.slice(0, 120),
        aliases: [],
        storyRole: "",
        description: setup,
      });
    }
    const lc = ensureLifecycle(threadId);
    if (INTRODUCTION_KEYWORDS.test(setup) || lc.setupEpisodes.length === 0) {
      if (lc.setupEpisodes.length === 0) {
        lc.setupEpisodes.push(1);
      }
    } else {
      const lastEp = plan.episodeProgression[plan.episodeProgression.length - 1];
      if (lc.payoffEpisodes.length === 0 && lastEp) {
        lc.payoffEpisodes.push(lastEp.episodeNumber);
      }
    }
    if (lc.firstReferenceEpisode === null) {
      lc.firstReferenceEpisode = lc.setupEpisodes[0] ?? 1;
    }
  }

  return { entities: allEntities, lifecycles };
}

export function enrichRegistryFromLedger(
  registry: CanonicalEntityRegistry,
  ledger: ContinuityLedger | null,
  asOfEpisode?: number,
): CanonicalEntityRegistry {
  if (!ledger) return registry;

  const ledgerEpisode = asOfEpisode ?? 0;

  const lifecycles = [...registry.lifecycles];
  const lifecycleMap = new Map(lifecycles.map((lc) => [lc.canonicalId, lc]));

  function ensureLifecycle(canonicalId: string): EntityLifecycle {
    let lc = lifecycleMap.get(canonicalId);
    if (!lc) {
      lc = {
        canonicalId,
        plannedIntroductionEpisode: null,
        firstReferenceEpisode: null,
        firstAppearanceEpisode: null,
        appearances: [],
        currentStatus: "not_yet_introduced",
        statusHistory: [],
        setupEpisodes: [],
        payoffEpisodes: [],
        developmentEpisodes: [],
        threadStatus: null,
        intendedResolutionEpisode: null,
        isIntentionalCarryForward: false,
        chronologicalOrder: null,
        presentationOrder: null,
        isNonLinear: false,
      };
      lifecycleMap.set(canonicalId, lc);
      lifecycles.push(lc);
    }
    return lc;
  }

  for (const state of ledger.characterStates) {
    const canonicalId = makeCanonicalId("character", state.name);
    const lc = ensureLifecycle(canonicalId);
    if (lc.firstAppearanceEpisode === null) {
      lc.firstAppearanceEpisode = ledgerEpisode;
      lc.appearances.push({
        episodeNumber: ledgerEpisode,
        appearanceType: "first_appearance",
        evidence: `Ledger state at episode ${ledgerEpisode}`,
      });
    }
    if (state.physicalState && DEATH_KEYWORDS.test(state.physicalState)) {
      lc.currentStatus = "deceased";
    }
  }

  for (const loc of ledger.locationStates) {
    const canonicalId = makeCanonicalId("location", loc.name);
    const lc = ensureLifecycle(canonicalId);
    if (lc.firstAppearanceEpisode === null) {
      lc.firstAppearanceEpisode = loc.lastSeenEpisode;
      lc.appearances.push({
        episodeNumber: loc.lastSeenEpisode,
        appearanceType: "first_appearance",
        evidence: `Ledger location state`,
      });
    }
  }

  for (const thread of ledger.unresolvedThreads) {
    const threadId = makeCanonicalId("thread", thread.thread);
    const lc = ensureLifecycle(threadId);
    if (thread.status === "resolved") {
      lc.threadStatus = "resolved";
      if (lc.payoffEpisodes.length === 0) {
        lc.payoffEpisodes.push(thread.introducedInEpisode);
      }
    } else if (thread.status === "developing") {
      lc.threadStatus = "developing";
    } else {
      lc.threadStatus = "open";
    }
    if (lc.firstReferenceEpisode === null) {
      lc.firstReferenceEpisode = thread.introducedInEpisode;
    }
  }

  return { entities: registry.entities, lifecycles };
}

export function buildRegistry(ctx: RegistryBuildContext): CanonicalEntityRegistry {
  const baseEntities = buildRegistryFromBible(ctx.bible, ctx.characterProfiles);
  const { entities, lifecycles } = enrichRegistryFromPlan(baseEntities, ctx.plan);
  const registry: CanonicalEntityRegistry = { entities, lifecycles };
  return enrichRegistryFromLedger(registry, ctx.ledger, ctx.ledgerAsOfEpisode);
}

export function resolveCanonicalId(
  registry: CanonicalEntityRegistry,
  name: string,
  type?: CanonicalEntityType,
): string | null {
  const norm = normalizeName(name);
  for (const entity of registry.entities) {
    if (type && entity.type !== type) continue;
    if (normalizeName(entity.primaryName) === norm) return entity.canonicalId;
    for (const alias of entity.aliases) {
      if (normalizeName(alias.name) === norm) return entity.canonicalId;
    }
  }
  if (type) return makeCanonicalId(type, name);
  return null;
}

export function resolveEntity(
  registry: CanonicalEntityRegistry,
  name: string,
  type?: CanonicalEntityType,
): CanonicalEntity | null {
  const id = resolveCanonicalId(registry, name, type);
  if (!id) return null;
  return registry.entities.find((e) => e.canonicalId === id) ?? null;
}

export function getLifecycle(
  registry: CanonicalEntityRegistry,
  canonicalId: string,
): EntityLifecycle | null {
  return registry.lifecycles.find((lc) => lc.canonicalId === canonicalId) ?? null;
}

export function getCharacterStatusAtEpisode(
  registry: CanonicalEntityRegistry,
  canonicalId: string,
  episodeNumber: number,
): CharacterStatus {
  const lc = getLifecycle(registry, canonicalId);
  if (!lc) return "not_yet_introduced";

  let status: CharacterStatus = "not_yet_introduced";
  for (const change of lc.statusHistory) {
    if (change.episodeNumber <= episodeNumber) {
      status = change.status;
    } else {
      break;
    }
  }
  if (status === "not_yet_introduced") {
    if (lc.firstAppearanceEpisode !== null && lc.firstAppearanceEpisode <= episodeNumber) {
      status = "appeared";
    } else if (lc.firstReferenceEpisode !== null && lc.firstReferenceEpisode <= episodeNumber) {
      status = "mentioned_not_appeared";
    }
  }
  return status;
}

export function isIntroducedBy(
  registry: CanonicalEntityRegistry,
  canonicalId: string,
  episodeNumber: number,
): boolean {
  const lc = getLifecycle(registry, canonicalId);
  if (!lc) return false;
  return (
    lc.plannedIntroductionEpisode !== null &&
    lc.plannedIntroductionEpisode <= episodeNumber
  );
}

export function hasAppearedBy(
  registry: CanonicalEntityRegistry,
  canonicalId: string,
  episodeNumber: number,
): boolean {
  const lc = getLifecycle(registry, canonicalId);
  if (!lc) return false;
  return (
    lc.firstAppearanceEpisode !== null &&
    lc.firstAppearanceEpisode <= episodeNumber
  );
}

export function isReferencedBy(
  registry: CanonicalEntityRegistry,
  canonicalId: string,
  episodeNumber: number,
): boolean {
  const lc = getLifecycle(registry, canonicalId);
  if (!lc) return false;
  return (
    lc.firstReferenceEpisode !== null &&
    lc.firstReferenceEpisode <= episodeNumber
  );
}

export function isEntityInBible(
  registry: CanonicalEntityRegistry,
  canonicalId: string,
): boolean {
  const entity = registry.entities.find((e) => e.canonicalId === canonicalId);
  if (!entity) return false;
  return entity.aliases.length > 0 || entity.storyRole !== "" || entity.description !== "";
}

export function hasSupportedExplanation(
  text: string,
): boolean {
  return (
    FLASHBACK_INDICATORS.test(text) ||
    OFFSCREEN_INDICATORS.test(text) ||
    FORESHADOWING_INDICATORS.test(text) ||
    CONCEALED_KEYWORDS.test(text)
  );
}

export function getThreadLifecycle(
  registry: CanonicalEntityRegistry,
  threadDescription: string,
): EntityLifecycle | null {
  const threadId = makeCanonicalId("thread", threadDescription);
  let lc = getLifecycle(registry, threadId);
  if (!lc) {
    const norm = normalizeName(threadDescription);
    for (const entity of registry.entities) {
      if (entity.type !== "thread") continue;
      if (normalizeName(entity.description).includes(norm) || norm.includes(normalizeName(entity.description))) {
        lc = getLifecycle(registry, entity.canonicalId);
        if (lc) break;
      }
    }
  }
  return lc;
}