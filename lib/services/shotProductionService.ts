import "server-only";
import { StudioError } from "@/lib/http/errors";
import { connectDB } from "@/lib/db/connect";
import { productionSceneModel } from "@/lib/models/productionScene";
import { productionSceneRepository } from "@/lib/repositories/productionSceneRepository";
import { shotProductionRepository } from "@/lib/repositories/shotProductionRepository";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { canonProvenance } from "@/lib/domain/narrativeControl/staleness";
import type { ShotProductionRecord } from "@/lib/validation/shotProduction";
import type { ProviderCapability } from "@/lib/providers/media/capability";
import type { ShotPlan } from "@/lib/validation/scene";


function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new StudioError("Resource not found", 404, "not_found");
  }
}

export function createShotProductionService() {
  return {
    async verifyGates(actor: { userId: string }, sceneId: string): Promise<void> {
      assertObjectId(sceneId);
      const Scene = productionSceneModel(await connectDB());
      const scene = await Scene.findOne({ clerkUserId: actor.userId, _id: sceneId })
        .lean<{ shotPlan: ShotPlan[]; approvedAt: Date | null } | null>();
      if (!scene) throw new StudioError("Scene not found", 404, "not_found");
      if (!scene.approvedAt || scene.shotPlan.length === 0) {
        throw new StudioError("Shot plan must be approved before production", 409, "gates_not_met");
      }
    },

    async approveShotPlan(actor: { userId: string }, sceneId: string, shotPlan?: ShotPlan[]): Promise<{ id: string; approvedAt: string; shotPlanLength: number }> {
      assertObjectId(sceneId);
      const existing = await productionSceneRepository.findById(actor.userId, sceneId);
      if (!existing) throw new StudioError("Scene not found", 404, "not_found");
      const planToSet = shotPlan ?? existing.shotPlan;
      if (!planToSet || planToSet.length === 0) {
        throw new StudioError("Cannot approve an empty shot plan", 409, "empty_shot_plan");
      }
      const updated = await productionSceneRepository.approveShotPlan(actor.userId, sceneId, shotPlan);
      if (!updated) throw new StudioError("Scene not found", 404, "not_found");
      return { id: updated.id, approvedAt: updated.approvedAt ?? new Date().toISOString(), shotPlanLength: (shotPlan ?? existing.shotPlan).length };
    },

    async setShotPlan(actor: { userId: string }, sceneId: string, shotPlan: ShotPlan[]): Promise<{ id: string; shotPlanLength: number }> {
      assertObjectId(sceneId);
      if (shotPlan.length === 0) {
        throw new StudioError("Cannot set an empty shot plan", 409, "empty_shot_plan");
      }
      const Scene = productionSceneModel(await connectDB());
      const doc = await Scene.findOneAndUpdate(
        { clerkUserId: actor.userId, _id: sceneId },
        { $set: { shotPlan } },
        { new: true, runValidators: true }
      ).lean<{ _id: import("mongoose").Types.ObjectId; shotPlan: ShotPlan[] } | null>();
      if (!doc) throw new StudioError("Scene not found", 404, "not_found");
      return { id: doc._id.toString(), shotPlanLength: doc.shotPlan.length };
    },

    async createRecordsFromPlan(actor: { userId: string }, sceneId: string): Promise<ShotProductionRecord[]> {
      assertObjectId(sceneId);
      const Scene = productionSceneModel(await connectDB());
      const scene = await Scene.findOne({ clerkUserId: actor.userId, _id: sceneId })
        .lean<{
          _id: import("mongoose").Types.ObjectId;
          projectId: import("mongoose").Types.ObjectId;
          shotPlan: ShotPlan[];
          approvedAt: Date | null;
        } | null>();
      if (!scene) throw new StudioError("Scene not found", 404, "not_found");
      if (!scene.approvedAt) throw new StudioError("Shot plan not approved", 409, "gates_not_met");

      const existing = await shotProductionRepository.findByScene(actor.userId, sceneId);
      if (existing.length > 0) return existing;
      const provenance = canonProvenance(await narrativeCanonRepository.latest(actor.userId, scene.projectId.toString()).then((state) => state?.version ?? null));

      const records: ShotProductionRecord[] = [];
      for (const shot of scene.shotPlan) {
        const record = await shotProductionRepository.create(actor.userId, {
          projectId: scene.projectId.toString(),
          productionSceneId: sceneId,
          shotNumber: shot.shotNumber,
          productionStatus: "pending",
          generationContext: {
            prompt: "",
            referenceAssetIds: [],
            provider: "",
            model: "",
            settings: {},
          },
          resultingAssetIds: [],
          segments: [],
          adjustedDurationSeconds: null,
          validationInfo: {},
          idempotencyKey: `shot:${scene.projectId.toString()}:${sceneId}:${shot.shotNumber}`,
          ...provenance,
        });
        records.push(record);
      }
      return records;
    },

    async listByScene(actor: { userId: string }, sceneId: string): Promise<ShotProductionRecord[]> {
      assertObjectId(sceneId);
      return shotProductionRepository.findByScene(actor.userId, sceneId);
    },

    async findRecord(actor: { userId: string }, recordId: string): Promise<ShotProductionRecord> {
      assertObjectId(recordId);
      const record = await shotProductionRepository.findOwned(actor.userId, recordId);
      if (!record) throw new StudioError("Shot record not found", 404, "not_found");
      return record;
    },

    async evaluateSceneCompletion(actor: { userId: string }, sceneId: string): Promise<"pending" | "in_progress" | "complete"> {
      assertObjectId(sceneId);
      const records = await shotProductionRepository.findByScene(actor.userId, sceneId);
      if (records.length === 0) return "pending";
      const allCompleted = records.every((r) => r.productionStatus === "completed");
      if (allCompleted) {
        const Scene = productionSceneModel(await connectDB());
        await Scene.updateOne({ clerkUserId: actor.userId, _id: sceneId }, { productionStatus: "complete" });
        return "complete";
      }
      const anyStarted = records.some((r) => r.productionStatus === "in_progress" || r.productionStatus === "completed");
      const status = anyStarted ? "in_progress" : "pending";
      const Scene = productionSceneModel(await connectDB());
      await Scene.updateOne({ clerkUserId: actor.userId, _id: sceneId }, { productionStatus: status });
      return status;
    },

    planDurationSegments(
      shotDurationSeconds: number,
      providerCapability: ProviderCapability
    ): { segments: { segmentNumber: number; durationSeconds: number }[]; adjusted: boolean } {
      const max = providerCapability.maxClipDurationSeconds;
      if (max <= 0 || shotDurationSeconds <= max) {
        return { segments: [{ segmentNumber: 1, durationSeconds: shotDurationSeconds }], adjusted: false };
      }
      const segmentCount = Math.ceil(shotDurationSeconds / max);
      const perSegment = shotDurationSeconds / segmentCount;
      const segments = Array.from({ length: segmentCount }, (_, i) => ({
        segmentNumber: i + 1,
        durationSeconds: perSegment,
      }));
      return { segments, adjusted: true };
    },

    async markShotInProgress(actor: { userId: string }, recordId: string): Promise<void> {
      assertObjectId(recordId);
      await shotProductionRepository.updateStatus(actor.userId, recordId, "in_progress");
    },

    async markShotCompleted(
      actor: { userId: string },
      recordId: string,
      resultingAssetIds: string[]
    ): Promise<ShotProductionRecord | null> {
      assertObjectId(recordId);
      return shotProductionRepository.updateStatus(actor.userId, recordId, "completed", { resultingAssetIds });
    },

    async markShotFailed(
      actor: { userId: string },
      recordId: string,
      validationInfo?: Record<string, unknown>
    ): Promise<ShotProductionRecord | null> {
      assertObjectId(recordId);
      return shotProductionRepository.updateStatus(actor.userId, recordId, "failed", { validationInfo });
    },
  };
}

export type ShotProductionService = ReturnType<typeof createShotProductionService>;