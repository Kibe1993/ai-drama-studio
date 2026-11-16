import { Schema, type Connection, type Model } from "mongoose";

const canonicalAliasSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    type: { type: String, enum: ["disguise", "codename", "phone_voice", "nickname", "alias"], default: "alias" },
    description: { type: String, default: "", maxlength: 400 },
  },
  { _id: false }
);

const canonicalEntitySchema = new Schema(
  {
    canonicalId: { type: String, required: true, maxlength: 120 },
    type: { type: String, required: true, enum: ["character", "location", "relationship", "thread", "event"] },
    primaryName: { type: String, required: true, maxlength: 120 },
    aliases: { type: [canonicalAliasSchema], default: [] },
    storyRole: { type: String, default: "", maxlength: 80 },
    description: { type: String, default: "", maxlength: 600 },
  },
  { _id: false }
);

const entityAppearanceSchema = new Schema(
  {
    episodeNumber: { type: Number, required: true, min: 1, max: 100 },
    appearanceType: {
      type: String,
      required: true,
      enum: ["planned_introduction", "first_reference", "first_appearance", "appearance", "mention", "planned_absence", "departure", "death"],
    },
    evidence: { type: String, default: "", maxlength: 400 },
  },
  { _id: false }
);

const statusChangeSchema = new Schema(
  {
    episodeNumber: { type: Number, required: true, min: 1, max: 100 },
    status: {
      type: String,
      required: true,
      enum: [
        "not_yet_introduced",
        "mentioned_not_appeared",
        "introduced",
        "appeared",
        "temporarily_absent",
        "off_screen_active",
        "departed",
        "deceased",
        "concealed_identity",
      ],
    },
    reason: { type: String, default: "", maxlength: 300 },
  },
  { _id: false }
);

const entityLifecycleSchema = new Schema(
  {
    canonicalId: { type: String, required: true, maxlength: 120 },
    plannedIntroductionEpisode: { type: Number, min: 1, max: 100, default: null },
    firstReferenceEpisode: { type: Number, min: 1, max: 100, default: null },
    firstAppearanceEpisode: { type: Number, min: 1, max: 100, default: null },
    appearances: { type: [entityAppearanceSchema], default: [] },
    currentStatus: {
      type: String,
      enum: [
        "not_yet_introduced",
        "mentioned_not_appeared",
        "introduced",
        "appeared",
        "temporarily_absent",
        "off_screen_active",
        "departed",
        "deceased",
        "concealed_identity",
      ],
      default: "not_yet_introduced",
    },
    statusHistory: { type: [statusChangeSchema], default: [] },
    setupEpisodes: { type: [Number], default: [] },
    payoffEpisodes: { type: [Number], default: [] },
    developmentEpisodes: { type: [Number], default: [] },
    threadStatus: { type: String, enum: ["open", "developing", "resolved", "carried_forward", "abandoned"], default: null },
    intendedResolutionEpisode: { type: Number, min: 1, max: 100, default: null },
    isIntentionalCarryForward: { type: Boolean, default: false },
    chronologicalOrder: { type: Number, min: 0, default: null },
    presentationOrder: { type: Number, min: 0, default: null },
    isNonLinear: { type: Boolean, default: false },
  },
  { _id: false }
);

const CanonicalRegistrySchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    entities: { type: [canonicalEntitySchema], default: [] },
    lifecycles: { type: [entityLifecycleSchema], default: [] },
    basedOnBibleVersion: { type: Number, required: true, min: 0 },
    basedOnPlanVersion: { type: Number, required: true, min: 0 },
    version: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true, collection: "canonicalEntityRegistries" }
);

CanonicalRegistrySchema.index({ clerkUserId: 1, projectId: 1, version: -1 });

export function canonicalRegistryModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioCanonicalEntityRegistry;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioCanonicalEntityRegistry", CanonicalRegistrySchema) as unknown as Model<Record<string, unknown>>;
}