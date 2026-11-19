import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { episodeModel } from "@/lib/models/episode";
import { projectModel } from "@/lib/models/project";
import type { EpisodeInput, EpisodeRecord } from "@/lib/validation/episode";

type EpisodeDoc = EpisodeRecord & { _id: mongoose.Types.ObjectId; projectId: mongoose.Types.ObjectId; currentStoryId?: mongoose.Types.ObjectId | null; createdAt: Date; updatedAt: Date };

function toRecord(doc: EpisodeDoc): EpisodeRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    currentStoryId: doc.currentStoryId?.toString() ?? null,
    baseSnapshotVersion: doc.baseSnapshotVersion ?? 0,
    basePlanVersion: doc.basePlanVersion ?? 0,
    timelineId: (doc as Record<string, unknown>).timelineId != null
      ? String((doc as Record<string, unknown>).timelineId)
      : null,
    renderAssetId: (doc as Record<string, unknown>).renderAssetId != null
      ? String((doc as Record<string, unknown>).renderAssetId)
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function models() {
  const connection = await connectDB();
  return { Episode: episodeModel(connection), Project: projectModel(connection) };
}

export const episodeRepository = {
  async listOwned(clerkUserId: string, projectId: string): Promise<EpisodeRecord[] | null> {
    const { Episode, Project } = await models();
    if (!(await Project.exists({ clerkUserId, _id: projectId }))) return null;
    const docs = await Episode.find({ clerkUserId, projectId }).sort({ episodeNumber: 1 }).lean<EpisodeDoc[]>();
    return docs.map(toRecord);
  },

  async findOwned(clerkUserId: string, projectId: string, episodeId: string): Promise<EpisodeRecord | null> {
    const { Episode } = await models();
    const doc = await Episode.findOne({ clerkUserId, projectId, _id: episodeId }).lean<EpisodeDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async ensureFirst(clerkUserId: string, projectId: string, title: string, targetDurationSeconds: number): Promise<EpisodeRecord | null> {
    const existing = await this.listOwned(clerkUserId, projectId);
    if (!existing) return null;
    if (existing[0]) return existing[0];
    return this.create(clerkUserId, projectId, { title: "Episode 1", premise: "", targetDurationSeconds }, 0);
  },

  async create(clerkUserId: string, projectId: string, input: EpisodeInput, baseSnapshotVersion: number, basePlanVersion = 0): Promise<EpisodeRecord | null> {
    const { Episode, Project } = await models();
    if (!(await Project.exists({ clerkUserId, _id: projectId }))) return null;
    const last = await Episode.findOne({ clerkUserId, projectId }).sort({ episodeNumber: -1 }).select({ episodeNumber: 1 }).lean<{ episodeNumber: number } | null>();
    const doc = await Episode.create({
      clerkUserId,
      projectId,
      episodeNumber: (last?.episodeNumber ?? 0) + 1,
      ...input,
      status: "draft",
      currentStoryId: null,
      baseSnapshotVersion,
      basePlanVersion,
    });
    return toRecord(doc.toObject() as unknown as EpisodeDoc);
  },

  async updateStatus(clerkUserId: string, projectId: string, episodeId: string, status: EpisodeRecord["status"], currentStoryId?: string | null): Promise<EpisodeRecord | null> {
    const { Episode } = await models();
    const patch: Record<string, unknown> = { status };
    if (currentStoryId !== undefined) patch.currentStoryId = currentStoryId;
    const doc = await Episode.findOneAndUpdate(
      { clerkUserId, projectId, _id: episodeId }, patch, { new: true }
    ).lean<EpisodeDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async setRenderAsset(clerkUserId: string, projectId: string, episodeId: string, renderAssetId: string): Promise<EpisodeRecord | null> {
    const { Episode } = await models();
    const doc = await Episode.findOneAndUpdate(
      { clerkUserId, projectId, _id: episodeId }, { renderAssetId }, { new: true }
    ).lean<EpisodeDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async setTimeline(clerkUserId: string, projectId: string, episodeId: string, timelineId: string): Promise<EpisodeRecord | null> {
    const { Episode } = await models();
    const doc = await Episode.findOneAndUpdate(
      { clerkUserId, projectId, _id: episodeId }, { timelineId }, { new: true }
    ).lean<EpisodeDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async updateCanonExtractionStatus(
    clerkUserId: string,
    projectId: string,
    episodeId: string,
    status:
      | "extraction_pending"
      | "extraction_processing"
      | "canon_committed"
      | "canon_committed_with_issues"
      | "extraction_failed",
    error?: string | null,
  ): Promise<EpisodeRecord | null> {
    const { Episode } = await models();
    const patch: Record<string, unknown> = { canonExtractionStatus: status };
    if (error !== undefined) patch.canonExtractionError = error;
    const doc = await Episode.findOneAndUpdate(
      { clerkUserId, projectId, _id: episodeId },
      { $set: patch },
      { new: true },
    ).lean<EpisodeDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findApprovedWithoutExtraction(clerkUserId: string, projectId: string): Promise<EpisodeRecord[]> {
    const { Episode } = await models();
    const docs = await Episode.find({
      clerkUserId,
      projectId,
      status: "story_approved",
      canonExtractionStatus: null,
    }).lean<EpisodeDoc[]>();
    return docs.map(toRecord);
  },

  async findExtractionProcessing(clerkUserId: string, projectId: string): Promise<EpisodeRecord[]> {
    const { Episode } = await models();
    const docs = await Episode.find({
      clerkUserId,
      projectId,
      canonExtractionStatus: "extraction_processing",
    }).lean<EpisodeDoc[]>();
    return docs.map(toRecord);
  },
};
