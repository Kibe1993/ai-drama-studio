import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { canonicalEntityModel } from "@/lib/models/canonicalEntity";
import { projectModel } from "@/lib/models/project";

export type CanonicalEntityRecord = {
  id: string;
  clerkUserId: string;
  projectId: string;
  entityType: "character" | "location" | "object";
  normalizedName: string;
  name: string;
  profile: Record<string, unknown>;
  visualProfile: Record<string, unknown>;
  description: string;
  status: "pending_review" | "approved";
  defaultReferenceAssetId: string | null;
  voiceProfileId: string | null;
  createdAt: string;
  updatedAt: string;
};

type EntityDoc = CanonicalEntityRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  defaultReferenceAssetId?: mongoose.Types.ObjectId | null;
  voiceProfileId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: EntityDoc): CanonicalEntityRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    defaultReferenceAssetId: doc.defaultReferenceAssetId?.toString() ?? null,
    voiceProfileId: doc.voiceProfileId?.toString() ?? null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export const canonicalEntityRepository = {
  async ownsProject(clerkUserId: string, projectId: string): Promise<boolean> {
    const Project = projectModel(await connectDB());
    return Boolean(await Project.exists({ clerkUserId, _id: projectId }));
  },

  async findOwned(clerkUserId: string, entityId: string): Promise<CanonicalEntityRecord | null> {
    const Entity = canonicalEntityModel(await connectDB());
    const doc = await Entity.findOne({ clerkUserId, _id: entityId }).lean<EntityDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async listByProject(
    clerkUserId: string,
    projectId: string,
    entityType?: CanonicalEntityRecord["entityType"]
  ): Promise<CanonicalEntityRecord[]> {
    const Entity = canonicalEntityModel(await connectDB());
    const filter: Record<string, unknown> = { clerkUserId, projectId };
    if (entityType) filter.entityType = entityType;
    const docs = await Entity.find(filter).sort({ updatedAt: -1 }).lean<EntityDoc[]>();
    return docs.map(toRecord);
  },

  async create(
    clerkUserId: string,
    input: {
      projectId: string;
      entityType: CanonicalEntityRecord["entityType"];
      name: string;
      normalizedName: string;
      description?: string;
      visualProfile?: Record<string, unknown>;
    }
  ): Promise<CanonicalEntityRecord> {
    const Entity = canonicalEntityModel(await connectDB());
    const created = await Entity.create({
      clerkUserId,
      ...input,
      profile: {},
      visualProfile: input.visualProfile ?? {},
      description: input.description ?? "",
      status: "pending_review",
    });
    return toRecord(created.toObject() as unknown as EntityDoc);
  },

  async updateVisualProfile(
    clerkUserId: string,
    entityId: string,
    visualProfile: Record<string, unknown>
  ): Promise<CanonicalEntityRecord | null> {
    const Entity = canonicalEntityModel(await connectDB());
    const doc = await Entity.findOneAndUpdate(
      { clerkUserId, _id: entityId },
      { visualProfile },
      { new: true }
    ).lean<EntityDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async approve(clerkUserId: string, entityId: string): Promise<CanonicalEntityRecord | null> {
    const Entity = canonicalEntityModel(await connectDB());
    const doc = await Entity.findOneAndUpdate(
      { clerkUserId, _id: entityId },
      { status: "approved" },
      { new: true }
    ).lean<EntityDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async setDefaultReference(
    clerkUserId: string,
    entityId: string,
    assetId: string
  ): Promise<CanonicalEntityRecord | null> {
    const Entity = canonicalEntityModel(await connectDB());
    const doc = await Entity.findOneAndUpdate(
      { clerkUserId, _id: entityId },
      { defaultReferenceAssetId: assetId },
      { new: true }
    ).lean<EntityDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};