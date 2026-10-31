import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { productionRunModel } from "@/lib/models/productionRun";
import { ownedQuery } from "@/lib/repositories/ownership";
import type { RunRecord } from "@/lib/pipeline/types";

type RunDoc = {
  _id: mongoose.Types.ObjectId;
  clerkUserId: string;
  projectId: string;
  workflowMode: RunRecord["workflowMode"];
  currentStage: RunRecord["currentStage"];
  status: RunRecord["status"];
  stageResults?: RunRecord["stageResults"];
  retryCheckpoint?: RunRecord["retryCheckpoint"];
  startedAt: Date;
  completedAt?: Date | null;
};

function toRecord(doc: RunDoc): RunRecord {
  return {
    id: doc._id.toString(),
    clerkUserId: doc.clerkUserId,
    projectId: doc.projectId,
    workflowMode: doc.workflowMode,
    currentStage: doc.currentStage,
    status: doc.status,
    stageResults: doc.stageResults ?? {},
    retryCheckpoint: doc.retryCheckpoint ?? null,
    startedAt: new Date(doc.startedAt).toISOString(),
    completedAt: doc.completedAt ? new Date(doc.completedAt).toISOString() : null,
  };
}

async function model() {
  return productionRunModel(await connectDB());
}

export const productionRunRepository = {
  async insert(input: Omit<RunRecord, "id">): Promise<RunRecord> {
    const Run = await model();
    const doc = await Run.create({
      ...input,
      startedAt: new Date(input.startedAt),
      completedAt: input.completedAt ? new Date(input.completedAt) : null,
    });
    return toRecord(doc.toObject() as unknown as RunDoc);
  },

  async findOwned(clerkUserId: string, id: string): Promise<RunRecord | null> {
    const Run = await model();
    const doc = await Run.findOne(ownedQuery(clerkUserId, id)).lean<RunDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findLatest(clerkUserId: string, projectId: string): Promise<RunRecord | null> {
    const Run = await model();
    const doc = await Run.findOne({ ...ownedQuery(clerkUserId), projectId })
      .sort({ createdAt: -1 })
      .lean<RunDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async save(run: RunRecord): Promise<RunRecord> {
    const Run = await model();
    const doc = await Run.findOneAndUpdate(
      ownedQuery(run.clerkUserId, run.id),
      {
        currentStage: run.currentStage,
        status: run.status,
        stageResults: run.stageResults,
        retryCheckpoint: run.retryCheckpoint,
        completedAt: run.completedAt ? new Date(run.completedAt) : null,
      },
      { new: true }
    ).lean<RunDoc | null>();
    if (!doc) throw new Error("Production run not found");
    return toRecord(doc);
  },
};
