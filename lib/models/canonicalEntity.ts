import { Schema, type Connection, type Model } from "mongoose";

const AppearanceSchema = new Schema({
  productionRunId: { type: Schema.Types.ObjectId, required: true },
  episodeId: { type: Schema.Types.ObjectId, default: null },
  episodeNumber: { type: Number, default: 1 },
  storyId: { type: Schema.Types.ObjectId, required: true },
}, { _id: false });

const CharacterVisualProfileSchema = new Schema({
  appearance: { type: String, default: "", maxlength: 600 },
  facial: { type: String, default: "", maxlength: 400 },
  hair: { type: String, default: "", maxlength: 300 },
  clothing: { type: String, default: "", maxlength: 400 },
  distinguishingFeatures: { type: String, default: "", maxlength: 400 },
  bodyType: { type: String, default: "", maxlength: 300 },
  voiceNotes: { type: String, default: "", maxlength: 400 },
  continuityNotes: { type: String, default: "", maxlength: 600 },
  defaultPresentation: { type: String, default: "", maxlength: 400 },
}, { _id: false });

const LocationVisualProfileSchema = new Schema({
  geography: { type: String, default: "", maxlength: 500 },
  architecture: { type: String, default: "", maxlength: 500 },
  materials: { type: String, default: "", maxlength: 400 },
  colourPalette: { type: String, default: "", maxlength: 300 },
  lighting: { type: String, default: "", maxlength: 400 },
  weather: { type: String, default: "", maxlength: 300 },
  atmosphere: { type: String, default: "", maxlength: 400 },
  continuityNotes: { type: String, default: "", maxlength: 600 },
}, { _id: false });

const ObjectVisualProfileSchema = new Schema({
  description: { type: String, default: "", maxlength: 600 },
  materials: { type: String, default: "", maxlength: 400 },
  colourPalette: { type: String, default: "", maxlength: 300 },
  continuityNotes: { type: String, default: "", maxlength: 600 },
}, { _id: false });

const AnimationLibraryEntrySchema = new Schema({
  animationId: { type: String, required: true, maxlength: 120 },
  name: { type: String, required: true, maxlength: 160 },
  assetId: { type: Schema.Types.ObjectId, default: null },
  category: { type: String, default: "", maxlength: 80 },
}, { _id: false });

const Character3DProfileSchema = new Schema({
  modelAssetId: { type: Schema.Types.ObjectId, default: null },
  rigAssetId: { type: Schema.Types.ObjectId, default: null },
  animationLibrary: { type: [AnimationLibraryEntrySchema], default: [] },
}, { _id: false });

const VisualProfileSchema = new Schema({
  character: { type: CharacterVisualProfileSchema, default: {} },
  location: { type: LocationVisualProfileSchema, default: {} },
  object: { type: ObjectVisualProfileSchema, default: {} },
  character3d: { type: Character3DProfileSchema, default: {} },
}, { _id: false });

const CanonicalEntitySchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  entityType: { type: String, enum: ["character", "location", "object"], required: true },
  normalizedName: { type: String, required: true },
  name: { type: String, required: true, maxlength: 160 },
  profile: { type: Schema.Types.Mixed, default: {} },
  visualProfile: { type: VisualProfileSchema, default: {} },
  description: { type: String, default: "", maxlength: 1200 },
  status: { type: String, enum: ["pending_review", "approved"], default: "pending_review" },
  appearances: { type: [AppearanceSchema], default: [] },
  defaultReferenceAssetId: { type: Schema.Types.ObjectId, default: null },
  voiceProfileId: { type: Schema.Types.ObjectId, default: null },
  sourceCanonVersion: { type: Number, default: null },
  canonStale: { type: Boolean, default: false },
  canonStaleReason: { type: String, default: "", maxlength: 600 },
}, { timestamps: true, collection: "canonicalEntities" });

CanonicalEntitySchema.index({ clerkUserId: 1, projectId: 1, entityType: 1, normalizedName: 1 }, { unique: true });
CanonicalEntitySchema.index({ clerkUserId: 1, projectId: 1, status: 1, entityType: 1 });

export function canonicalEntityModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.CanonicalEntity;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("CanonicalEntity", CanonicalEntitySchema) as unknown as Model<Record<string, unknown>>;
}
