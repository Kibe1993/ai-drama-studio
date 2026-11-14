import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { renderJobModel } from "@/lib/models/renderJob";
import type { RenderJobRecord } from "@/lib/validation/renderJob";

type RenderJobDoc = RenderJobRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  episodeId: mongoose.Types.ObjectId;
  timelineId: mongoose.Types.ObjectId;
  inputAssetIds: mongoose.Types.ObjectId[];
  outputAssetId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: RenderJobDoc): RenderJobRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    episodeId: doc.episodeId.toString(),
    timelineId: doc.timelineId.toString(),
    inputAssetIds: doc.inputAssetIds.map((id) => id.toString()),
    outputAssetId: doc.outputAssetId?.toString() ?? null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export const renderJobRepository = {
  async create(
    clerkUserId: string,
    input: Omit<RenderJobRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt">
  ): Promise<RenderJobRecord> {
    const RenderJob = renderJobModel(await connectDB());
    const created = await RenderJob.create({ ...input, clerkUserId });
    return toRecord(created.toObject() as unknown as RenderJobDoc);
  },

  async findOwned(clerkUserId: string, renderJobId: string): Promise<RenderJobRecord | null> {
    const RenderJob = renderJobModel(await connectDB());
    const doc = await RenderJob.findOne({ clerkUserId, _id: renderJobId }).lean<RenderJobDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findByTimeline(clerkUserId: string, timelineId: string): Promise<RenderJobRecord[]> {
    const RenderJob = renderJobModel(await connectDB());
    const docs = await RenderJob.find({ clerkUserId, timelineId }).sort({ createdAt: -1 }).lean<RenderJobDoc[]>();
    return docs.map(toRecord);
  },

  async findActive(clerkUserId: string): Promise<RenderJobRecord[]> {
    const RenderJob = renderJobModel(await connectDB());
    const docs = await RenderJob.find({ clerkUserId, status: { $in: ["queued", "processing"] } }).lean<RenderJobDoc[]>();
    return docs.map(toRecord);
  },

  async save(job: RenderJobRecord): Promise<RenderJobRecord> {
    const RenderJob = renderJobModel(await connectDB());
    const updated = await RenderJob.findOneAndUpdate(
      { clerkUserId: job.clerkUserId, _id: job.id },
      { ...job, _id: job.id },
      { new: true, upsert: false }
    ).lean<RenderJobDoc | null>();
    if (!updated) throw new Error(`RenderJob ${job.id} not found`);
    return toRecord(updated);
  },

  async markProcessing(clerkUserId: string, renderJobId: string): Promise<RenderJobRecord | null> {
    const RenderJob = renderJobModel(await connectDB());
    const doc = await RenderJob.findOneAndUpdate(
      { clerkUserId, _id: renderJobId },
      { status: "processing", startedAt: new Date().toISOString() },
      { new: true }
    ).lean<RenderJobDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markCompleted(
    clerkUserId: string,
    renderJobId: string,
    output: { outputAssetId: string; ffmpegVersion: string; renderDurationSeconds: number }
  ): Promise<RenderJobRecord | null> {
    const RenderJob = renderJobModel(await connectDB());
    const doc = await RenderJob.findOneAndUpdate(
      { clerkUserId, _id: renderJobId },
      {
        status: "completed",
        outputAssetId: output.outputAssetId,
        ffmpegVersion: output.ffmpegVersion,
        renderDurationSeconds: output.renderDurationSeconds,
        completedAt: new Date().toISOString(),
      },
      { new: true }
    ).lean<RenderJobDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markFailed(
    clerkUserId: string,
    renderJobId: string,
    error: { code: string; message: string; retryable: boolean }
  ): Promise<RenderJobRecord | null> {
    const RenderJob = renderJobModel(await connectDB());
    const doc = await RenderJob.findOneAndUpdate(
      { clerkUserId, _id: renderJobId },
      { status: "failed", error, completedAt: new Date().toISOString() },
      { new: true }
    ).lean<RenderJobDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markCancelled(clerkUserId: string, renderJobId: string): Promise<RenderJobRecord | null> {
    const RenderJob = renderJobModel(await connectDB());
    const doc = await RenderJob.findOneAndUpdate(
      { clerkUserId, _id: renderJobId },
      { status: "cancelled", completedAt: new Date().toISOString() },
      { new: true }
    ).lean<RenderJobDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};