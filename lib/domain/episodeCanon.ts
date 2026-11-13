import type { EpisodeCanonSummary, EpisodePlan } from "@/lib/validation/casna";
import type {
  CharacterState,
  ContinuityLedger,
  ContinuityLocationState,
  ContinuityObjectState,
  UnresolvedThread,
} from "@/lib/validation/continuityLedger";
import type { EpisodePlanItem, SeasonPlan } from "@/lib/validation/seasonPlan";
import type { ScreenplayScene } from "@/lib/validation/story";

/**
 * CASNA Stage I: turn an episode that the creator has just approved into the
 * canonical facts the next episode must inherit.
 *
 * The approved Season Plan entry is the authoritative narrative summary of the
 * episode (the creator approved it), and the approved screenplay supplies the
 * concrete state: who is where at the end, which locations were used, and which
 * characters actually carry the episode. Keeping this deterministic means
 * approval never depends on another model call and can never silently invent
 * canon. It also means a failed extraction cannot half-write the ledger: the
 * caller writes one merged record or nothing.
 */

export type EpisodeCanonInput = {
  episodeNumber: number;
  story: { title: string; synopsis: string; screenplay: ScreenplayScene[] };
  plan: SeasonPlan & { version: number };
  episodePlan: EpisodePlan | null;
  ledger: ContinuityLedger | null;
};

export function extractEpisodeCanon(input: EpisodeCanonInput): EpisodeCanonSummary {
  const { episodeNumber, story, plan, ledger } = input;
  const item =
    plan.episodeProgression.find((entry) => entry.episodeNumber === episodeNumber) ?? null;
  const characters = charactersIn(story.screenplay);
  const characterStates = buildCharacterStates({
    episodeNumber,
    characters,
    screenplay: story.screenplay,
    ledger,
    item,
  });
  const consequences = item?.consequences ?? [];
  const revealed = item?.informationRevealed ?? [];

  return {
    episodeNumber,
    title: story.title,
    summary: story.synopsis,
    events: buildEvents({ screenplay: story.screenplay, item, consequences, revealed, characters }),
    characterStates,
    locationStates: buildLocationStates({ screenplay: story.screenplay, episodeNumber, item }),
    objectStates: buildObjectStates(item, episodeNumber),
    revealedSecrets: revealed,
    unresolvedThreads: buildThreads({ ledger, item }),
    consequences,
  };
}

function buildCharacterStates(input: {
  episodeNumber: number;
  characters: string[];
  screenplay: ScreenplayScene[];
  ledger: ContinuityLedger | null;
  item: EpisodePlanItem | null;
}): CharacterState[] {
  const { screenplay, ledger, item, episodeNumber } = input;
  const prior = new Map((ledger?.characterStates ?? []).map((state) => [normalize(state.name), state]));
  const arcs = new Map(
    (item?.characterArcChanges ?? []).map((change) => [normalize(change.name), change.change])
  );
  const relationshipDeltas = item?.relationshipChanges ?? [];

  // Relationship changes can name characters who do not appear in a scene but
  // whose state must still change (for example an off-screen betrayal).
  const names = [...input.characters];
  for (const delta of relationshipDeltas) {
    for (const name of [delta.from, delta.to]) {
      if (name.trim() && !names.some((entry) => normalize(entry) === normalize(name))) {
        names.push(name.trim());
      }
    }
  }

  const states = new Map<string, CharacterState>();
  for (const name of names) {
    const previous = prior.get(normalize(name));
    const location = lastLocationOf(name, screenplay);
    const development = item ? sentenceMentioning(item.characterDevelopment, name) : "";
    const arc = arcs.get(normalize(name)) ?? "";
    const objective =
      previous?.currentObjective ||
      (item && mentions(item.mainObjective, name) ? item.mainObjective : "") ||
      (development ? `Carries the episode's turn: ${development}` : "") ||
      (item?.mainObjective ?? "Continue their established arc.");
    const emotionalState = arc || development || previous?.emotionalState ||
      `Their situation changed at the end of episode ${episodeNumber}.`;
    states.set(normalize(name), {
      name,
      currentLocation: location || previous?.currentLocation || "Unspecified",
      currentObjective: truncate(objective, 400),
      knowledge: mergeUnique(previous?.knowledge ?? [], development ? [development] : []),
      beliefs: previous?.beliefs ?? [],
      motivations: previous?.motivations ?? [],
      emotionalState: truncate(emotionalState, 300),
      physicalState: previous?.physicalState ?? "",
      relationships: previous?.relationships ?? [],
    });
  }

  for (const delta of relationshipDeltas) {
    const from = states.get(normalize(delta.from));
    const to = states.get(normalize(delta.to));
    const entry = (other: string) => ({
      characterName: other,
      relationship: "changed in this episode",
      tensionOrChange: truncate(delta.change, 300),
    });
    if (from) from.relationships = upsertRelationship(from.relationships, delta.to, entry(delta.to));
    if (to) to.relationships = upsertRelationship(to.relationships, delta.from, entry(delta.from));
  }

  return [...states.values()].slice(0, 24);
}

function buildEvents(input: {
  screenplay: ScreenplayScene[];
  item: EpisodePlanItem | null;
  consequences: string[];
  revealed: string[];
  characters: string[];
}): EpisodeCanonSummary["events"] {
  const { item, consequences, revealed, characters } = input;
  if (!item) {
    return input.screenplay.slice(0, 3).map((scene, index) => ({
      event: truncate(scene.action, 400),
      consequence: consequences[index] ?? truncate(scene.action, 400),
      affectedCharacters: scene.charactersPresent.slice(0, 8),
      revealedInformation: revealed.slice(0, 3),
    }));
  }
  const events = item.importantEvents.length > 0 ? item.importantEvents : item.majorStoryBeats;
  return events.slice(0, 8).map((event, index) => {
    const affected = characters.filter((name) => mentions(event, name));
    return {
      event: truncate(event, 400),
      consequence: truncate(
        consequences[index] ?? consequences[0] ?? item.storyContribution,
        400
      ),
      affectedCharacters: (affected.length > 0 ? affected : characters).slice(0, 8),
      revealedInformation: revealed.slice(0, 3),
    };
  });
}

function buildLocationStates(input: {
  screenplay: ScreenplayScene[];
  episodeNumber: number;
  item: EpisodePlanItem | null;
}): ContinuityLocationState[] {
  const latest = new Map<string, ContinuityLocationState>();
  for (const scene of input.screenplay) {
    const key = normalize(scene.location);
    latest.set(key, {
      name: scene.location,
      currentState: truncate([scene.heading, scene.visualDescription].join(". "), 400),
      lastSeenEpisode: input.episodeNumber,
    });
  }
  for (const change of input.item?.locationChanges ?? []) {
    const key = normalize(change.name);
    const existing = latest.get(key);
    latest.set(key, {
      name: change.name,
      currentState: truncate(change.change, 400),
      lastSeenEpisode: existing?.lastSeenEpisode ?? input.episodeNumber,
    });
  }
  return [...latest.values()].slice(0, 18);
}

function buildObjectStates(
  item: EpisodePlanItem | null,
  episodeNumber: number
): ContinuityObjectState[] {
  const latest = new Map<string, ContinuityObjectState>();
  for (const change of item?.objectChanges ?? []) {
    latest.set(normalize(change.name), {
      name: change.name,
      ownership: truncate(change.ownership, 200),
      condition: truncate(change.condition, 300),
      lastSeenEpisode: episodeNumber,
    });
  }
  return [...latest.values()].slice(0, 18);
}

function upsertRelationship(
  relationships: CharacterState["relationships"],
  characterName: string,
  entry: CharacterState["relationships"][number]
): CharacterState["relationships"] {
  const next = relationships.filter(
    (relationship) => normalize(relationship.characterName) !== normalize(characterName)
  );
  next.push(entry);
  return next.slice(0, 12);
}

function buildThreads(input: {
  ledger: ContinuityLedger | null;
  item: EpisodePlanItem | null;
}): UnresolvedThread[] {
  const threads = new Map<string, UnresolvedThread>();
  for (const thread of input.ledger?.unresolvedThreads ?? []) {
    threads.set(normalize(thread.thread), thread);
  }
  // A revelation that answers an open thread resolves it.
  const revealed = new Set(
    (input.item?.informationRevealed ?? []).flatMap((entry) => [...keywords(entry)])
  );
  for (const [key, thread] of threads) {
    if (thread.status === "resolved") continue;
    const overlap = [...keywords(thread.thread)].some((word) => revealed.has(word));
    if (overlap) threads.set(key, { ...thread, status: "resolved" });
  }
  for (const thread of input.item?.unresolvedThreads ?? []) {
    const key = normalize(thread);
    if (threads.has(key)) continue;
    threads.set(key, {
      thread: truncate(thread, 400),
      introducedInEpisode: input.item!.episodeNumber,
      status: "open",
    });
  }
  return [...threads.values()].slice(0, 16);
}

function charactersIn(screenplay: ScreenplayScene[]): string[] {
  const names = new Map<string, string>();
  for (const scene of screenplay) {
    for (const name of scene.charactersPresent) {
      const trimmed = name.trim();
      if (trimmed) names.set(normalize(trimmed), trimmed);
    }
    for (const line of scene.dialogue) {
      const trimmed = line.characterName.trim();
      if (trimmed) names.set(normalize(trimmed), trimmed);
    }
  }
  return [...names.values()];
}

function lastLocationOf(name: string, screenplay: ScreenplayScene[]): string {
  for (let index = screenplay.length - 1; index >= 0; index -= 1) {
    const scene = screenplay[index]!;
    if (scene.charactersPresent.some((present) => normalize(present) === normalize(name))) {
      return scene.location;
    }
  }
  return "";
}

function sentenceMentioning(text: string, name: string): string {
  if (!text.trim()) return "";
  const sentences = text.split(/(?<=[.!?])\s+/);
  const match = sentences.find((sentence) => mentions(sentence, name));
  return match ? truncate(match.trim(), 400) : "";
}

function mentions(text: string, name: string): boolean {
  const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalize(name))}($|[^a-z0-9])`, "i");
  return boundary.test(text.toLowerCase());
}

function keywords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9']+/)
      .filter((word) => word.length > 4)
  );
}

function mergeUnique(base: string[], extra: string[]): string[] {
  const seen = new Set(base.map(normalize));
  const result = [...base];
  for (const value of extra) {
    const key = normalize(value);
    if (!value.trim() || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.slice(0, 12);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
