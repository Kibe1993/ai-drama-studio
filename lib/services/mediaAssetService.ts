import "server-only";
import { createHash } from "node:crypto";
import { StudioError } from "@/lib/http/errors";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import type { StorageProvider } from "@/lib/providers/storage/types";
import { createMediaAssetSchema, validateMediaBytes, type CreateMediaAssetInput, type MediaAssetRecord } from "@/lib/validation/mediaAsset";

type AssetWriter = Pick<typeof mediaAssetRepository, "createVerified" | "ownsProject" | "findOwned" | "listProject" | "listStorageKeys" | "delete" | "listFiltered" | "count">;

function extension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "video/mp4": "mp4", "video/webm": "webm", "audio/wav": "wav",
    "audio/mpeg": "mp3", "text/vtt": "vtt", "application/x-subrip": "srt",
  };
  return map[mimeType] ?? "bin";
}

function safeFileName(value: string): string {
  const base = value.replace(/[\\/]/g, "_").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return base.slice(0, 120) || "media";
}

function storageKey(userId: string, input: CreateMediaAssetInput, sha256: string, mimeType: string): string {
  const userHash = createHash("sha256").update(userId).digest("hex").slice(0, 16);
  const token = createHash("sha256").update(input.idempotencyKey).digest("hex");
  return `studio/${userHash}/${input.projectId}/${input.type}/${token}.${extension(mimeType)}`;
}

export function createMediaAssetService(storage: StorageProvider, assets: AssetWriter) {
  return {
    async storeVerified(clerkUserId: string, rawInput: unknown, bytes: Uint8Array): Promise<MediaAssetRecord> {
      const parsed = createMediaAssetSchema.safeParse(rawInput);
      if (!parsed.success) throw new StudioError(parsed.error.issues[0]?.message ?? "Invalid media metadata", 400, "invalid_media");
      if (!clerkUserId) throw new StudioError("Sign in to continue", 401, "unauthorized");
      const input = parsed.data;
      if (!(await assets.ownsProject(clerkUserId, input.projectId))) {
        throw new StudioError("Project not found", 404, "not_found");
      }
      let checked;
      try {
        checked = validateMediaBytes(bytes, input.mimeType, input.type);
      } catch (error) {
        const code = error instanceof Error ? error.message : "invalid_media_file";
        throw new StudioError("The media file failed content validation", 422, code);
      }
      const key = storageKey(clerkUserId, input, checked.sha256, checked.mimeType);
      let stored;
      try {
        stored = await storage.put({ key, bytes, contentType: checked.mimeType });
        if (stored.key !== key || stored.byteSize !== checked.byteSize || stored.sha256 !== checked.sha256) {
          throw new Error("storage_put_mismatch");
        }
        const head = await storage.head(key);
        if (!head || head.byteSize !== checked.byteSize || head.sha256 !== checked.sha256) {
          throw new Error("stored_object_mismatch");
        }
      } catch {
        throw new StudioError("Media storage could not verify the uploaded file", 503, "storage_verification_failed");
      }
      const asset = await assets.createVerified(clerkUserId, {
        ...input,
        fileName: safeFileName(input.fileName),
        mimeType: checked.mimeType,
        storageProvider: storage.id,
        storageKey: key,
        byteSize: checked.byteSize,
        sha256: checked.sha256,
        validationStatus: checked.validationStatus,
        storageVerified: true,
        width: checked.width ?? input.width,
        height: checked.height ?? input.height,
        isMock: false,
      });
      if (!asset) throw new StudioError("Project not found", 404, "not_found");
      return asset;
    },

    async openOwned(clerkUserId: string, projectId: string, assetId: string) {
      if (!/^[a-f\d]{24}$/i.test(projectId) || !/^[a-f\d]{24}$/i.test(assetId)) {
        throw new StudioError("Media asset not found", 404, "not_found");
      }
      const asset = await assets.findOwned(clerkUserId, assetId);
      if (!asset || asset.projectId !== projectId || asset.storageProvider !== storage.id || !asset.storageVerified) {
        throw new StudioError("Media asset not found", 404, "not_found");
      }
      const stored = await storage.stat(asset.storageKey);
      if (!stored || stored.byteSize !== asset.byteSize) {
        throw new StudioError("Stored media is unavailable or incomplete", 404, "media_missing");
      }
      return { asset, body: await storage.openRead(asset.storageKey) };
    },

    async listOwned(clerkUserId: string, projectId: string) {
      if (!/^[a-f\d]{24}$/i.test(projectId)) throw new StudioError("Project not found", 404, "not_found");
      const rows = await assets.listProject(clerkUserId, projectId);
      if (!rows) throw new StudioError("Project not found", 404, "not_found");
      return rows;
    },

    async listFiltered(
      clerkUserId: string,
      projectId: string,
      filters: {
        type?: MediaAssetRecord["type"];
        reviewStatus?: MediaAssetRecord["reviewStatus"];
        episodeId?: string;
        sceneId?: string;
        isMock?: boolean;
      },
      limit: number = 100,
      offset: number = 0
    ) {
      if (!/^[a-f\d]{24}$/i.test(projectId)) throw new StudioError("Project not found", 404, "not_found");
      const rows = await assets.listFiltered(clerkUserId, projectId, filters, limit, offset);
      if (!rows) throw new StudioError("Project not found", 404, "not_found");
      return rows;
    },

    async deleteOwned(clerkUserId: string, projectId: string, assetId: string): Promise<MediaAssetRecord> {
      if (!/^[a-f\d]{24}$/i.test(projectId) || !/^[a-f\d]{24}$/i.test(assetId)) {
        throw new StudioError("Media asset not found", 404, "not_found");
      }
      const asset = await assets.findOwned(clerkUserId, assetId);
      if (!asset || asset.projectId !== projectId) {
        throw new StudioError("Media asset not found", 404, "not_found");
      }
      try {
        await storage.delete(asset.storageKey);
      } catch {
        // Storage object may already be gone; proceed to delete DB record
      }
      const deleted = await assets.delete(clerkUserId, assetId);
      if (!deleted) throw new StudioError("Media asset not found", 404, "not_found");
      return deleted;
    },

    async auditOrphans(options: { olderThanMs: number; apply?: boolean }) {
      if (!Number.isFinite(options.olderThanMs) || options.olderThanMs < 24 * 60 * 60 * 1000) {
        throw new Error("orphan_retention_must_be_at_least_24_hours");
      }
      const [objects, keys] = await Promise.all([
        storage.list("studio/"),
        assets.listStorageKeys(storage.id),
      ]);
      const known = new Set(keys);
      const cutoff = Date.now() - options.olderThanMs;
      const orphaned = objects.filter((object) => !known.has(object.key) && object.lastModified.getTime() <= cutoff);
      if (options.apply === true) {
        for (const object of orphaned) await storage.delete(object.key);
      }
      return { dryRun: options.apply !== true, candidates: orphaned.map(({ key, byteSize, lastModified }) => ({ key, byteSize, lastModified })) };
    },
  };
}

