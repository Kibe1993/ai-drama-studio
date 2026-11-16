import { Schema, model, type Connection } from "mongoose";

const narrativeCanonSchema = new Schema({
  clerkUserId: { type: String, required: true, trim: true, index: true },
  projectId: { type: String, required: true, trim: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnBibleVersion: { type: Number, required: true, min: 0 },
  basedOnPlanVersion: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true, trim: true, maxlength: 800 },
  state: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
}, { minimize: false });

narrativeCanonSchema.index({ clerkUserId: 1, projectId: 1, version: -1 }, { unique: true });

export function narrativeCanonModel(connection: Connection) {
  return connection.models.StudioNarrativeCanon
    ?? model("StudioNarrativeCanon", narrativeCanonSchema, "narrativeCanons", { connection });
}
