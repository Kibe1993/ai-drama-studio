import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { projectMemoryModel, type ProjectMemoryShape } from "@/lib/models/projectMemory";
import { ownedQuery } from "@/lib/repositories/ownership";

type ProjectMemoryDoc = ProjectMemoryShape & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectMemoryCategory = "identity" | "story" | "development" | "technical";
export type ProjectMemorySource = "user_decision" | "assistant_proposal" | "mcp_result" | "canon" | "correction";
export type ProjectMemoryStatus = "confirmed" | "proposed" | "rejected" | "superseded";

export type ProjectMemoryRecord = {
  id: string;
  projectId: string;
  category: ProjectMemoryCategory;
  key: string;
  value: string;
  source: ProjectMemorySource;
  status: ProjectMemoryStatus;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
};

function toRecord(doc: ProjectMemoryDoc): ProjectMemoryRecord {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    category: doc.category as ProjectMemoryCategory,
    key: doc.key,
    value: doc.value,
    source: doc.source as ProjectMemorySource,
    status: doc.status as ProjectMemoryStatus,
    conversationId: doc.conversationId?.toString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function model() {
  const connection = await connectDB();
  return projectMemoryModel(connection);
}

export const projectMemoryRepository = {
  async listByProject(
    clerkUserId: string,
    projectId: string,
    category?: ProjectMemoryCategory,
  ): Promise<ProjectMemoryRecord[]> {
    const ProjectMemory = await model();
    const filter: Record<string, unknown> = {
      ...ownedQuery(clerkUserId),
      projectId: new mongoose.Types.ObjectId(projectId),
    };
    if (category) filter.category = category;
    const docs = await ProjectMemory.find(filter).sort({ updatedAt: -1 }).lean<ProjectMemoryDoc[]>();
    return docs.map(toRecord);
  },

  async listConfirmed(
    clerkUserId: string,
    projectId: string,
  ): Promise<ProjectMemoryRecord[]> {
    const ProjectMemory = await model();
    const docs = await ProjectMemory.find({
      ...ownedQuery(clerkUserId),
      projectId: new mongoose.Types.ObjectId(projectId),
      status: "confirmed",
    }).sort({ updatedAt: -1 }).lean<ProjectMemoryDoc[]>();
    return docs.map(toRecord);
  },

  async find(
    clerkUserId: string,
    projectId: string,
    category: ProjectMemoryCategory,
    key: string,
  ): Promise<ProjectMemoryRecord | null> {
    const ProjectMemory = await model();
    const doc = await ProjectMemory.findOne({
      ...ownedQuery(clerkUserId),
      projectId: new mongoose.Types.ObjectId(projectId),
      category,
      key,
      status: { $in: ["confirmed", "proposed"] },
    }).lean<ProjectMemoryDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async create(
    clerkUserId: string,
    input: {
      projectId: string;
      category: ProjectMemoryCategory;
      key: string;
      value: string;
      source: ProjectMemorySource;
      status?: ProjectMemoryStatus;
      conversationId?: string | null;
    },
  ): Promise<ProjectMemoryRecord> {
    const ProjectMemory = await model();
    const doc = await ProjectMemory.create({
      clerkUserId,
      projectId: new mongoose.Types.ObjectId(input.projectId),
      category: input.category,
      key: input.key,
      value: input.value,
      source: input.source,
      status: input.status ?? "proposed",
      conversationId: input.conversationId ? new mongoose.Types.ObjectId(input.conversationId) : null,
    });
    return toRecord(doc as unknown as ProjectMemoryDoc);
  },

  async updateStatus(
    clerkUserId: string,
    id: string,
    status: ProjectMemoryStatus,
  ): Promise<void> {
    const ProjectMemory = await model();
    await ProjectMemory.updateOne(
      { ...ownedQuery(clerkUserId), _id: new mongoose.Types.ObjectId(id) },
      { $set: { status } },
    );
  },

  async supersede(
    clerkUserId: string,
    projectId: string,
    category: ProjectMemoryCategory,
    key: string,
    newValue: string,
    source: ProjectMemorySource,
  ): Promise<ProjectMemoryRecord> {
    const ProjectMemory = await model();
    await ProjectMemory.updateMany(
      {
        ...ownedQuery(clerkUserId),
        projectId: new mongoose.Types.ObjectId(projectId),
        category,
        key,
        status: { $in: ["confirmed", "proposed"] },
      },
      { $set: { status: "superseded" } },
    );
    return this.create(clerkUserId, {
      projectId,
      category,
      key,
      value: newValue,
      source,
      status: "proposed",
    });
  },

  async search(
    clerkUserId: string,
    projectId: string,
    query: string,
    limit = 10,
  ): Promise<ProjectMemoryRecord[]> {
    const ProjectMemory = await model();
    const docs = await ProjectMemory.find(
      {
        ...ownedQuery(clerkUserId),
        projectId: new mongoose.Types.ObjectId(projectId),
        $text: { $search: query },
      },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean<ProjectMemoryDoc[]>();
    return docs.map(toRecord);
  },

  async remove(clerkUserId: string, id: string): Promise<void> {
    const ProjectMemory = await model();
    await ProjectMemory.deleteOne({ ...ownedQuery(clerkUserId), _id: new mongoose.Types.ObjectId(id) });
  },
};