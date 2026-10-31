import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { projectModel, type ProjectShape } from "@/lib/models/project";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import { ownedQuery } from "@/lib/repositories/ownership";
import type { ListCursor } from "@/lib/repositories/cursor";

export type ProjectRecord = {
  id: string;
  title: string;
  originalStoryIdea: string;
  genre: ProjectShape["genre"];
  language: ProjectShape["language"];
  visualStyle: ProjectShape["visualStyle"];
  tone: string;
  targetDurationSeconds: number;
  aspectRatio: ProjectShape["aspectRatio"];
  status: ProjectStatus;
  workflowMode: ProjectShape["workflowMode"];
  createdAt: string;
  updatedAt: string;
};

export type ProjectWrite = {
  clerkUserId: string;
  title: string;
  originalStoryIdea: string;
  genre: ProjectShape["genre"];
  language: ProjectShape["language"];
  visualStyle: ProjectShape["visualStyle"];
  tone: string;
  targetDurationSeconds: number;
  aspectRatio: ProjectShape["aspectRatio"];
  status: ProjectStatus;
  workflowMode: ProjectShape["workflowMode"];
  idempotencyKey?: string | null;
};

type ProjectDoc = ProjectShape & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: ProjectDoc): ProjectRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    originalStoryIdea: doc.originalStoryIdea ?? "",
    genre: doc.genre,
    language: doc.language,
    visualStyle: doc.visualStyle,
    tone: doc.tone,
    targetDurationSeconds: doc.targetDurationSeconds,
    aspectRatio: doc.aspectRatio,
    status: doc.status,
    workflowMode: doc.workflowMode,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function model() {
  const connection = await connectDB();
  return projectModel(connection);
}

export const projectRepository = {
  async list(
    clerkUserId: string,
    cursor: ListCursor | null,
    limit: number,
    status?: ProjectStatus
  ): Promise<ProjectRecord[]> {
    const Project = await model();
    const filter: Record<string, unknown> = ownedQuery(clerkUserId);
    if (status) filter.status = status;
    if (cursor) {
      const updatedAt = new Date(cursor.updatedAt);
      filter.$or = [
        { updatedAt: { $lt: updatedAt } },
        { updatedAt, _id: { $lt: cursor.id } },
      ];
    }
    const docs = await Project.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit)
      .lean<ProjectDoc[]>();
    return docs.map(toRecord);
  },

  async counts(clerkUserId: string): Promise<Partial<Record<ProjectStatus, number>>> {
    const Project = await model();
    const rows = await Project.aggregate<{ _id: ProjectStatus; count: number }>([
      { $match: ownedQuery(clerkUserId) },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  },

  async findOwned(clerkUserId: string, id: string): Promise<ProjectRecord | null> {
    const Project = await model();
    const doc = await Project.findOne(ownedQuery(clerkUserId, id)).lean<ProjectDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findByIdempotency(
    clerkUserId: string,
    idempotencyKey: string
  ): Promise<ProjectRecord | null> {
    const Project = await model();
    const doc = await Project.findOne({
      ...ownedQuery(clerkUserId),
      idempotencyKey,
    }).lean<ProjectDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async insert(input: ProjectWrite): Promise<ProjectRecord> {
    const Project = await model();
    try {
      const doc = await Project.create(input);
      return toRecord(doc.toObject() as unknown as ProjectDoc);
    } catch (error) {
      if (
        input.idempotencyKey &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      ) {
        const existing = await this.findByIdempotency(input.clerkUserId, input.idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }
  },

  async update(
    clerkUserId: string,
    id: string,
    patch: Partial<ProjectWrite>
  ): Promise<ProjectRecord | null> {
    const Project = await model();
    const doc = await Project.findOneAndUpdate(ownedQuery(clerkUserId, id), patch, {
      new: true,
    }).lean<ProjectDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async remove(clerkUserId: string, id: string): Promise<boolean> {
    const Project = await model();
    const result = await Project.deleteOne(ownedQuery(clerkUserId, id));
    return result.deletedCount === 1;
  },
};
