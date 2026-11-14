import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { shotProductionRecordModel } from "@/lib/models/shotProductionRecord";
import type { ShotProductionRecord } from "@/lib/validation/shotProduction";

type RecordDoc = ShotProductionRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  productionSceneId: mongoose.Types.ObjectId;
  resultingAssetIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: RecordDoc): ShotProductionRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    productionSceneId: doc.productionSceneId.toString(),
    resultingAssetIds: doc.resultingAssetIds.map((id) => id.toString()),
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export const shotProductionRepository = {
  async create(
    clerkUserId: string,
    input: Omit<ShotProductionRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt">
  ): Promise<ShotProductionRecord> {
    const ShotRecord = shotProductionRecordModel(await connectDB());
    const created = await ShotRecord.create({ ...input, clerkUserId });
    return toRecord(created.toObject() as unknown as RecordDoc);
  },

  async findByScene(
    clerkUserId: string,
    productionSceneId: string
  ): Promise<ShotProductionRecord[]> {
    const ShotRecord = shotProductionRecordModel(await connectDB());
    const docs = await ShotRecord.find({ clerkUserId, productionSceneId })
      .sort({ shotNumber: 1 })
      .lean<RecordDoc[]>();
    return docs.map(toRecord);
  },

  async findOwned(
    clerkUserId: string,
    recordId: string
  ): Promise<ShotProductionRecord | null> {
    const ShotRecord = shotProductionRecordModel(await connectDB());
    const doc = await ShotRecord.findOne({ clerkUserId, _id: recordId }).lean<RecordDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async updateStatus(
    clerkUserId: string,
    recordId: string,
    productionStatus: ShotProductionRecord["productionStatus"],
    patch?: { resultingAssetIds?: string[]; adjustedDurationSeconds?: number | null; validationInfo?: Record<string, unknown> }
  ): Promise<ShotProductionRecord | null> {
    const ShotRecord = shotProductionRecordModel(await connectDB());
    const update: Record<string, unknown> = { productionStatus };
    if (patch?.resultingAssetIds) update.resultingAssetIds = patch.resultingAssetIds;
    if (patch?.adjustedDurationSeconds !== undefined) update.adjustedDurationSeconds = patch.adjustedDurationSeconds;
    if (patch?.validationInfo) update.validationInfo = patch.validationInfo;
    const doc = await ShotRecord.findOneAndUpdate(
      { clerkUserId, _id: recordId },
      update,
      { new: true }
    ).lean<RecordDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findPending(clerkUserId: string, projectId: string): Promise<ShotProductionRecord[]> {
    const ShotRecord = shotProductionRecordModel(await connectDB());
    const docs = await ShotRecord.find({
      clerkUserId,
      projectId,
      productionStatus: { $in: ["pending", "in_progress"] },
    }).lean<RecordDoc[]>();
    return docs.map(toRecord);
  },
};