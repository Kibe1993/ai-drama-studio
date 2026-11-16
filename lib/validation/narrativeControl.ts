import { z } from "zod";

/**
 * Application-owned narrative canon.
 *
 * These records are the source of truth for what is established, hidden,
 * provisional, or retracted. Model output is parsed into proposals and is
 * never written here until the narrative-control orchestrator accepts it.
 */

export const NARRATIVE_CONTROL_SCHEMA_VERSION = 1;

export const FACT_CLASSIFICATIONS = [
  "AUTHOR_TRUTH",
  "ESTABLISHED_CANON",
  "CHARACTER_KNOWLEDGE",
  "AUDIENCE_KNOWLEDGE",
  "HIDDEN_TRUTH",
  "PROVISIONAL",
  "RETRACTED",
] as const;
export type FactClassification = (typeof FACT_CLASSIFICATIONS)[number];

export const LIFECYCLE_STATES = [
  "not_introduced",
  "mentioned",
  "introduced",
  "physically_appeared",
  "active",
  "temporarily_absent",
  "offscreen_active",
  "departed",
  "deceased",
  "concealed_identity",
  "unknown",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const KNOWLEDGE_CERTAINTIES = ["certain", "suspected", "mistaken", "incomplete"] as const;
export type KnowledgeCertainty = (typeof KNOWLEDGE_CERTAINTIES)[number];

export const THREAD_CATEGORIES = [
  "mystery",
  "foreshadowing",
  "character_arc",
  "relationship_arc",
  "conflict",
  "setup_payoff",
  "world_building",
  "future_season_hook",
] as const;
export type ThreadCategory = (typeof THREAD_CATEGORIES)[number];

export const THREAD_LIFECYCLE = [
  "proposed",
  "introduced",
  "active",
  "developed",
  "partially_revealed",
  "paid_off",
  "resolved",
  "deliberately_carried_forward",
  "abandoned_with_explanation",
] as const;
export type ThreadLifecycle = (typeof THREAD_LIFECYCLE)[number];

export const CHANGE_KINDS = ["ADD", "MODIFY", "REMOVE", "RETRACT", "REINTERPRET"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const FINDING_SEVERITIES = ["ERROR", "WARNING", "INFO"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const VALIDATION_LAYERS = ["structural", "deterministic", "semantic", "regression"] as const;
export type ValidationLayer = (typeof VALIDATION_LAYERS)[number];

const id = z.string().trim().min(1).max(160);
const shortText = z.string().trim().max(2000);
const episode = z.number().int().min(1).max(200);

export const canonEntitySchema = z.object({
  id,
  kind: z.enum(["character", "location", "object", "organization"]),
  name: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(24).default([]),
  description: shortText.default(""),
  role: z.string().trim().max(200).default(""),
  motivations: z.array(z.string().trim().max(400)).max(12).default([]),
  goals: z.array(z.string().trim().max(400)).max(12).default([]),
  firstIntroductionEpisode: episode.nullable().default(null),
  firstAppearanceEpisode: episode.nullable().default(null),
  appearances: z.array(episode).max(200).default([]),
  lifecycle: z.enum(LIFECYCLE_STATES).default("unknown"),
  arc: shortText.default(""),
  secrets: z.array(z.string().trim().max(500)).max(12).default([]),
  permitsNonlivingAppearance: z.boolean().default(false),
  endedEpisode: episode.nullable().default(null),
  ownerId: z.string().trim().max(160).nullable().default(null),
  locationId: z.string().trim().max(160).nullable().default(null),
  properties: z.array(z.string().trim().max(200)).max(20).default([]),
  significance: shortText.default(""),
  transfers: z.array(z.object({
    episode,
    fromOwnerId: z.string().trim().max(160).nullable(),
    toOwnerId: z.string().trim().max(160).nullable(),
    eventId: z.string().trim().max(160).nullable(),
  })).max(40).default([]),
  modifications: z.array(z.object({
    episode,
    description: z.string().trim().min(1).max(400),
    eventId: z.string().trim().max(160).nullable(),
  })).max(40).default([]),
  locationRules: z.array(z.string().trim().max(400)).max(12).default([]),
});
export type CanonEntity = z.infer<typeof canonEntitySchema>;

export const canonRelationshipSchema = z.object({
  id,
  characterIds: z.tuple([id, id]),
  relationshipType: z.string().trim().min(1).max(120),
  initialState: z.string().trim().max(400).default(""),
  currentState: z.string().trim().max(400).default(""),
  introducedEpisode: episode,
  historical: z.boolean().default(false),
  changes: z.array(z.object({
    episode,
    previousState: z.string().trim().max(400),
    newState: z.string().trim().max(400),
    eventId: z.string().trim().max(160).nullable(),
  })).max(40).default([]),
});
export type CanonRelationship = z.infer<typeof canonRelationshipSchema>;

export const canonEventSchema = z.object({
  id,
  description: z.string().trim().min(1).max(800),
  participantIds: z.array(id).max(20).default([]),
  locationId: z.string().trim().max(160).nullable().default(null),
  episode,
  presentationEpisode: episode.nullable().default(null),
  audienceEpisode: episode.nullable().default(null),
  preconditions: z.array(id).max(20).default([]),
  triggers: z.array(id).max(20).default([]),
  consequences: z.array(id).max(20).default([]),
  causedBy: z.array(id).max(20).default([]),
  acknowledgement: z.enum(["required", "optional"]).default("optional"),
  contradictoryWith: z.array(id).max(20).default([]),
  requiresCause: z.boolean().default(false),
});
export type CanonEvent = z.infer<typeof canonEventSchema>;

export const canonThreadSchema = z.object({
  id,
  description: z.string().trim().min(1).max(800),
  category: z.enum(THREAD_CATEGORIES),
  status: z.enum(THREAD_LIFECYCLE),
  scope: z.enum(["central", "secondary", "arc", "hook"]),
  introducedEpisode: episode,
  setupEpisodes: z.array(episode).max(24).default([]),
  developmentEpisodes: z.array(episode).max(24).default([]),
  payoffEpisodes: z.array(episode).max(24).default([]),
  intendedResolution: z.string().trim().max(400).default(""),
  intendedSeason: z.number().int().min(1).max(20).nullable().default(null),
  carryForward: z.boolean().default(false),
  explanation: z.string().trim().max(800).default(""),
  subjectEntityIds: z.array(id).max(12).default([]),
});
export type CanonThread = z.infer<typeof canonThreadSchema>;

export const narrativeFactSchema = z.object({
  id,
  key: z.string().trim().min(1).max(160),
  statement: z.string().trim().min(1).max(2000),
  classification: z.enum(FACT_CLASSIFICATIONS),
  protected: z.boolean(),
  subjectEntityIds: z.array(id).max(12).default([]),
  value: z.string().trim().max(400).default(""),
  rolePhrase: z.string().trim().max(120).default(""),
  literalKind: z.enum(["none", "date", "phrase"]).default("none"),
  audienceRevealEpisode: episode.nullable().default(null),
  certainPatterns: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  suspectedPatterns: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  forbiddenLiterals: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
});
export type NarrativeFact = z.infer<typeof narrativeFactSchema>;

export const knowledgeEntrySchema = z.object({
  id,
  characterId: id,
  factId: id,
  knownFromEpisode: episode,
  learnedVia: z.string().trim().max(400).default(""),
  believes: z.boolean().default(true),
  certainty: z.enum(KNOWLEDGE_CERTAINTIES),
  supportingEventId: z.string().trim().max(160).nullable().default(null),
});
export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;

export const worldRuleSchema = z.object({
  id,
  description: z.string().trim().min(1).max(800),
  scope: z.string().trim().max(200).default("story"),
  conditions: z.array(z.string().trim().max(300)).max(8).default([]),
  exceptions: z.array(z.object({
    id,
    description: z.string().trim().min(1).max(400),
    episode,
    approved: z.boolean(),
  })).max(12).default([]),
  establishedRef: z.string().trim().max(160).default(""),
  approvalStatus: z.enum(["approved", "provisional"]).default("approved"),
  violationPatterns: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  /** Structured frequency. A null interval means the rule is not a repeating interval. */
  canonicalInterval: z.object({
    count: z.number().int().positive().max(10000),
    unit: z.enum(["year", "month", "week", "day"]),
  }).nullable().default(null),
});
export type WorldRule = z.infer<typeof worldRuleSchema>;

export const revisionLogEntrySchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().trim().max(800),
  changeIds: z.array(id).max(100),
});
export type RevisionLogEntry = z.infer<typeof revisionLogEntrySchema>;

export const canonStateSchema = z.object({
  schemaVersion: z.literal(NARRATIVE_CONTROL_SCHEMA_VERSION).default(NARRATIVE_CONTROL_SCHEMA_VERSION),
  projectId: id,
  version: z.number().int().min(0),
  basedOnBibleVersion: z.number().int().min(0).default(0),
  basedOnPlanVersion: z.number().int().min(0).default(0),
  entities: z.array(canonEntitySchema).max(200).default([]),
  relationships: z.array(canonRelationshipSchema).max(200).default([]),
  events: z.array(canonEventSchema).max(400).default([]),
  threads: z.array(canonThreadSchema).max(120).default([]),
  facts: z.array(narrativeFactSchema).max(400).default([]),
  knowledge: z.array(knowledgeEntrySchema).max(400).default([]),
  rules: z.array(worldRuleSchema).max(80).default([]),
  resolvedFindingSignatures: z.array(z.string().trim().min(1).max(240)).max(400).default([]),
  revisionLog: z.array(revisionLogEntrySchema).max(200).default([]),
});
export type CanonState = z.infer<typeof canonStateSchema>;

export const proposedChangeSchema = z.object({
  id,
  kind: z.enum(CHANGE_KINDS),
  targetKind: z.enum(["fact", "entity", "relationship", "event", "thread", "rule", "object", "scene", "knowledge"]),
  targetId: id,
  currentValue: z.string().max(4000).default(""),
  proposedValue: z.string().max(8000).default(""),
  reason: z.string().max(800).default(""),
  objective: z.string().max(800).default(""),
  evidence: z.string().max(800).default(""),
  dependencies: z.array(z.string().trim().min(1).max(160)).max(40).default([]),
});
export type ProposedChange = z.infer<typeof proposedChangeSchema>;

export const narrativeRevisionResponseSchema = z.object({
  taskId: id,
  projectId: id,
  narrativeVersion: z.number().int().min(0),
  proposedContent: z.string().max(100_000).default(""),
  proposedChanges: z.array(proposedChangeSchema).max(80).default([]),
  newEntities: z.array(canonEntitySchema).max(40).default([]),
  newFacts: z.array(narrativeFactSchema).max(40).default([]),
  modifiedFacts: z.array(narrativeFactSchema).max(40).default([]),
  dependencies: z.array(z.string().trim().max(160)).max(40).default([]),
  uncertainties: z.array(z.string().trim().max(400)).max(20).default([]),
});
export type NarrativeRevisionResponse = z.infer<typeof narrativeRevisionResponseSchema>;

export const narrativeGenerationRequestSchema = z.object({
  taskId: id,
  projectId: id,
  narrativeVersion: z.number().int().min(0),
  targetArtifact: z.enum([
    "story_draft",
    "story_revision",
    "story_bible",
    "season_plan",
    "episode_plan",
    "screenplay",
    "scene",
    "shot",
    "audio",
    "video",
    "timeline",
  ]),
  targetId: z.string().trim().max(160).default(""),
  episode: episode.nullable().default(null),
  objective: z.string().trim().min(1).max(800),
  allowedChangeIds: z.array(id).max(80).default([]),
});
export type NarrativeGenerationRequest = z.infer<typeof narrativeGenerationRequestSchema>;

/** Application-side permission. A model response cannot set this. */
export type CanonAuthorization = {
  factIds: string[];
  ruleIds: string[];
  entityIds: string[];
};

export function emptyAuthorization(): CanonAuthorization {
  return { factIds: [], ruleIds: [], entityIds: [] };
}

export function isCurrentFact(fact: NarrativeFact): boolean {
  return fact.classification !== "RETRACTED" && fact.classification !== "PROVISIONAL";
}

export function isProtectedFact(fact: NarrativeFact): boolean {
  return fact.protected && isCurrentFact(fact);
}
