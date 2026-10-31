import { Schema, type Connection, type Model } from "mongoose";
import { JOB_STATUSES, JOB_TYPES } from "@/lib/pipeline/types";

const JobSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: String, required: true },
    runId: { type: String, required: true },
    sceneNumber: { type: Number, default: null },
    jobType: { type: String, enum: JOB_TYPES, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    input: { type: Schema.Types.Mixed, default: {} },
    output: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: JOB_STATUSES, required: true },
    progress: {
      stage: { type: String, default: "" },
      message: { type: String, default: "" },
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    error: { type: Schema.Types.Mixed, default: null },
    idempotencyKey: { type: String, required: true },
    bullJobId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "generationJobs" }
);

JobSchema.index({ idempotencyKey: 1 }, { unique: true });
JobSchema.index({ clerkUserId: 1, projectId: 1, createdAt: -1 });
JobSchema.index({ runId: 1, status: 1 });
JobSchema.index({ status: 1 });

export function generationJobModel(connection: Connection): Model<Record<string, never>> {
  return connection.models.GenerationJob ?? connection.model("GenerationJob", JobSchema);
}
