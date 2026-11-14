import { Schema, type Connection, type Model } from "mongoose";

const CostEventSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: String, required: true },
    generationJobId: { type: Schema.Types.ObjectId, default: null },
    provider: { type: String, required: true, maxlength: 80 },
    model: { type: String, required: true, maxlength: 160 },
    usage: { type: Schema.Types.Mixed, default: {} },
    estimatedCostCents: { type: Number, default: 0, min: 0 },
    billable: { type: Boolean, default: false },
    kind: { type: String, enum: ["generation", "render"], default: "generation" },
  },
  { timestamps: true, collection: "costEvents" }
);

CostEventSchema.index({ clerkUserId: 1, projectId: 1, createdAt: -1 });
CostEventSchema.index({ generationJobId: 1 });

export function costEventModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.CostEvent;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("CostEvent", CostEventSchema) as unknown as Model<Record<string, unknown>>;
}