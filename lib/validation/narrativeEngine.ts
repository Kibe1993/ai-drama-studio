import { z } from "zod";
import type { CanonicalEntityRegistry } from "@/lib/validation/canonicalRegistry";

export type EpisodeNumber = number;
export type EntityId = string;
export type EventId = string;
export type ThreadId = string;

export const LIFECYCLE_STATUSES = [
  "not_introduced",
  "mentioned",
  "introduced",
  "active",
  "temporarily_absent",
  "offscreen_active",
  "departed",
  "deceased",
  "unknown",
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const KNOWLEDGE_VISIBILITIES = [
  "author_only",
  "character_only",
  "audience_only",
  "character_and_audience",
  "publicly_known",
] as const;
export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];

export const EVENT_TYPES = [
  "arrival",
  "departure",
  "discovery",
  "revelation",
  "decision",
  "relationship_change",
  "conflict",
  "consequence",
  "death",
  "location_change",
  "object_introduction",
  "rule_established",
  "rule_broken",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const NARRATIVE_THREAD_STATUSES = [
  "unresolved",
  "developing",
  "partially_resolved",
  "resolved",
  "intentionally_carried_forward",
  "abandoned",
] as const;
export type NarrativeThreadStatus = (typeof NARRATIVE_THREAD_STATUSES)[number];

export const CAUSAL_RELATIONSHIPS = [
  "causes",
  "motivates",
  "enables",
  "prevents",
  "reveals",
  "complicates",
  "resolves",
  "supersedes",
] as const;
export type CausalRelationship = (typeof CAUSAL_RELATIONSHIPS)[number];

export const ENTITY_IMPORTANCE = ["primary", "supporting", "minor"] as const;
export type EntityImportance = (typeof ENTITY_IMPORTANCE)[number];

export const THREAD_IMPORTANCE = ["major", "minor", "background"] as const;
export type ThreadImportance = (typeof THREAD_IMPORTANCE)[number];

export const KNOWLEDGE_CHANGE_TYPES = ["learned", "forgotten", "misled", "corrected"] as const;
export type KnowledgeChangeType = (typeof KNOWLEDGE_CHANGE_TYPES)[number];

export const QUESTION_STATUSES = ["open", "partially_answered", "answered"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const EVENT_SOURCES = ["season_plan", "episode_plan", "approved_screenplay"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const narrativeAliasSchema = z.object({
  value: z.string().trim().min(1).max(120),
  normalizedValue: z.string().trim().min(1).max(120),
});

export const narrativeEntitySchema = z.object({
  id: z.string().trim().min(1),
  canonicalName: z.string().trim().min(1).max(120),
  aliases: z.array(narrativeAliasSchema).max(20),
  type: z.enum(["character", "location", "object", "organization"]),
  authorTruth: z.string().trim().max(2000).optional(),
  firstIntroductionEpisode: z.number().int().positive().max(100).optional(),
  firstAppearanceEpisode: z.number().int().positive().max(100).optional(),
  lifecycle: z.enum(LIFECYCLE_STATUSES),
  importance: z.enum(ENTITY_IMPORTANCE),
});

export const knowledgeChangeSchema = z.object({
  characterId: z.string().trim().min(1),
  factId: z.string().trim().min(1),
  change: z.enum(KNOWLEDGE_CHANGE_TYPES),
  visibility: z.enum(KNOWLEDGE_VISIBILITIES),
  episode: z.number().int().positive().max(100),
});

export const narrativeEventSchema = z.object({
  id: z.string().trim().min(1),
  episode: z.number().int().positive().max(100),
  type: z.enum(EVENT_TYPES),
  description: z.string().trim().min(1).max(500),
  occurrenceOrder: z.number().int().optional(),
  audienceRevealEpisode: z.number().int().positive().max(100).optional(),
  audienceRevealOrder: z.number().int().optional(),
  participants: z.array(z.string().trim().min(1)).max(20),
  knowledgeChanges: z.array(knowledgeChangeSchema).max(30),
  causedBy: z.array(z.string().trim().min(1)).max(20),
  consequences: z.array(z.string().trim().min(1)).max(20),
  source: z.enum(EVENT_SOURCES),
  confidence: z.number().min(0).max(1),
});

export const relationshipStateChangeSchema = z.object({
  episode: z.number().int().positive().max(100),
  previousState: z.string().trim().max(200),
  newState: z.string().trim().max(200),
  causeEventId: z.string().trim().min(1).optional(),
});

export const relationshipStateSchema = z.object({
  id: z.string().trim().min(1),
  characterA: z.string().trim().min(1),
  characterB: z.string().trim().min(1),
  relationshipType: z.string().trim().max(100),
  initialState: z.string().trim().max(200),
  currentState: z.string().trim().max(200),
  introducedEpisode: z.number().int().positive().max(100),
  changes: z.array(relationshipStateChangeSchema).max(50),
});

export const threadQuestionSchema = z.object({
  question: z.string().trim().min(1).max(300),
  status: z.enum(QUESTION_STATUSES),
  answerEventId: z.string().trim().min(1).optional(),
});

export const narrativeThreadSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000),
  introducedEpisode: z.number().int().positive().max(100),
  intendedResolutionEpisode: z.number().int().positive().max(100).optional(),
  status: z.enum(NARRATIVE_THREAD_STATUSES),
  questions: z.array(threadQuestionSchema).max(10),
  setupEventIds: z.array(z.string().trim().min(1)).max(20),
  developmentEventIds: z.array(z.string().trim().min(1)).max(20),
  payoffEventIds: z.array(z.string().trim().min(1)).max(20),
  carryForwardReason: z.string().trim().max(500).optional(),
  intendedResolutionSeason: z.number().int().positive().max(20).optional(),
  importance: z.enum(THREAD_IMPORTANCE),
});

export const episodeNarrativeStateSchema = z.object({
  episode: z.number().int().positive().max(100),
  introducedEntities: z.array(z.string().trim().min(1)).max(50),
  activeEntities: z.array(z.string().trim().min(1)).max(50),
  absentEntities: z.array(z.string().trim().min(1)).max(50),
  events: z.array(z.string().trim().min(1)).max(30),
  relationshipChanges: z.array(z.string().trim().min(1)).max(20),
  knowledgeAcquired: z.array(knowledgeChangeSchema).max(30),
  incomingConsequences: z.array(z.string().trim().min(1)).max(20),
  outgoingConsequences: z.array(z.string().trim().min(1)).max(20),
  activeThreads: z.array(z.string().trim().min(1)).max(20),
  resolvedThreads: z.array(z.string().trim().min(1)).max(20),
  unresolvedQuestions: z.array(z.string().trim().max(300)).max(10),
});

export const causalLinkSchema = z.object({
  sourceEventId: z.string().trim().min(1),
  targetEventId: z.string().trim().min(1),
  relationship: z.enum(CAUSAL_RELATIONSHIPS),
  evidence: z.string().trim().max(500),
});

export const narrativeRegistrySchema = z.object({
  schemaVersion: z.number().int().min(1),
  seasonId: z.string().trim().min(1),
  entities: z.array(narrativeEntitySchema).max(200),
  events: z.array(narrativeEventSchema).max(500),
  relationships: z.array(relationshipStateSchema).max(100),
  threads: z.array(narrativeThreadSchema).max(100),
  episodeStates: z.array(episodeNarrativeStateSchema).max(100),
  causalLinks: z.array(causalLinkSchema).max(500),
});

export type NarrativeAlias = z.infer<typeof narrativeAliasSchema>;
export type NarrativeEntity = z.infer<typeof narrativeEntitySchema>;
export type KnowledgeChange = z.infer<typeof knowledgeChangeSchema>;
export type NarrativeEvent = z.infer<typeof narrativeEventSchema>;
export type RelationshipStateChange = z.infer<typeof relationshipStateChangeSchema>;
export type RelationshipState = z.infer<typeof relationshipStateSchema>;
export type ThreadQuestion = z.infer<typeof threadQuestionSchema>;
export type NarrativeThread = z.infer<typeof narrativeThreadSchema>;
export type EpisodeNarrativeState = z.infer<typeof episodeNarrativeStateSchema>;
export type CausalLink = z.infer<typeof causalLinkSchema>;
export type NarrativeRegistry = z.infer<typeof narrativeRegistrySchema>;

export const NARRATIVE_REGISTRY_SCHEMA_VERSION = 1;

export interface NarrativeRegistryRecord extends NarrativeRegistry {
  id: string;
  clerkUserId: string;
  projectId: string;
  basedOnBibleVersion: number;
  basedOnPlanVersion: number;
  registryVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NarrativeValidationFinding {
  code: string;
  severity: "error" | "warning" | "info";
  episode: number;
  entityId?: EntityId;
  eventId?: EventId;
  threadId?: ThreadId;
  message: string;
  evidence?: string;
  sourceEpisode?: number;
  expectedEpisode?: number;
  suggestedAction?: string;
}

export interface NarrativeValidationResult {
  valid: boolean;
  complete: boolean;
  registry: NarrativeRegistry;
  findings: NarrativeValidationFinding[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

export interface ExtractionResult<T> {
  success: boolean;
  data?: T;
  errors: Array<{
    path: string;
    message: string;
  }>;
}

export type NarrativeRegistryContext = {
  canonicalRegistry: CanonicalEntityRegistry;
  bible: import("@/lib/validation/storyBible").StoryBibleContent | null;
  plan: import("@/lib/validation/seasonPlan").SeasonPlan;
  ledger: import("@/lib/validation/continuityLedger").ContinuityLedger | null;
  ledgerAsOfEpisode?: number;
  characterProfiles?: import("@/lib/validation/productionStages").CharacterProfile[];
};

export function normalizeEntityName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveEntity(
  reference: string,
  registry: NarrativeRegistry,
): NarrativeEntity | undefined {
  const normalized = normalizeEntityName(reference);
  return registry.entities.find((entity) => {
    if (normalizeEntityName(entity.canonicalName) === normalized) {
      return true;
    }
    return entity.aliases.some((alias) => alias.normalizedValue === normalized);
  });
}

export function resolveEntityId(
  reference: string,
  registry: NarrativeRegistry,
): EntityId | undefined {
  return resolveEntity(reference, registry)?.id;
}

export function characterKnowsFact(
  registry: NarrativeRegistry,
  characterId: EntityId,
  factId: string,
  throughEpisode: EpisodeNumber,
): boolean {
  return registry.events.some(
    (event) =>
      event.episode <= throughEpisode &&
      event.knowledgeChanges.some(
        (change) =>
          change.characterId === characterId &&
          change.factId === factId &&
          change.change === "learned",
      ),
  );
}

export function audienceKnowsFact(
  registry: NarrativeRegistry,
  factId: string,
  throughEpisode: EpisodeNumber,
): boolean {
  return registry.events.some(
    (event) =>
      event.audienceRevealEpisode !== undefined &&
      event.audienceRevealEpisode <= throughEpisode &&
      event.knowledgeChanges.some(
        (change) =>
          change.factId === factId &&
          (change.visibility === "audience_only" ||
            change.visibility === "character_and_audience" ||
            change.visibility === "publicly_known"),
      ),
  );
}

export function authorKnowsFact(
  registry: NarrativeRegistry,
  factId: string,
): boolean {
  return registry.entities.some(
    (entity) =>
      entity.authorTruth !== undefined &&
      entity.authorTruth.length > 0 &&
      entity.id === factId,
  );
}

export function getEntityLifecycleAtEpisode(
  registry: NarrativeRegistry,
  entityId: EntityId,
  episode: EpisodeNumber,
): LifecycleStatus {
  const entity = registry.entities.find((e) => e.id === entityId);
  if (!entity) return "unknown";

  if (entity.firstAppearanceEpisode !== undefined && entity.firstAppearanceEpisode <= episode) {
    if (entity.lifecycle === "deceased") return "deceased";
    if (entity.lifecycle === "departed") return "departed";
    return "active";
  }

  if (entity.firstIntroductionEpisode !== undefined && entity.firstIntroductionEpisode <= episode) {
    return "introduced";
  }

  const mentioned = registry.events.some(
    (event) =>
      event.episode <= episode &&
      event.participants.includes(entityId) &&
      event.type !== "arrival",
  );
  if (mentioned) return "mentioned";

  return "not_introduced";
}

export function getActiveThreadsAtEpisode(
  registry: NarrativeRegistry,
  episode: EpisodeNumber,
): NarrativeThread[] {
  return registry.threads.filter(
    (thread) =>
      thread.introducedEpisode <= episode &&
      thread.status !== "resolved" &&
      thread.status !== "abandoned",
  );
}

export function getRelationshipStateAtEpisode(
  registry: NarrativeRegistry,
  characterAId: EntityId,
  characterBId: EntityId,
  episode: EpisodeNumber,
): RelationshipState | undefined {
  const rel = registry.relationships.find(
    (r) =>
      (r.characterA === characterAId && r.characterB === characterBId) ||
      (r.characterA === characterBId && r.characterB === characterAId),
  );
  if (!rel) return undefined;

  const relevantChanges = rel.changes.filter((c) => c.episode <= episode);
  if (relevantChanges.length === 0) {
    return { ...rel, currentState: rel.initialState, changes: [] };
  }
  return { ...rel, currentState: relevantChanges[relevantChanges.length - 1]!.newState, changes: relevantChanges };
}