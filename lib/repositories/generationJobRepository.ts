import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { generationJobModel } from "@/lib/models/generationJob";
import { ownedQuery } from "@/lib/repositories/ownership";
import type { JobRecord } from "@/lib/pipeline/types";

type JobDoc = Omit<JobRecord, "id" | "startedAt" | "completedAt"> & {
  _id: mongoose.Types.ObjectId;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

function toRecord(doc: JobDoc): JobRecord {
  return {
    id: doc._id.toString(),
    clerkUserId: doc.clerkUserId,
    projectId: doc.projectId,
    runId: doc.runId,
    sceneNumber: doc.sceneNumber,
    jobType: doc.jobType,
    provider: doc.provider,
    model: doc.model,
    input: doc.input ?? {},
    output: doc.output ?? null,
    status: doc.status,
    progress: doc.progress,
    attempts: doc.attempts,
    maxAttempts: doc.maxAttempts,
    error: doc.error,
    idempotencyKey: doc.idempotencyKey,
    bullJobId: doc.bullJobId,
    startedAt: doc.startedAt ? new Date(doc.startedAt).toISOString() : null,
    completedAt: doc.completedAt ? new Date(doc.completedAt).toISOString() : null,
  };
}

async function model() {
  return generationJobModel(await connectDB());
}

export const generationJobRepository = {
  async insert(input: Omit<JobRecord, "id">): Promise<JobRecord> {
    const Job = await model();
    try {
      const doc = await Job.create(input);
      return toRecord(doc.toObject() as unknown as JobDoc);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        const existing = await Job.findOne({ idempotencyKey: input.idempotencyKey }).lean<JobDoc | null>();
        if (existing) return toRecord(existing);
      }
      throw error;
    }
  },

  async findOwned(clerkUserId: string, id: string): Promise<JobRecord | null> {
    const Job = await model();
    const doc = await Job.findOne(ownedQuery(clerkUserId, id)).lean<JobDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findById(id: string): Promise<JobRecord | null> {
    const Job = await model();
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await Job.findById(id).lean<JobDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async listForRun(runId: string): Promise<JobRecord[]> {
    const Job = await model();
    const docs = await Job.find({ runId }).sort({ createdAt: 1 }).lean<JobDoc[]>();
    return docs.map(toRecord);
  },

  async listOpen(): Promise<JobRecord[]> {
    const Job = await model();
    const docs = await Job.find({ status: { $in: ["queued", "processing"] } }).lean<JobDoc[]>();
    return docs.map(toRecord);
  },

  async listByKeyPrefix(prefix: string): Promise<JobRecord[]> {
    const Job = await model();
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const docs = await Job.find({
      $or: [{ idempotencyKey: prefix }, { idempotencyKey: new RegExp(`^${escaped}:`) }],
    }).lean<JobDoc[]>();
    return docs.map(toRecord);
  },

  async save(job: JobRecord): Promise<JobRecord> {
    const Job = await model();
    const doc = await Job.findByIdAndUpdate(
      job.id,
      {
        status: job.status,
        output: job.output,
        progress: job.progress,
        attempts: job.attempts,
        error: job.error,
        bullJobId: job.bullJobId,
        startedAt: job.startedAt ? new Date(job.startedAt) : null,
        completedAt: job.completedAt ? new Date(job.completedAt) : null,
      },
      { new: true }
    ).lean<JobDoc | null>();
    if (!doc) throw new Error("Generation job not found");
    return toRecord(doc);
  },
};
