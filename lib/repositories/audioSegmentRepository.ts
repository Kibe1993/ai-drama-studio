import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { audioSegmentModel } from "@/lib/models/audioSegment";
import type { AudioSegmentRecord, AudioSegmentStatus } from "@/lib/validation/audioSegment";

type SegmentDoc = AudioSegmentRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  episodeId?: mongoose.Types.ObjectId | null;
  runId: mongoose.Types.ObjectId;
  storyId: mongoose.Types.ObjectId;
  canonicalEntityId?: mongoose.Types.ObjectId | null;
  voiceProfileId?: mongoose.Types.ObjectId | null;
  mediaAssetId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: SegmentDoc): AudioSegmentRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    episodeId: doc.episodeId?.toString() ?? null,
    runId: doc.runId.toString(),
    storyId: doc.storyId.toString(),
    canonicalEntityId: doc.canonicalEntityId?.toString() ?? null,
    voiceProfileId: doc.voiceProfileId?.toString() ?? null,
    mediaAssetId: doc.mediaAssetId?.toString() ?? null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export const audioSegmentRepository = {
  async createMany(
    clerkUserId: string,
    segments: Omit<AudioSegmentRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt">[]
  ): Promise<AudioSegmentRecord[]> {
    if (segments.length === 0) return [];
    const AudioSegment = audioSegmentModel(await connectDB());
    const docs = await AudioSegment.insertMany(segments.map((s) => ({ ...s, clerkUserId })));
    return docs.map((doc) => toRecord(doc.toObject() as unknown as SegmentDoc));
  },

  async listByRun(clerkUserId: string, runId: string): Promise<AudioSegmentRecord[]> {
    const AudioSegment = audioSegmentModel(await connectDB());
    const docs = await AudioSegment.find({ clerkUserId, runId })
      .sort({ sceneNumber: 1, sequence: 1 })
      .lean<SegmentDoc[]>();
    return docs.map(toRecord);
  },

  async listByRunAndStatus(
    clerkUserId: string,
    runId: string,
    status: AudioSegmentStatus
  ): Promise<AudioSegmentRecord[]> {
    const AudioSegment = audioSegmentModel(await connectDB());
    const docs = await AudioSegment.find({ clerkUserId, runId, status })
      .sort({ sceneNumber: 1, sequence: 1 })
      .lean<SegmentDoc[]>();
    return docs.map(toRecord);
  },

  async findById(clerkUserId: string, segmentId: string): Promise<AudioSegmentRecord | null> {
    const AudioSegment = audioSegmentModel(await connectDB());
    const doc = await AudioSegment.findOne({ clerkUserId, _id: segmentId }).lean<SegmentDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markProcessing(clerkUserId: string, segmentId: string): Promise<AudioSegmentRecord | null> {
    const AudioSegment = audioSegmentModel(await connectDB());
    const doc = await AudioSegment.findOneAndUpdate(
      { clerkUserId, _id: segmentId, status: { $in: ["pending", "failed", "processing"] } },
      { status: "processing", $inc: { attempts: 1 }, error: null },
      { new: true }
    ).lean<SegmentDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markCompleted(
    clerkUserId: string,
    segmentId: string,
    result: { mediaAssetId: string; durationSeconds: number }
  ): Promise<AudioSegmentRecord | null> {
    const AudioSegment = audioSegmentModel(await connectDB());
    const doc = await AudioSegment.findOneAndUpdate(
      { clerkUserId, _id: segmentId },
      {
        status: "completed",
        mediaAssetId: result.mediaAssetId,
        durationSeconds: result.durationSeconds,
        error: null,
      },
      { new: true }
    ).lean<SegmentDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markFailed(
    clerkUserId: string,
    segmentId: string,
    error: string
  ): Promise<AudioSegmentRecord | null> {
    const AudioSegment = audioSegmentModel(await connectDB());
    const doc = await AudioSegment.findOneAndUpdate(
      { clerkUserId, _id: segmentId },
      { status: "failed", error: error.slice(0, 500) },
      { new: true }
    ).lean<SegmentDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async deleteByRun(clerkUserId: string, runId: string): Promise<void> {
    const AudioSegment = audioSegmentModel(await connectDB());
    await AudioSegment.deleteMany({ clerkUserId, runId });
  },

  async cancelByRun(clerkUserId: string, runId: string): Promise<number> {
    const AudioSegment = audioSegmentModel(await connectDB());
    const result = await AudioSegment.updateMany(
      { clerkUserId, runId, status: { $in: ["pending", "processing"] } },
      { status: "failed", error: "Cancelled by user" }
    );
    return result.modifiedCount;
  },

  async countByRun(clerkUserId: string, runId: string): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    const AudioSegment = audioSegmentModel(await connectDB());
    const docs = await AudioSegment.find({ clerkUserId, runId }).lean<SegmentDoc[]>();
    return {
      total: docs.length,
      pending: docs.filter((d) => d.status === "pending").length,
      processing: docs.filter((d) => d.status === "processing").length,
      completed: docs.filter((d) => d.status === "completed").length,
      failed: docs.filter((d) => d.status === "failed").length,
    };
  },
};