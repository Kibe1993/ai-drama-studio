import type { CanonEntity, CanonState } from "@/lib/validation/narrativeControl";
import { makeFinding, type NarrativeFinding } from "@/lib/domain/narrativeControl/findings";
import { resolveIdentity } from "@/lib/domain/narrativeControl/identity";
import { includesText } from "@/lib/domain/narrativeControl/text";

const BACKDROP = new Set([
  "door", "room", "road", "night", "light", "rain", "hand", "face", "eyes",
  "voice", "window", "street", "floor", "wall", "sky", "time", "way", "man",
  "woman", "camera", "scene", "house", "study", "morning", "evening", "day",
  "water", "wind", "chair", "table", "ground", "air", "moment", "look",
]);

const ABILITY_VERBS = ["unlocks", "teleports", "vanishes", "resurrects", "heals", "flies"];

export interface PropMention {
  name: string;
  kind: "definite" | "introduction";
  evidence: string;
}

export function extractPropMentions(text: string): PropMention[] {
  const mentions: PropMention[] = [];
  const introduction = /\b(?:finds|pulls out|holds|hands|gives|takes|steals|reveals|carries|clutches|opens)\s+(?:a|an)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})/gi;
  const definite = /\bthe\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})/gi;
  for (const match of text.matchAll(introduction)) {
    const name = cleanProp(match[1] ?? "");
    if (name) mentions.push({ name, kind: "introduction", evidence: match[0] });
  }
  for (const match of text.matchAll(definite)) {
    const name = cleanProp(match[1] ?? "");
    if (name) mentions.push({ name, kind: "definite", evidence: match[0] });
  }
  return mentions;
}

function cleanProp(value: string): string {
  const tokens = value.toLocaleLowerCase().split(/\s+/).filter((token) => token && !BACKDROP.has(token));
  if (tokens.length === 0 || tokens.every((token) => BACKDROP.has(token))) return "";
  return tokens.join(" ");
}

export function validateObjects(canon: CanonState, episode: number, text: string): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  findings.push(...destroyedObjects(canon, episode, text));
  findings.push(...propFindings(canon, episode, text));
  findings.push(...abilityFindings(canon, episode, text));
  return findings;
}

function destroyedObjects(canon: CanonState, episode: number, text: string): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  for (const entity of canon.entities) {
    if (entity.kind !== "object") continue;
    if (entity.endedEpisode !== null && episode > entity.endedEpisode && includesText(text, entity.name)) {
      const flashback = text.toLocaleLowerCase().includes("flashback");
      if (!flashback) {
        findings.push(makeFinding({
          algorithm: "objects",
          severity: "ERROR",
          category: "object",
          entityId: entity.id,
          episode,
          evidence: entity.name,
          expected: `${entity.name} stays absent after episode ${entity.endedEpisode} unless a scene restores it.`,
          actual: `Named in episode ${episode}.`,
          explanation: `${entity.name} was destroyed or removed in episode ${entity.endedEpisode} and appears again without an event.`,
          suggestedCorrection: "Remove the object or add an event that restores it.",
        }));
      }
    }
    const ownerClaim = claimedOwnerId(canon, text, entity);
    if (ownerClaim && entity.ownerId && ownerClaim !== entity.ownerId) {
      const transferred = entity.transfers.some((transfer) => transfer.episode === episode);
      if (!transferred) {
        findings.push(makeFinding({
          algorithm: "objects",
          severity: "ERROR",
          category: "object",
          entityId: entity.id,
          episode,
          evidence: ownerClaim,
          expected: `${entity.name} stays with its recorded owner until a transfer event.`,
          actual: `Claimed by ${ownerClaim}.`,
          explanation: `${entity.name} changes hands in the text without a transfer event in episode ${episode}.`,
          suggestedCorrection: "Restore the owner or record the event that transfers the object.",
        }));
      }
    }
  }
  return findings;
}

function claimedOwnerId(canon: CanonState, text: string, entity: CanonEntity): string | null {
  const match = new RegExp(`\\b([A-Za-z][A-Za-z'-]*)'s\\s+${entity.name}\\b`, "i").exec(text);
  if (!match?.[1]) return null;
  return resolveIdentity(match[1], canon.entities).canonicalId;
}

function propFindings(canon: CanonState, episode: number, text: string): NarrativeFinding[] {
  const objects = canon.entities.filter((entity) => entity.kind === "object");
  const findings: NarrativeFinding[] = [];
  const seen = new Set<string>();
  for (const mention of extractPropMentions(text)) {
    const key = `${mention.kind}:${mention.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = resolveIdentity(mention.name, canon.entities);
    if (resolved.canonicalId) continue;
    if (mention.kind === "introduction" || objects.length === 0) {
      findings.push(makeFinding({
        algorithm: "objects",
        severity: "INFO",
        category: "object",
        episode,
        evidence: mention.evidence,
        expected: "A new prop is registered as a provisional object before it becomes canon.",
        actual: mention.name,
        explanation: `"${mention.name}" is a new prop. It can enter the story here, and it is not canon until it is registered.`,
        suggestedCorrection: "Register it as a provisional object if a later scene depends on it.",
      }));
      continue;
    }
    findings.push(makeFinding({
      algorithm: "objects",
      severity: "ERROR",
      category: "object",
      episode,
      evidence: mention.evidence,
      expected: "A definite prop matches a registered object, or the scene introduces it with an indefinite discovery.",
      actual: mention.name,
      explanation: `"${mention.name}" is treated as an object the story already has, and the canon has no such object.`,
      suggestedCorrection: "Introduce it as a new discovery, or use the registered object.",
    }));
  }
  return findings;
}

function abilityFindings(canon: CanonState, episode: number, text: string): NarrativeFinding[] {
  const findings: NarrativeFinding[] = [];
  const lower = text.toLocaleLowerCase();
  for (const entity of canon.entities) {
    if (entity.kind !== "object") continue;
    if (!lower.includes(entity.name.toLocaleLowerCase())) continue;
    for (const verb of ABILITY_VERBS) {
      if (!new RegExp(`\\b${entity.name}\\b(?:\\s+\\w+){0,3}\\s+${verb}\\b`, "i").test(text)) continue;
      const known = entity.properties.some((property) => property.toLocaleLowerCase().includes(verb))
        || entity.description.toLocaleLowerCase().includes(verb);
      if (known) continue;
      findings.push(makeFinding({
        algorithm: "objects",
        severity: "ERROR",
        category: "object",
        entityId: entity.id,
        episode,
        evidence: `${entity.name} ${verb}`,
        expected: `${entity.name} keeps its recorded properties.`,
        actual: verb,
        explanation: `${entity.name} gains the ability to ${verb.replace(/s$/, "")} without an established property or event.`,
        suggestedCorrection: "Remove the new ability or record an authorized change to the object.",
      }));
    }
  }
  return findings;
}

export function objectOwnershipChanged(before: CanonEntity, afterOwnerId: string | null, eventId: string | null): NarrativeFinding | null {
  if (before.kind !== "object") return null;
  if ((before.ownerId ?? null) === afterOwnerId) return null;
  if (eventId) return null;
  return makeFinding({
    algorithm: "objects",
    severity: "ERROR",
    category: "object",
    entityId: before.id,
    evidence: before.name,
    expected: "An event id for the transfer.",
    actual: `Owner changes from ${before.ownerId ?? "nobody"} to ${afterOwnerId ?? "nobody"} with no event.`,
    explanation: `${before.name} cannot change ownership without a recorded event.`,
    suggestedCorrection: "Attach the transfer to the event that moves the object.",
  });
}
