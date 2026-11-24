import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/repositories/mediaAssetRepository", () => ({
  mediaAssetRepository: {
    ownsProject: vi.fn(),
    createVerified: vi.fn(),
    findOwned: vi.fn(),
    listProject: vi.fn(),
    listStorageKeys: vi.fn(),
    updateReviewStatus: vi.fn(),
    setVersionChain: vi.fn(),
    listByCanonicalEntity: vi.fn(),
    findApprovedReference: vi.fn(),
    listFiltered: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
}));

import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { createMediaAssetService } from "@/lib/services/mediaAssetService";
import type { MediaAssetRecord } from "@/lib/validation/mediaAsset";

const PID = "b".repeat(24);
const AID = "a".repeat(24);

function makeAsset(overrides: Partial<MediaAssetRecord> = {}): MediaAssetRecord {
  return {
    id: AID,
    clerkUserId: "u1",
    projectId: PID,
    episodeId: null,
    sceneId: null,
    shotId: null,
    generationJobId: null,
    type: "scene_video",
    provider: "mock",
    model: "",
    idempotencyKey: "key1",
    storageProvider: "local",
    storageKey: "studio/asset.mp4",
    mimeType: "video/mp4",
    fileName: "asset.mp4",
    byteSize: 1000,
    sha256: "a".repeat(64),
    durationSeconds: 10,
    width: 1920,
    height: 1080,
    frameRate: 30,
    metadata: {},
    validationStatus: "signature_verified",
    storageVerified: true,
    reviewStatus: "pending",
    canonicalEntityId: null,
    previousVersionId: null,
    replacedById: null,
    isMock: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockStorage() {
  return {
    id: "local" as const,
    put: vi.fn(async () => ({ key: "k", byteSize: 1, sha256: "x", contentType: "video/mp4" })),
    get: vi.fn(async () => new Uint8Array()),
    openRead: vi.fn(async () => new ReadableStream()),
    stat: vi.fn(async () => ({ byteSize: 1 })),
    head: vi.fn(async () => ({ key: "k", byteSize: 1, sha256: "x", contentType: "video/mp4" })),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  };
}

describe("media asset service — list and delete", () => {
  const storage = mockStorage();
  const service = createMediaAssetService(storage, mediaAssetRepository);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listFiltered", () => {
    it("returns filtered assets", async () => {
      const assets = [makeAsset(), makeAsset({ id: "c".repeat(24), type: "dialogue_audio" })];
      vi.mocked(mediaAssetRepository.listFiltered).mockResolvedValue(assets as never);

      const result = await service.listFiltered("u1", PID, { type: "scene_video" }, 100, 0);
      expect(result).toHaveLength(2);
      expect(mediaAssetRepository.listFiltered).toHaveBeenCalledWith("u1", PID, { type: "scene_video" }, 100, 0);
    });

    it("throws on invalid project ID", async () => {
      await expect(service.listFiltered("u1", "invalid", {})).rejects.toThrow("Project not found");
    });

    it("throws when project not found", async () => {
      vi.mocked(mediaAssetRepository.listFiltered).mockResolvedValue(null as never);
      await expect(service.listFiltered("u1", PID, {})).rejects.toThrow("Project not found");
    });
  });

  describe("deleteOwned", () => {
    it("deletes asset from storage and database", async () => {
      const asset = makeAsset();
      vi.mocked(mediaAssetRepository.findOwned).mockResolvedValue(asset as never);
      vi.mocked(mediaAssetRepository.delete).mockResolvedValue(asset as never);

      const result = await service.deleteOwned("u1", PID, AID);
      expect(storage.delete).toHaveBeenCalledWith("studio/asset.mp4");
      expect(mediaAssetRepository.delete).toHaveBeenCalledWith("u1", AID);
      expect(result.id).toBe(AID);
    });

    it("throws when asset not found", async () => {
      vi.mocked(mediaAssetRepository.findOwned).mockResolvedValue(null);

      await expect(service.deleteOwned("u1", PID, AID)).rejects.toThrow("Media asset not found");
    });

    it("throws when asset belongs to different project", async () => {
      vi.mocked(mediaAssetRepository.findOwned).mockResolvedValue(
        makeAsset({ projectId: "d".repeat(24) }) as never
      );

      await expect(service.deleteOwned("u1", PID, AID)).rejects.toThrow("Media asset not found");
    });

    it("proceeds even if storage delete fails", async () => {
      const asset = makeAsset();
      vi.mocked(mediaAssetRepository.findOwned).mockResolvedValue(asset as never);
      vi.mocked(storage.delete).mockRejectedValue(new Error("storage gone"));
      vi.mocked(mediaAssetRepository.delete).mockResolvedValue(asset as never);

      const result = await service.deleteOwned("u1", PID, AID);
      expect(result.id).toBe(AID);
    });

    it("throws on invalid IDs", async () => {
      await expect(service.deleteOwned("u1", "invalid", AID)).rejects.toThrow("Media asset not found");
      await expect(service.deleteOwned("u1", PID, "invalid")).rejects.toThrow("Media asset not found");
    });
  });
});