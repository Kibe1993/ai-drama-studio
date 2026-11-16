import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");

export const CANONICAL_ENTITY_TYPES = [
  "character",
  "location",
  "relationship",
  "thread",
  "event",
] as const;
export type CanonicalEntityType = (typeof CANONICAL_ENTITY_TYPES)[number];

export const CHARACTER_STATUSES = [
  "not_yet_introduced",
  "mentioned_not_appeared",
  "introduced",
  "appeared",
  "temporarily_absent",
  "off_screen_active",
  "departed",
  "deceased",
  "concealed_identity",
] as const;
export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];

export const THREAD_STATUSES = [
  "open",
  "developing",
  "resolved",
  "carried_forward",
  "abandoned",
] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const APPEARANCE_TYPES = [
  "planned_introduction",
  "first_reference",
  "first_appearance",
  "appearance",
  "mention",
  "planned_absence",
  "departure",
  "death",
] as const;
export type AppearanceType = (typeof APPEARANCE_TYPES)[number];

export const canonicalAliasSchema = z.object({
  name: text(80),
  type: z.enum(["disguise", "codename", "phone_voice", "nickname", "alias"]).default("alias"),
  description: optionalText(400),
});
export type CanonicalAlias = z.infer<typeof canonicalAliasSchema>;

export const canonicalEntitySchema = z.object({
  canonicalId: text(120),
  type: z.enum(CANONICAL_ENTITY_TYPES),
  primaryName: text(120),
  aliases: z.array(canonicalAliasSchema).max(10).default([]),
  storyRole: optionalText(80),
  description: optionalText(600),
});
export type CanonicalEntity = z.infer<typeof canonicalEntitySchema>;

export const entityAppearanceSchema = z.object({
  episodeNumber: z.number().int().min(1).max(100),
  appearanceType: z.enum(APPEARANCE_TYPES),
  evidence: optionalText(400),
});
export type EntityAppearance = z.infer<typeof entityAppearanceSchema>;

export const statusChangeSchema = z.object({
  episodeNumber: z.number().int().min(1).max(100),
  status: z.enum(CHARACTER_STATUSES),
  reason: optionalText(300),
});
export type StatusChange = z.infer<typeof statusChangeSchema>;

export const entityLifecycleSchema = z.object({
  canonicalId: text(120),
  plannedIntroductionEpisode: z.number().int().min(1).max(100).nullable().default(null),
  firstReferenceEpisode: z.number().int().min(1).max(100).nullable().default(null),
  firstAppearanceEpisode: z.number().int().min(1).max(100).nullable().default(null),
  appearances: z.array(entityAppearanceSchema).max(100).default([]),
  currentStatus: z.enum(CHARACTER_STATUSES).default("not_yet_introduced"),
  statusHistory: z.array(statusChangeSchema).max(100).default([]),
  setupEpisodes: z.array(z.number().int().min(1).max(100)).max(24).default([]),
  payoffEpisodes: z.array(z.number().int().min(1).max(100)).max(24).default([]),
  developmentEpisodes: z.array(z.number().int().min(1).max(100)).max(24).default([]),
  threadStatus: z.enum(THREAD_STATUSES).nullable().default(null),
  intendedResolutionEpisode: z.number().int().min(1).max(100).nullable().default(null),
  isIntentionalCarryForward: z.boolean().default(false),
  chronologicalOrder: z.number().int().min(0).nullable().default(null),
  presentationOrder: z.number().int().min(0).nullable().default(null),
  isNonLinear: z.boolean().default(false),
});
export type EntityLifecycle = z.infer<typeof entityLifecycleSchema>;

export const canonicalEntityRegistrySchema = z.object({
  entities: z.array(canonicalEntitySchema).max(200).default([]),
  lifecycles: z.array(entityLifecycleSchema).max(200).default([]),
});
export type CanonicalEntityRegistry = z.infer<typeof canonicalEntityRegistrySchema>;

export type CanonicalEntityRegistryRecord = CanonicalEntityRegistry & {
  id: string;
  clerkUserId: string;
  projectId: string;
  basedOnBibleVersion: number;
  basedOnPlanVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function makeCanonicalId(type: CanonicalEntityType, name: string): string {
  return `${type}:${normalizeName(name)}`;
}

export function makeRelationshipId(from: string, to: string): string {
  return `relationship:${normalizeName(from)}→${normalizeName(to)}`;
}