import { Schema, type Connection, type Model } from "mongoose";
import { WORKFLOW_MODES } from "@/lib/domain/projectCatalog";
import { RUN_STATUSES } from "@/lib/pipeline/types";

const RunSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: String, required: true },
    episode: { type: Schema.Types.Mixed, default: null },
    workflowMode: { type: String, enum: WORKFLOW_MODES, required: true },
    currentStage: { type: String, required: true },
    status: { type: String, enum: RUN_STATUSES, required: true },
    stageResults: { type: Schema.Types.Mixed, default: {} },
    retryCheckpoint: { type: String, default: null },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "productionRuns" }
);

RunSchema.index({ projectId: 1, createdAt: -1 });
RunSchema.index({ clerkUserId: 1, projectId: 1 });

export function productionRunModel(connection: Connection): Model<Record<string, never>> {
  return (
    connection.models.ProductionRun ??
    connection.model("ProductionRun", RunSchema)
  );
}
