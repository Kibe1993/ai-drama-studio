import type { Connection } from "mongoose";
import { Schema, model } from "mongoose";

const narrativeAliasSchema = new Schema({
  value: { type: String, required: true, trim: true, maxlength: 120 },
  normalizedValue: { type: String, required: true, trim: true, maxlength: 120 },
}, { _id: false });

const narrativeEntitySchema = new Schema({
  id: { type: String, required: true, trim: true },
  canonicalName: { type: String, required: true, trim: true, maxlength: 120 },
  aliases: { type: [narrativeAliasSchema], default: [], validate: (v: unknown[]) => v.length <= 20 },
  type: { type: String, required: true, enum: ["character", "location", "object", "organization"] },
  authorTruth: { type: String, trim: true, maxlength: 2000 },
  firstIntroductionEpisode: { type: Number, min: 1, max: 100 },
  firstAppearanceEpisode: { type: Number, min: 1, max: 100 },
  lifecycle: { type: String, required: true, enum: [
    "not_introduced", "mentioned", "introduced", "active",
    "temporarily_absent", "offscreen_active", "departed", "deceased", "unknown",
  ] },
  importance: { type: String, required: true, enum: ["primary", "supporting", "minor"] },
}, { _id: false });

const knowledgeChangeSchema = new Schema({
  characterId: { type: String, required: true, trim: true },
  factId: { type: String, required: true, trim: true },
  change: { type: String, required: true, enum: ["learned", "forgotten", "misled", "corrected"] },
  visibility: { type: String, required: true, enum: [
    "author_only", "character_only", "audience_only",
    "character_and_audience", "publicly_known",
  ] },
  episode: { type: Number, required: true, min: 1, max: 100 },
}, { _id: false });

const narrativeEventSchema = new Schema({
  id: { type: String, required: true, trim: true },
  episode: { type: Number, required: true, min: 1, max: 100 },
  type: { type: String, required: true, enum: [
    "arrival", "departure", "discovery", "revelation", "decision",
    "relationship_change", "conflict", "consequence", "death",
    "location_change", "object_introduction", "rule_established",
    "rule_broken", "other",
  ] },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  occurrenceOrder: { type: Number },
  audienceRevealEpisode: { type: Number, min: 1, max: 100 },
  audienceRevealOrder: { type: Number },
  participants: { type: [String], default: [] },
  knowledgeChanges: { type: [knowledgeChangeSchema], default: [] },
  causedBy: { type: [String], default: [] },
  consequences: { type: [String], default: [] },
  source: { type: String, required: true, enum: ["season_plan", "episode_plan", "approved_screenplay"] },
  confidence: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const relationshipStateChangeSchema = new Schema({
  episode: { type: Number, required: true, min: 1, max: 100 },
  previousState: { type: String, required: true, trim: true, maxlength: 200 },
  newState: { type: String, required: true, trim: true, maxlength: 200 },
  causeEventId: { type: String, trim: true },
}, { _id: false });

const relationshipStateSchema = new Schema({
  id: { type: String, required: true, trim: true },
  characterA: { type: String, required: true, trim: true },
  characterB: { type: String, required: true, trim: true },
  relationshipType: { type: String, required: true, trim: true, maxlength: 100 },
  initialState: { type: String, required: true, trim: true, maxlength: 200 },
  currentState: { type: String, required: true, trim: true, maxlength: 200 },
  introducedEpisode: { type: Number, required: true, min: 1, max: 100 },
  changes: { type: [relationshipStateChangeSchema], default: [] },
}, { _id: false });

const threadQuestionSchema = new Schema({
  question: { type: String, required: true, trim: true, maxlength: 300 },
  status: { type: String, required: true, enum: ["open", "partially_answered", "answered"] },
  answerEventId: { type: String, trim: true },
}, { _id: false });

const narrativeThreadSchema = new Schema({
  id: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  introducedEpisode: { type: Number, required: true, min: 1, max: 100 },
  intendedResolutionEpisode: { type: Number, min: 1, max: 100 },
  status: { type: String, required: true, enum: [
    "unresolved", "developing", "partially_resolved",
    "resolved", "intentionally_carried_forward", "abandoned",
  ] },
  questions: { type: [threadQuestionSchema], default: [] },
  setupEventIds: { type: [String], default: [] },
  developmentEventIds: { type: [String], default: [] },
  payoffEventIds: { type: [String], default: [] },
  carryForwardReason: { type: String, trim: true, maxlength: 500 },
  intendedResolutionSeason: { type: Number, min: 1, max: 20 },
  importance: { type: String, required: true, enum: ["major", "minor", "background"] },
}, { _id: false });

const episodeNarrativeStateSchema = new Schema({
  episode: { type: Number, required: true, min: 1, max: 100 },
  introducedEntities: { type: [String], default: [] },
  activeEntities: { type: [String], default: [] },
  absentEntities: { type: [String], default: [] },
  events: { type: [String], default: [] },
  relationshipChanges: { type: [String], default: [] },
  knowledgeAcquired: { type: [knowledgeChangeSchema], default: [] },
  incomingConsequences: { type: [String], default: [] },
  outgoingConsequences: { type: [String], default: [] },
  activeThreads: { type: [String], default: [] },
  resolvedThreads: { type: [String], default: [] },
  unresolvedQuestions: { type: [String], default: [] },
}, { _id: false });

const causalLinkSchema = new Schema({
  sourceEventId: { type: String, required: true, trim: true },
  targetEventId: { type: String, required: true, trim: true },
  relationship: { type: String, required: true, enum: [
    "causes", "motivates", "enables", "prevents",
    "reveals", "complicates", "resolves", "supersedes",
  ] },
  evidence: { type: String, required: true, trim: true, maxlength: 500 },
}, { _id: false });

const narrativeRegistrySchema = new Schema({
  clerkUserId: { type: String, required: true, trim: true, index: true },
  projectId: { type: String, required: true, trim: true, index: true },
  schemaVersion: { type: Number, required: true, min: 1 },
  seasonId: { type: String, required: true, trim: true },
  entities: { type: [narrativeEntitySchema], default: [] },
  events: { type: [narrativeEventSchema], default: [] },
  relationships: { type: [relationshipStateSchema], default: [] },
  threads: { type: [narrativeThreadSchema], default: [] },
  episodeStates: { type: [episodeNarrativeStateSchema], default: [] },
  causalLinks: { type: [causalLinkSchema], default: [] },
  basedOnBibleVersion: { type: Number, required: true, min: 0 },
  basedOnPlanVersion: { type: Number, required: true, min: 1 },
  registryVersion: { type: Number, required: true, min: 1 },
  createdAt: { type: Date, required: true, default: Date.now },
  updatedAt: { type: Date, required: true, default: Date.now },
});

narrativeRegistrySchema.index({ clerkUserId: 1, projectId: 1, registryVersion: -1 });

export function narrativeRegistryModel(connection: Connection) {
  return model("StudioNarrativeRegistry", narrativeRegistrySchema, "narrativeRegistries", { connection });
}