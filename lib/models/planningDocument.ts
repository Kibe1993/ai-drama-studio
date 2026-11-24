import { Schema, type Connection, type Model } from "mongoose";

const PLANNING_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;

const AlternativeDirectionSchema = new Schema(
  {
    description: { type: String, required: true, maxlength: 2000 },
    pros: { type: [String], default: [] },
    cons: { type: [String], default: [] },
    selected: { type: Boolean, default: false },
  },
  { _id: false }
);

const ReferenceSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    type: { type: String, maxlength: 50, default: "other" },
    relevance: { type: String, maxlength: 500, default: "" },
  },
  { _id: false }
);

const PlanningDocumentSchema = new Schema(
  {
    clerkUserId: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, required: true, index: true },
    version: { type: Number, required: true, min: 1, default: 1 },
    status: { type: String, enum: PLANNING_STATUSES, default: "draft", index: true },
    rejectionReason: { type: String, default: null },
    concept: {
      logline: { type: String, default: "", maxlength: 500 },
      synopsis: { type: String, default: "", maxlength: 10000 },
      elevatorPitch: { type: String, default: "", maxlength: 1000 },
    },
    themes: { type: [String], default: [] },
    centralQuestion: { type: String, default: "", maxlength: 1000 },
    mainConflict: { type: String, default: "", maxlength: 2000 },
    audience: {
      demographic: { type: String, default: "", maxlength: 500 },
      tone: { type: String, default: "", maxlength: 200 },
      contentRating: { type: String, default: "", maxlength: 50 },
    },
    narrativeDirection: {
      structure: { type: String, default: "", maxlength: 200 },
      pov: { type: String, default: "", maxlength: 200 },
      pacing: { type: String, default: "", maxlength: 200 },
    },
    alternativeDirections: { type: [AlternativeDirectionSchema], default: [] },
    references: { type: [ReferenceSchema], default: [] },
  },
  { timestamps: true, collection: "planningdocuments" }
);

PlanningDocumentSchema.index({ clerkUserId: 1, projectId: 1, version: 1 }, { unique: true });

export function planningDocumentModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioPlanningDocument;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioPlanningDocument", PlanningDocumentSchema) as unknown as Model<Record<string, unknown>>;
}