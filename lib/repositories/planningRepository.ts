import { connectDB } from "@/lib/db/connect";
import { planningDocumentModel } from "@/lib/models/planningDocument";
import { isObjectId } from "@/lib/repositories/ownership";
import type { PlanningDocumentInput, PlanningDocumentRecord, PlanningStatus } from "@/lib/validation/planning";

type PlanningDoc = Record<string, unknown>;

function toRecord(doc: PlanningDoc): PlanningDocumentRecord {
  return {
    id: String(doc._id),
    clerkUserId: String(doc.clerkUserId),
    projectId: String(doc.projectId),
    version: doc.version as number,
    status: doc.status as PlanningStatus,
    rejectionReason: (doc.rejectionReason as string | null) ?? null,
    concept: doc.concept as PlanningDocumentRecord["concept"],
    themes: doc.themes as string[],
    centralQuestion: doc.centralQuestion as string,
    mainConflict: doc.mainConflict as string,
    audience: doc.audience as PlanningDocumentRecord["audience"],
    narrativeDirection: doc.narrativeDirection as PlanningDocumentRecord["narrativeDirection"],
    alternativeDirections: doc.alternativeDirections as PlanningDocumentRecord["alternativeDirections"],
    references: doc.references as PlanningDocumentRecord["references"],
    createdAt: (doc.createdAt as Date).toISOString(),
    updatedAt: (doc.updatedAt as Date).toISOString(),
  };
}

export const planningRepository = {
  async findLatest(clerkUserId: string, projectId: string): Promise<PlanningDocumentRecord | null> {
    if (!isObjectId(projectId)) return null;
    const conn = await connectDB();
    const Planning = planningDocumentModel(conn);
    const doc = await Planning.findOne({ clerkUserId, projectId }).sort({ version: -1 }).lean<PlanningDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findApproved(clerkUserId: string, projectId: string): Promise<PlanningDocumentRecord | null> {
    if (!isObjectId(projectId)) return null;
    const conn = await connectDB();
    const Planning = planningDocumentModel(conn);
    const doc = await Planning.findOne({ clerkUserId, projectId, status: "approved" }).sort({ version: -1 }).lean<PlanningDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async create(clerkUserId: string, projectId: string, data: PlanningDocumentInput): Promise<PlanningDocumentRecord> {
    const conn = await connectDB();
    const Planning = planningDocumentModel(conn);
    const latest = await Planning.findOne({ clerkUserId, projectId }).sort({ version: -1 }).lean<PlanningDoc | null>();
    const version = (latest?.version as number | undefined ?? 0) + 1;
    const doc = await Planning.create({ clerkUserId, projectId, version, status: "draft", ...data });
    return toRecord(doc.toObject() as PlanningDoc);
  },

  async update(clerkUserId: string, planningId: string, data: Partial<PlanningDocumentInput>): Promise<PlanningDocumentRecord | null> {
    const conn = await connectDB();
    const Planning = planningDocumentModel(conn);
    const doc = await Planning.findOneAndUpdate(
      { clerkUserId, _id: planningId, status: { $in: ["draft", "rejected"] } },
      { $set: data },
      { new: true, runValidators: true }
    ).lean<PlanningDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async submit(clerkUserId: string, planningId: string): Promise<PlanningDocumentRecord | null> {
    const conn = await connectDB();
    const Planning = planningDocumentModel(conn);
    const doc = await Planning.findOneAndUpdate(
      { clerkUserId, _id: planningId, status: { $in: ["draft", "rejected"] } },
      { $set: { status: "submitted" } },
      { new: true }
    ).lean<PlanningDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async approve(clerkUserId: string, planningId: string, expectedVersion: number): Promise<PlanningDocumentRecord | null> {
    const conn = await connectDB();
    const Planning = planningDocumentModel(conn);
    const doc = await Planning.findOneAndUpdate(
      { clerkUserId, _id: planningId, version: expectedVersion, status: "submitted" },
      { $set: { status: "approved", rejectionReason: null } },
      { new: true }
    ).lean<PlanningDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async reject(clerkUserId: string, planningId: string, expectedVersion: number, reason: string): Promise<PlanningDocumentRecord | null> {
    const conn = await connectDB();
    const Planning = planningDocumentModel(conn);
    const doc = await Planning.findOneAndUpdate(
      { clerkUserId, _id: planningId, version: expectedVersion, status: "submitted" },
      { $set: { status: "rejected", rejectionReason: reason } },
      { new: true }
    ).lean<PlanningDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async listVersions(clerkUserId: string, projectId: string): Promise<PlanningDocumentRecord[]> {
    if (!isObjectId(projectId)) return [];
    const conn = await connectDB();
    const Planning = planningDocumentModel(conn);
    const docs = await Planning.find({ clerkUserId, projectId }).sort({ version: -1 }).lean<PlanningDoc[]>();
    return docs.map(toRecord);
  },
};