import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { mediaAssetModel } from "@/lib/models/mediaAsset";
import { projectModel } from "@/lib/models/project";
import type { MediaAssetRecord } from "@/lib/validation/mediaAsset";

type AssetDoc = MediaAssetRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  episodeId?: mongoose.Types.ObjectId | null;
  sceneId?: mongoose.Types.ObjectId | null;
  generationJobId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: AssetDoc): MediaAssetRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    episodeId: doc.episodeId?.toString() ?? null,
    sceneId: doc.sceneId?.toString() ?? null,
    generationJobId: doc.generationJobId?.toString() ?? null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

async function models() {
  const connection = await connectDB();
  return { Asset: mediaAssetModel(connection), Project: projectModel(connection) };
}

export const mediaAssetRepository = {
  async ownsProject(clerkUserId: string, projectId: string): Promise<boolean> {
    const { Project } = await models();
    return Boolean(await Project.exists({ clerkUserId, _id: projectId }));
  },

  async createVerified(clerkUserId: string, asset: Omit<MediaAssetRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt" | "reviewStatus">): Promise<MediaAssetRecord | null> {
    const { Asset, Project } = await models();
    if (!(await Project.exists({ clerkUserId, _id: asset.projectId }))) return null;
    const existing = await Asset.findOne({ clerkUserId, idempotencyKey: asset.idempotencyKey }).lean<AssetDoc | null>();
    if (existing) {
      if (existing.sha256 !== asset.sha256 || existing.storageKey !== asset.storageKey) {
        throw new Error("media_idempotency_conflict");
      }
      return toRecord(existing);
    }
    try {
      const created = await Asset.create({ ...asset, clerkUserId, reviewStatus: "pending" });
      return toRecord(created.toObject() as unknown as AssetDoc);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      const raced = await Asset.findOne({ clerkUserId, idempotencyKey: asset.idempotencyKey }).lean<AssetDoc | null>();
      if (!raced || raced.sha256 !== asset.sha256 || raced.storageKey !== asset.storageKey) {
        throw new Error("media_idempotency_conflict");
      }
      return toRecord(raced);
    }
  },

  async findOwned(clerkUserId: string, assetId: string): Promise<MediaAssetRecord | null> {
    const Asset = mediaAssetModel(await connectDB());
    const doc = await Asset.findOne({ clerkUserId, _id: assetId }).lean<AssetDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async listProject(clerkUserId: string, projectId: string): Promise<MediaAssetRecord[] | null> {
    const { Asset, Project } = await models();
    if (!(await Project.exists({ clerkUserId, _id: projectId }))) return null;
    const docs = await Asset.find({ clerkUserId, projectId }).sort({ createdAt: -1 }).lean<AssetDoc[]>();
    return docs.map(toRecord);
  },

  async listStorageKeys(storageProvider: MediaAssetRecord["storageProvider"]): Promise<string[]> {
    const Asset = mediaAssetModel(await connectDB());
    const docs = await Asset.find({ storageProvider }).select({ storageKey: 1 }).lean<Array<{ storageKey: string }>>();
    return docs.map((doc) => doc.storageKey);
  },
};
