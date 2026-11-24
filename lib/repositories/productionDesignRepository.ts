import { connectDB } from "@/lib/db/connect";
import { productionDesignModel } from "@/lib/models/productionDesign";
import { isObjectId } from "@/lib/repositories/ownership";
import type { ProductionDesignInput, ProductionDesignRecord, ProductionDesignStatus } from "@/lib/validation/productionDesign";

type DesignDoc = Record<string, unknown>;

function toRecord(doc: DesignDoc): ProductionDesignRecord {
  return {
    id: String(doc._id),
    clerkUserId: String(doc.clerkUserId),
    projectId: String(doc.projectId),
    sceneId: String(doc.sceneId),
    version: doc.version as number,
    status: doc.status as ProductionDesignStatus,
    shotList: doc.shotList as ProductionDesignRecord["shotList"],
    locationDesign: doc.locationDesign as ProductionDesignRecord["locationDesign"],
    characterStaging: doc.characterStaging as ProductionDesignRecord["characterStaging"],
    createdAt: (doc.createdAt as Date).toISOString(),
    updatedAt: (doc.updatedAt as Date).toISOString(),
  };
}

export const productionDesignRepository = {
  async findByScene(clerkUserId: string, sceneId: string): Promise<ProductionDesignRecord | null> {
    if (!isObjectId(sceneId)) return null;
    const conn = await connectDB();
    const Design = productionDesignModel(conn);
    const doc = await Design.findOne({ clerkUserId, sceneId }).sort({ version: -1 }).lean<DesignDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async create(clerkUserId: string, projectId: string, sceneId: string, data: ProductionDesignInput): Promise<ProductionDesignRecord> {
    const conn = await connectDB();
    const Design = productionDesignModel(conn);
    const latest = await Design.findOne({ clerkUserId, sceneId }).sort({ version: -1 }).lean<DesignDoc | null>();
    const version = (latest?.version as number | undefined ?? 0) + 1;
    const doc = await Design.create({ clerkUserId, projectId, sceneId, version, status: "draft", ...data });
    return toRecord(doc.toObject() as DesignDoc);
  },

  async update(clerkUserId: string, designId: string, data: Partial<ProductionDesignInput>): Promise<ProductionDesignRecord | null> {
    const conn = await connectDB();
    const Design = productionDesignModel(conn);
    const doc = await Design.findOneAndUpdate(
      { clerkUserId, _id: designId, status: { $in: ["draft", "rejected"] } },
      { $set: data },
      { new: true, runValidators: true }
    ).lean<DesignDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async approve(clerkUserId: string, designId: string, expectedVersion: number): Promise<ProductionDesignRecord | null> {
    const conn = await connectDB();
    const Design = productionDesignModel(conn);
    const doc = await Design.findOneAndUpdate(
      { clerkUserId, _id: designId, version: expectedVersion, status: "draft" },
      { $set: { status: "approved" } },
      { new: true }
    ).lean<DesignDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async listForProject(clerkUserId: string, projectId: string): Promise<ProductionDesignRecord[]> {
    if (!isObjectId(projectId)) return [];
    const conn = await connectDB();
    const Design = productionDesignModel(conn);
    const docs = await Design.find({ clerkUserId, projectId }).sort({ sceneId: 1, version: -1 }).lean<DesignDoc[]>();
    return docs.map(toRecord);
  },
};