import { Schema, type Connection, type Model } from "mongoose";

const ShotPlanSchema = new Schema({
  shotNumber: { type: Number, required: true, min: 1 },
  purpose: { type: String, required: true, maxlength: 240 },
  framing: { type: String, default: "", maxlength: 120 },
  cameraAngle: { type: String, default: "", maxlength: 120 },
  cameraDirection: { type: String, default: "", maxlength: 300 },
  action: { type: String, default: "", maxlength: 500 },
  environment: { type: String, default: "", maxlength: 300 },
  lighting: { type: String, default: "", maxlength: 200 },
  continuity: { type: String, default: "", maxlength: 300 },
  estimatedDurationSeconds: { type: Number, default: null },
}, { _id: false });

const ProductionSceneSchema = new Schema({
  clerkUserId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  productionRunId: { type: Schema.Types.ObjectId, required: true },
  episodeId: { type: Schema.Types.ObjectId, default: null },
  storyId: { type: Schema.Types.ObjectId, required: true },
  sceneNumber: { type: Number, required: true, min: 1 },
  title: { type: String, required: true, maxlength: 160 },
  location: { type: String, required: true, maxlength: 160 },
  interiorExterior: { type: String, enum: ["interior", "exterior", ""], default: "" },
  timeOfDay: { type: String, required: true, maxlength: 40 },
  charactersPresent: { type: [String], required: true },
  visualDescription: { type: String, required: true, maxlength: 1200 },
  action: { type: String, required: true, maxlength: 1200 },
  dialogue: { type: [Schema.Types.Mixed], default: [] },
  cameraDirection: { type: String, default: "", maxlength: 400 },
  estimatedDurationSeconds: { type: Number, default: null },
  shotPlan: { type: [ShotPlanSchema], default: [] },
  videoReady: { type: Boolean, default: false },
  videoStatus: { type: String, enum: ["pending", "processing", "mock", "completed", "failed", "unavailable"], default: "pending" },
  videoAssetId: { type: Schema.Types.ObjectId, default: null },
  failed: { type: Boolean, default: false },
}, { timestamps: true, collection: "productionScenes" });

ProductionSceneSchema.index({ clerkUserId: 1, productionRunId: 1, sceneNumber: 1 }, { unique: true });
ProductionSceneSchema.index({ clerkUserId: 1, projectId: 1, episodeId: 1, sceneNumber: 1 });

export function productionSceneModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.ProductionScene;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("ProductionScene", ProductionSceneSchema) as unknown as Model<Record<string, unknown>>;
}
