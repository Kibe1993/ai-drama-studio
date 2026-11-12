import { Schema, type Connection, type Model } from "mongoose";

const AppearanceSchema = new Schema({
  productionRunId: { type: Schema.Types.ObjectId, required: true },
  episodeId: { type: Schema.Types.ObjectId, default: null },
  episodeNumber: { type: Number, default: 1 },
  storyId: { type: Schema.Types.ObjectId, required: true },
}, { _id: false });

const CanonicalEntitySchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  entityType: { type: String, enum: ["character", "location"], required: true },
  normalizedName: { type: String, required: true },
  name: { type: String, required: true, maxlength: 160 },
  profile: { type: Schema.Types.Mixed, default: {} },
  description: { type: String, default: "", maxlength: 1200 },
  status: { type: String, enum: ["pending_review", "approved"], default: "pending_review" },
  appearances: { type: [AppearanceSchema], default: [] },
}, { timestamps: true, collection: "canonicalEntities" });

CanonicalEntitySchema.index({ clerkUserId: 1, projectId: 1, entityType: 1, normalizedName: 1 }, { unique: true });
CanonicalEntitySchema.index({ clerkUserId: 1, projectId: 1, status: 1, entityType: 1 });

export function canonicalEntityModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.CanonicalEntity;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("CanonicalEntity", CanonicalEntitySchema) as unknown as Model<Record<string, unknown>>;
}
