import { Schema, type Connection, type Model } from "mongoose";

const PRODUCTION_DESIGN_STATUSES = ["draft", "approved", "rejected"] as const;

const ShotSchema = new Schema(
  {
    shotNumber: { type: Number, required: true, min: 1 },
    type: { type: String, maxlength: 50, default: "medium" },
    cameraDirection: { type: String, default: "", maxlength: 500 },
    cameraMovement: { type: String, default: "", maxlength: 200 },
    lens: { type: String, default: "", maxlength: 100 },
    framing: { type: String, default: "", maxlength: 200 },
    duration: { type: Number, default: 0, min: 0 },
    lightingSetup: { type: String, default: "", maxlength: 500 },
    lightingNotes: { type: String, default: "", maxlength: 2000 },
    storyboardDescription: { type: String, default: "", maxlength: 5000 },
    visualContinuityNotes: { type: String, default: "", maxlength: 2000 },
  },
  { _id: false }
);

const CharacterStagingSchema = new Schema(
  {
    characterId: { type: String, required: true },
    position: { type: String, default: "", maxlength: 200 },
    action: { type: String, default: "", maxlength: 500 },
  },
  { _id: false }
);

const ProductionDesignSchema = new Schema(
  {
    clerkUserId: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, required: true, index: true },
    sceneId: { type: Schema.Types.ObjectId, required: true, index: true },
    version: { type: Number, required: true, min: 1, default: 1 },
    status: { type: String, enum: PRODUCTION_DESIGN_STATUSES, default: "draft", index: true },
    shotList: { type: [ShotSchema], default: [] },
    locationDesign: {
      dressing: { type: String, default: "", maxlength: 2000 },
      props: { type: String, default: "", maxlength: 2000 },
      atmosphere: { type: String, default: "", maxlength: 2000 },
    },
    characterStaging: { type: [CharacterStagingSchema], default: [] },
  },
  { timestamps: true, collection: "productiondesigns" }
);

ProductionDesignSchema.index({ clerkUserId: 1, projectId: 1, sceneId: 1, version: 1 }, { unique: true });

export function productionDesignModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioProductionDesign;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioProductionDesign", ProductionDesignSchema) as unknown as Model<Record<string, unknown>>;
}