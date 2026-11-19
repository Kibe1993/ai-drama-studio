import { z } from "zod";
import {
  canonEntitySchema,
  canonRelationshipSchema,
  canonEventSchema,
  canonThreadSchema,
  narrativeFactSchema,
  knowledgeEntrySchema,
  worldRuleSchema,
  FACT_CLASSIFICATIONS,
  type FactClassification,
} from "@/lib/validation/narrativeControl";

export const CANON_FACT_SCHEMA_VERSION = 1;

export const CANON_FACT_KINDS = [
  "entity",
  "relationship",
  "event",
  "thread",
  "fact",
  "knowledge",
  "rule",
] as const;
export type CanonFactKind = (typeof CANON_FACT_KINDS)[number];

export const CANON_FACT_OPERATIONS = ["add", "modify", "retract", "reinterpret"] as const;
export type CanonFactOperation = (typeof CANON_FACT_OPERATIONS)[number];

export const NARRATIVE_MODES = [
  "present",
  "flashback",
  "dream",
  "vision",
  "speculation",
  "lie",
] as const;
export type NarrativeMode = (typeof NARRATIVE_MODES)[number];

export const ASSERTION_KINDS = [
  "event",
  "character_statement",
  "character_belief",
  "character_experience",
] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export const FACTUAL_STATUSES = ["established", "not_established"] as const;
export type FactualStatus = (typeof FACTUAL_STATUSES)[number];

const id = z.string().trim().min(1).max(160);
const episode = z.number().int().min(0).max(200);

export const evidenceSchema = z.object({
  quote: z.string().trim().min(1).max(4000),
  sceneNumber: z.number().int().min(1).max(500),
  episode: z.number().int().min(1).max(200),
  episodeId: z.string().trim().min(1).max(160),
  storyId: z.string().trim().min(1).max(160),
  storyVersion: z.number().int().min(1).max(10000),
  sourceHash: z.string().trim().min(1).max(128),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const canonFactEntrySchema = z
  .object({
    id,
    sequence: z.number().int().min(1),
    projectId: id,
    episode,
    sourceStoryId: z.string().trim().max(160).nullable().default(null),
    operation: z.enum(CANON_FACT_OPERATIONS),
    kind: z.enum(CANON_FACT_KINDS),
    targetId: id,
    payload: z.unknown().nullable().default(null),
    newClassification: z.enum(FACT_CLASSIFICATIONS).nullable().default(null),
    evidence: evidenceSchema.nullable().default(null),
    narrativeMode: z.enum(NARRATIVE_MODES).default("present"),
    assertionKind: z.enum(ASSERTION_KINDS).default("event"),
    factualStatus: z.enum(FACTUAL_STATUSES).default("established"),
    asserterId: z.string().trim().max(160).nullable().default(null),
    commitBatchId: z.string().trim().max(160).nullable().default(null),
    reason: z.string().trim().max(800).default(""),
    extractor: z.string().trim().min(1).max(200),
    createdAt: z.date(),
  })
  .superRefine((entry, ctx) => {
    if (entry.episode > 0 && entry.evidence === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Screenplay-derived facts (episode > 0) require evidence with quote, scene, storyId, storyVersion, and sourceHash.",
        path: ["evidence"],
      });
    }
    if ((entry.operation === "add" || entry.operation === "modify") && entry.payload === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "payload required for add/modify operations",
        path: ["payload"],
      });
    }
  });
export type CanonFactEntry = z.infer<typeof canonFactEntrySchema>;

export const subjectiveFactSchema = z.object({
  entryId: id,
  kind: z.enum(CANON_FACT_KINDS),
  targetId: id,
  assertionKind: z.enum(ASSERTION_KINDS),
  narrativeMode: z.enum(NARRATIVE_MODES),
  episode: z.number().int().min(0).max(200),
  sceneNumber: z.number().int().min(1).max(500).nullable().default(null),
  asserterId: z.string().trim().max(160).nullable().default(null),
  payload: z.unknown(),
});
export type SubjectiveFact = z.infer<typeof subjectiveFactSchema>;

export const derivedCanonStateSchema = z.object({
  schemaVersion: z.literal(CANON_FACT_SCHEMA_VERSION).default(CANON_FACT_SCHEMA_VERSION),
  projectId: id,
  sequence: z.number().int().min(0).default(0),
  asOfEpisode: z.number().int().min(0).max(200).default(0),
  factCount: z.number().int().min(0).default(0),
  entities: z.array(canonEntitySchema).max(500).default([]),
  relationships: z.array(canonRelationshipSchema).max(500).default([]),
  events: z.array(canonEventSchema).max(1000).default([]),
  threads: z.array(canonThreadSchema).max(300).default([]),
  facts: z.array(narrativeFactSchema).max(1000).default([]),
  knowledge: z.array(knowledgeEntrySchema).max(1000).default([]),
  rules: z.array(worldRuleSchema).max(200).default([]),
  retracted: z.array(id).max(2000).default([]),
  subjective: z.array(subjectiveFactSchema).max(2000).default([]),
});
export type DerivedCanonState = z.infer<typeof derivedCanonStateSchema>;

export function emptyDerivedCanonState(projectId: string): DerivedCanonState {
  return {
    schemaVersion: CANON_FACT_SCHEMA_VERSION,
    projectId,
    sequence: 0,
    asOfEpisode: 0,
    factCount: 0,
    entities: [],
    relationships: [],
    events: [],
    threads: [],
    facts: [],
    knowledge: [],
    rules: [],
    retracted: [],
    subjective: [],
  };
}

const PAYLOAD_SCHEMAS: Record<CanonFactKind, z.ZodType> = {
  entity: canonEntitySchema,
  relationship: canonRelationshipSchema,
  event: canonEventSchema,
  thread: canonThreadSchema,
  fact: narrativeFactSchema,
  knowledge: knowledgeEntrySchema,
  rule: worldRuleSchema,
};

export function parsePayload<T extends CanonFactKind>(
  kind: T,
  payload: unknown,
): z.infer<(typeof PAYLOAD_SCHEMAS)[T]> {
  return PAYLOAD_SCHEMAS[kind].parse(payload) as z.infer<(typeof PAYLOAD_SCHEMAS)[T]>;
}

export function defaultFactualStatus(mode: NarrativeMode): FactualStatus {
  if (mode === "present" || mode === "flashback") return "established";
  return "not_established";
}

export type { FactClassification };