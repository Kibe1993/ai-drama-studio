import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { productionSceneModel } from "@/lib/models/productionScene";
import type { SceneItem, RunRecord } from "@/lib/pipeline/types";
import type { SceneEdit, SceneRecord } from "@/lib/validation/scene";

type SceneDoc = SceneRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  productionRunId: mongoose.Types.ObjectId;
  episodeId?: mongoose.Types.ObjectId | null;
  storyId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: SceneDoc): SceneRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    productionRunId: doc.productionRunId.toString(),
    episodeId: doc.episodeId?.toString() ?? null,
    storyId: doc.storyId.toString(),
    videoAssetId: doc.videoAssetId?.toString() ?? null,
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt).toISOString() : null,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

async function model() {
  return productionSceneModel(await connectDB());
}

export const productionSceneRepository = {
  async listForRun(clerkUserId: string, runId: string): Promise<SceneRecord[]> {
    const Scene = await model();
    const docs = await Scene.find({ clerkUserId, productionRunId: runId })
      .sort({ sceneNumber: 1 }).lean<SceneDoc[]>();
    return docs.map(toRecord);
  },

  async persistBreakdown(clerkUserId: string, run: RunRecord, storyId: string, scenes: SceneItem[]): Promise<SceneRecord[]> {
    const Scene = await model();
    for (const scene of scenes) {
      await Scene.updateOne(
        { clerkUserId, productionRunId: run.id, sceneNumber: scene.sceneNumber },
        { $setOnInsert: {
          clerkUserId,
          projectId: run.projectId,
          productionRunId: run.id,
          episodeId: run.episode?.id ?? null,
          storyId,
          ...scene,
          shotPlan: [],
        },
        $set: {
          sourceCanonVersion: run.stageResults.story?.sourceCanonVersion ?? null,
          canonStale: false,
          canonStaleReason: "",
        } },
        { upsert: true, runValidators: true }
      );
    }
    return this.listForRun(clerkUserId, run.id);
  },

  async create(clerkUserId: string, projectId: string, runId: string, storyId: string, sceneNumber: number, input: SceneEdit): Promise<SceneRecord> {
    const Scene = await model();
    const doc = await Scene.create({
      clerkUserId,
      projectId,
      productionRunId: runId,
      storyId,
      sceneNumber,
      ...input,
      shotPlan: input.shotPlan ?? [],
      videoReady: false,
      videoStatus: "pending",
      videoAssetId: null,
      failed: false,
      productionStatus: "pending",
      approvedAt: null,
      sourceCanonVersion: null,
      canonStale: false,
      canonStaleReason: "",
    });
    return toRecord(doc.toObject() as unknown as SceneDoc);
  },

  async updateOwned(clerkUserId: string, projectId: string, runId: string, sceneNumber: number, input: SceneEdit): Promise<SceneRecord | null> {
    const Scene = await model();
    const doc = await Scene.findOneAndUpdate(
      { clerkUserId, projectId, productionRunId: runId, sceneNumber },
      { $set: input },
      { new: true, runValidators: true }
    ).lean<SceneDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findById(clerkUserId: string, sceneId: string): Promise<SceneRecord | null> {
    const Scene = await model();
    const doc = await Scene.findOne({ clerkUserId, _id: sceneId }).lean<SceneDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async approveShotPlan(clerkUserId: string, sceneId: string, shotPlan?: SceneEdit["shotPlan"]): Promise<SceneRecord | null> {
    const Scene = await model();
    const setFields: Record<string, unknown> = { approvedAt: new Date() };
    if (shotPlan) {
      setFields.shotPlan = shotPlan;
    }
    const doc = await Scene.findOneAndUpdate(
      { clerkUserId, _id: sceneId },
      { $set: setFields },
      { new: true, runValidators: true }
    ).lean<SceneDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};
