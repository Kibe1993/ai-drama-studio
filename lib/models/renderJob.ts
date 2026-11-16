import { Schema, type Connection, type Model } from "mongoose";

const RENDER_JOB_STATUSES = ["queued", "processing", "completed", "failed", "cancelled"] as const;

const RenderJobSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    episodeId: { type: Schema.Types.ObjectId, required: true },
    timelineId: { type: Schema.Types.ObjectId, required: true },
    presetId: { type: String, required: true, maxlength: 60 },
    inputAssetIds: { type: [Schema.Types.ObjectId], default: [] },
    outputAssetId: { type: Schema.Types.ObjectId, default: null },
    renderSettings: { type: Schema.Types.Mixed, default: {} },
    ffmpegVersion: { type: String, default: null, maxlength: 40 },
    renderDurationSeconds: { type: Number, default: null, min: 0 },
    status: { type: String, enum: RENDER_JOB_STATUSES, default: "queued" },
    error: { type: Schema.Types.Mixed, default: null },
    idempotencyKey: { type: String, required: true, maxlength: 180 },
    bullJobId: { type: String, default: null, maxlength: 120 },
    startedAt: { type: String, default: null },
    completedAt: { type: String, default: null },
    sourceCanonVersion: { type: Number, default: null },
    canonStale: { type: Boolean, default: false },
    canonStaleReason: { type: String, default: "", maxlength: 600 },
  },
  { timestamps: true, collection: "renderJobs" }
);

RenderJobSchema.index({ clerkUserId: 1, timelineId: 1 });
RenderJobSchema.index({ clerkUserId: 1, status: 1 });
RenderJobSchema.index({ idempotencyKey: 1 }, { unique: true });

export function renderJobModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.RenderJob;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("RenderJob", RenderJobSchema) as unknown as Model<Record<string, unknown>>;
}