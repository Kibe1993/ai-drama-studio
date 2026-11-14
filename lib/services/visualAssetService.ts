import "server-only";
import { StudioError } from "@/lib/http/errors";
import { canonicalEntityRepository } from "@/lib/repositories/canonicalEntityRepository";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import type { MediaAssetRecord } from "@/lib/validation/mediaAsset";
import type { StorageProvider } from "@/lib/providers/storage/types";
import { createMediaAssetService } from "@/lib/services/mediaAssetService";

export type ReferenceKind = "character" | "environment" | "object";


function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new StudioError("Resource not found", 404, "not_found");
  }
}

export function createVisualAssetService(storage: StorageProvider) {
  const mediaService = createMediaAssetService(storage, mediaAssetRepository);

  return {
    async listEntities(actor: { userId: string }, projectId: string, entityType?: "character" | "location" | "object") {
      if (!(await canonicalEntityRepository.ownsProject(actor.userId, projectId))) {
        throw new StudioError("Project not found", 404, "not_found");
      }
      return canonicalEntityRepository.listByProject(actor.userId, projectId, entityType);
    },

    async findEntity(actor: { userId: string }, entityId: string) {
      const entity = await canonicalEntityRepository.findOwned(actor.userId, entityId);
      if (!entity) throw new StudioError("Entity not found", 404, "not_found");
      return entity;
    },

    async createObjectProfile(
      actor: { userId: string },
      projectId: string,
      input: { name: string; description?: string; visualProfile?: Record<string, unknown> }
    ) {
      if (!(await canonicalEntityRepository.ownsProject(actor.userId, projectId))) {
        throw new StudioError("Project not found", 404, "not_found");
      }
      const normalizedName = input.name.trim().toLowerCase().replace(/\s+/g, "_");
      return canonicalEntityRepository.create(actor.userId, {
        projectId,
        entityType: "object",
        name: input.name.trim(),
        normalizedName,
        description: input.description,
        visualProfile: input.visualProfile,
      });
    },

    async uploadReference(
      actor: { userId: string },
      projectId: string,
      canonicalEntityId: string,
      rawInput: unknown,
      bytes: Uint8Array
    ): Promise<MediaAssetRecord> {
      assertObjectId(canonicalEntityId);
      const entity = await canonicalEntityRepository.findOwned(actor.userId, canonicalEntityId);
      if (!entity || entity.projectId !== projectId) {
        throw new StudioError("Entity not found", 404, "not_found");
      }
      const assetType = entity.entityType === "character" ? "character_reference" : "character_reference";
      const enrichedInput = typeof rawInput === "object" && rawInput !== null
        ? { ...(rawInput as Record<string, unknown>), canonicalEntityId, type: assetType }
        : rawInput;
      return mediaService.storeVerified(actor.userId, enrichedInput, bytes);
    },

    async approveReference(actor: { userId: string }, assetId: string): Promise<MediaAssetRecord> {
      assertObjectId(assetId);
      const asset = await mediaAssetRepository.findOwned(actor.userId, assetId);
      if (!asset) throw new StudioError("Asset not found", 404, "not_found");
      if (asset.reviewStatus === "archived") {
        throw new StudioError("Cannot approve an archived asset", 409, "asset_archived");
      }

      const updated = await mediaAssetRepository.updateReviewStatus(actor.userId, assetId, "approved");
      if (!updated) throw new StudioError("Asset not found", 404, "not_found");

      if (asset.canonicalEntityId) {
        const previousApproved = await mediaAssetRepository.findApprovedReference(
          actor.userId,
          asset.canonicalEntityId,
          asset.type
        );
        if (previousApproved && previousApproved.id !== assetId) {
          await mediaAssetRepository.setVersionChain(actor.userId, previousApproved.id, assetId);
        }
        await canonicalEntityRepository.setDefaultReference(actor.userId, asset.canonicalEntityId, assetId);
      }

      return updated;
    },

    async rejectReference(actor: { userId: string }, assetId: string): Promise<MediaAssetRecord> {
      assertObjectId(assetId);
      const asset = await mediaAssetRepository.findOwned(actor.userId, assetId);
      if (!asset) throw new StudioError("Asset not found", 404, "not_found");
      if (asset.reviewStatus === "approved") {
        throw new StudioError("Cannot reject an approved asset", 409, "asset_approved");
      }
      const updated = await mediaAssetRepository.updateReviewStatus(actor.userId, assetId, "rejected");
      if (!updated) throw new StudioError("Asset not found", 404, "not_found");
      return updated;
    },

    async listReferences(
      actor: { userId: string },
      canonicalEntityId: string,
      type?: MediaAssetRecord["type"]
    ): Promise<MediaAssetRecord[]> {
      assertObjectId(canonicalEntityId);
      return mediaAssetRepository.listByCanonicalEntity(actor.userId, canonicalEntityId, type);
    },

    async getApprovedReferences(
      actor: { userId: string },
      canonicalEntityId: string,
      type: MediaAssetRecord["type"]
    ): Promise<MediaAssetRecord | null> {
      assertObjectId(canonicalEntityId);
      return mediaAssetRepository.findApprovedReference(actor.userId, canonicalEntityId, type);
    },

    mediaService,
  };
}

export type VisualAssetService = ReturnType<typeof createVisualAssetService>;