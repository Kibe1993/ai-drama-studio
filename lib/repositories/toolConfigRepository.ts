import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { externalToolConfigModel } from "@/lib/models/externalToolConfig";
import type { ToolConfigRecord, ToolConfigInput, ToolConfigUpdate, ToolStatus } from "@/lib/validation/toolConfig";
import type { HealthCheckResult } from "@/lib/validation/toolConfig";

type ToolDoc = ToolConfigRecord & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  lastHealthCheck?: Date | null;
};

function toRecord(doc: ToolDoc): ToolConfigRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    lastHealthCheck: doc.lastHealthCheck ? new Date(doc.lastHealthCheck).toISOString() : undefined,
  };
}

async function model() {
  const connection = await connectDB();
  return externalToolConfigModel(connection);
}

export const toolConfigRepository = {
  async list(userId: string): Promise<ToolConfigRecord[]> {
    const Tool = await model();
    const docs = await Tool.find({ clerkUserId: userId }).sort({ toolType: 1 }).lean<ToolDoc[]>();
    return docs.map(toRecord);
  },

  async listByCategory(userId: string, category: string): Promise<ToolConfigRecord[]> {
    const Tool = await model();
    const docs = await Tool.find({ clerkUserId: userId, category }).sort({ toolType: 1 }).lean<ToolDoc[]>();
    return docs.map(toRecord);
  },

  async listEnabled(userId: string): Promise<ToolConfigRecord[]> {
    const Tool = await model();
    const docs = await Tool.find({ clerkUserId: userId, enabled: true }).sort({ toolType: 1 }).lean<ToolDoc[]>();
    return docs.map(toRecord);
  },

  async findByToolType(userId: string, toolType: string): Promise<ToolConfigRecord | null> {
    const Tool = await model();
    const doc = await Tool.findOne({ clerkUserId: userId, toolType }).lean<ToolDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findById(userId: string, id: string): Promise<ToolConfigRecord | null> {
    const Tool = await model();
    const doc = await Tool.findOne({ clerkUserId: userId, _id: id }).lean<ToolDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async create(userId: string, input: ToolConfigInput): Promise<ToolConfigRecord> {
    const Tool = await model();
    try {
      const created = await Tool.create({ ...input, clerkUserId: userId });
      return toRecord(created.toObject() as unknown as ToolDoc);
    } catch (error) {
      if (error instanceof Error && error.message.includes("E11000")) {
        throw new Error("tool_config_already_exists");
      }
      throw error;
    }
  },

  async update(userId: string, id: string, input: ToolConfigUpdate): Promise<ToolConfigRecord | null> {
    const Tool = await model();
    const updated = await Tool.findOneAndUpdate(
      { clerkUserId: userId, _id: id },
      { $set: input },
      { new: true }
    ).lean<ToolDoc | null>();
    return updated ? toRecord(updated) : null;
  },

  async updateStatus(userId: string, id: string, status: ToolStatus): Promise<ToolConfigRecord | null> {
    const Tool = await model();
    const updated = await Tool.findOneAndUpdate(
      { clerkUserId: userId, _id: id },
      { $set: { status } },
      { new: true }
    ).lean<ToolDoc | null>();
    return updated ? toRecord(updated) : null;
  },

  async updateHealthCheck(
    userId: string,
    id: string,
    result: HealthCheckResult,
    status: ToolStatus
  ): Promise<ToolConfigRecord | null> {
    const Tool = await model();
    const updated = await Tool.findOneAndUpdate(
      { clerkUserId: userId, _id: id },
      {
        $set: {
          status,
          lastHealthCheck: new Date(result.checkedAt),
          lastHealthCheckResult: result,
        },
      },
      { new: true }
    ).lean<ToolDoc | null>();
    return updated ? toRecord(updated) : null;
  },

  async remove(userId: string, id: string): Promise<boolean> {
    const Tool = await model();
    const result = await Tool.deleteOne({ clerkUserId: userId, _id: id });
    return result.deletedCount > 0;
  },

  async ensureDefaults(userId: string): Promise<void> {
    const Tool = await model();
    const { TOOL_TYPES, TOOL_DISPLAY_NAMES, TOOL_CATEGORY_MAP } = await import("@/lib/validation/toolConfig");
    const existing = await Tool.find({ clerkUserId: userId }).lean<{ toolType: string }[]>();
    const existingTypes = new Set(existing.map((d) => d.toolType));
    const toCreate = TOOL_TYPES.filter((t) => !existingTypes.has(t));
    if (toCreate.length === 0) return;
    await Tool.insertMany(
      toCreate.map((toolType) => ({
        clerkUserId: userId,
        toolType,
        displayName: TOOL_DISPLAY_NAMES[toolType],
        category: TOOL_CATEGORY_MAP[toolType],
        enabled: false,
        config: {},
        status: "not_installed",
      }))
    );
  },
};