import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { costEventModel } from "@/lib/models/costEvent";
import type { CostEventRecord } from "@/lib/validation/costEvent";

type CostDoc = CostEventRecord & {
  _id: mongoose.Types.ObjectId;
  generationJobId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: CostDoc): CostEventRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    generationJobId: doc.generationJobId?.toString() ?? null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export const costEventRepository = {
  async create(
    clerkUserId: string,
    input: Omit<CostEventRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt">
  ): Promise<CostEventRecord> {
    const CostEvent = costEventModel(await connectDB());
    const created = await CostEvent.create({ ...input, clerkUserId });
    return toRecord(created.toObject() as unknown as CostDoc);
  },

  async sumByProject(clerkUserId: string, projectId: string): Promise<number> {
    const CostEvent = costEventModel(await connectDB());
    const result = await CostEvent.aggregate<{
      total: number;
    }>([
      { $match: { clerkUserId, projectId, billable: true } },
      { $group: { _id: null, total: { $sum: "$estimatedCostCents" } } },
    ]);
    return result[0]?.total ?? 0;
  },
};