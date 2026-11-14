import { Schema, type Connection, type Model } from "mongoose";

const GenerationContextSchema = new Schema({
  prompt: { type: String, default: "", maxlength: 4000 },
  referenceAssetIds: { type: [Schema.Types.ObjectId], default: [] },
  provider: { type: String, default: "", maxlength: 80 },
  model: { type: String, default: "", maxlength: 160 },
  settings: { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const ShotSegmentSchema = new Schema({
  segmentNumber: { type: Number, required: true, min: 1 },
  durationSeconds: { type: Number, required: true, min: 0.1 },
  assetId: { type: Schema.Types.ObjectId, default: null },
}, { _id: false });

const ShotProductionRecordSchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  productionSceneId: { type: Schema.Types.ObjectId, required: true },
  shotNumber: { type: Number, required: true, min: 1 },
  productionStatus: { type: String, enum: ["pending", "in_progress", "completed", "failed"], default: "pending" },
  generationContext: { type: GenerationContextSchema, default: {} },
  resultingAssetIds: { type: [Schema.Types.ObjectId], default: [] },
  segments: { type: [ShotSegmentSchema], default: [] },
  adjustedDurationSeconds: { type: Number, default: null, min: 0 },
  validationInfo: { type: Schema.Types.Mixed, default: {} },
  idempotencyKey: { type: String, required: true, maxlength: 180 },
}, { timestamps: true, collection: "shotProductionRecords" });

ShotProductionRecordSchema.index({ clerkUserId: 1, productionSceneId: 1, shotNumber: 1 }, { unique: true });
ShotProductionRecordSchema.index({ clerkUserId: 1, projectId: 1, productionStatus: 1 });

export function shotProductionRecordModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.ShotProductionRecord;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("ShotProductionRecord", ShotProductionRecordSchema) as unknown as Model<Record<string, unknown>>;
}