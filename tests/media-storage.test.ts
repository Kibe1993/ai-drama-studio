import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { utimes } from "node:fs/promises";
import path from "node:path";
import { createLocalStorageProvider } from "@/lib/providers/storage/local";
import { createMediaAssetService } from "@/lib/services/mediaAssetService";
import { validateMediaBytes, type MediaAssetRecord } from "@/lib/validation/mediaAsset";

const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7qkAAAAASUVORK5CYII=", "base64"));
const projectId = "a".repeat(24);
const userId = "clerk-user";
const directories: string[] = [];

async function newDirectory() {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-media-test-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function assetInput() {
  return {
    projectId,
    episodeId: null,
    sceneId: null,
    generationJobId: "b".repeat(24),
    type: "scene_image" as const,
    provider: "fixture",
    model: "fixture-image",
    idempotencyKey: "job-scene-image-v1",
    mimeType: "image/png",
    fileName: "scene.png",
  };
}

function writer() {
  const rows = new Map<string, MediaAssetRecord>();
  return {
    rows,
    async ownsProject() { return true; },
    async findOwned(clerkUserId: string, assetId: string) {
      return [...rows.values()].find((row) => row.clerkUserId === clerkUserId && row.id === assetId) ?? null;
    },
    async listProject(clerkUserId: string, id: string) {
      return [...rows.values()].filter((row) => row.clerkUserId === clerkUserId && row.projectId === id);
    },
    async listStorageKeys(provider: MediaAssetRecord["storageProvider"]) {
      return [...rows.values()].filter((row) => row.storageProvider === provider).map((row) => row.storageKey);
    },
    async createVerified(clerkUserId: string, input: Omit<MediaAssetRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt" | "reviewStatus">) {
      const existing = rows.get(input.idempotencyKey);
      if (existing) return existing;
      const now = new Date().toISOString();
      const record = { ...input, id: "c".repeat(24), clerkUserId, reviewStatus: "pending" as const, createdAt: now, updatedAt: now } as MediaAssetRecord;
      rows.set(input.idempotencyKey, record);
      return record;
    },
  };
}

describe("media asset storage foundation", () => {
  it("rejects empty, mismatched, and corrupt media bytes", () => {
    expect(() => validateMediaBytes(new Uint8Array(), "image/png", "scene_image")).toThrow("empty_media_file");
    expect(() => validateMediaBytes(png, "video/mp4", "scene_video")).toThrow("media_signature_mismatch");
    expect(() => validateMediaBytes(new Uint8Array([1, 2, 3, 4]), "image/png", "scene_image")).toThrow("media_signature_mismatch");
  });

  it("stores bytes, verifies the object hash, and records signature-verified metadata once per retry key", async () => {
    const storage = createLocalStorageProvider(await newDirectory());
    const assets = writer();
    const service = createMediaAssetService(storage, assets);
    const [first, retry] = await Promise.all([
      service.storeVerified(userId, assetInput(), png),
      service.storeVerified(userId, assetInput(), png),
    ]);
    expect(first.id).toBe(retry.id);
    expect(first.storageProvider).toBe("local");
    expect(first.storageVerified).toBe(true);
    expect(first.validationStatus).toBe("signature_verified");
    expect(first.width).toBe(1);
    expect(first.height).toBe(1);
    expect(assets.rows.size).toBe(1);
    const downloaded = await storage.get(first.storageKey);
    expect(Buffer.from(downloaded)).toEqual(Buffer.from(png));
  });

  it("rejects storage keys that escape the configured local root", async () => {
    const storage = createLocalStorageProvider(await newDirectory());
    await expect(storage.get("../outside.bin")).rejects.toThrow("invalid_storage_key");
  });

  it("does not upload when project ownership fails", async () => {
    const storage = createLocalStorageProvider(await newDirectory());
    let puts = 0;
    const writerPort = writer();
    const service = createMediaAssetService({
      ...storage,
      async put(input) { puts += 1; return storage.put(input); },
    }, {
      ...writerPort,
      async ownsProject() { return false; },
    });
    await expect(service.storeVerified(userId, assetInput(), png)).rejects.toMatchObject({ code: "not_found" });
    expect(puts).toBe(0);
  });

  it("streams media only to its owning user and project", async () => {
    const storage = createLocalStorageProvider(await newDirectory());
    const assets = writer();
    const service = createMediaAssetService(storage, assets);
    const asset = await service.storeVerified(userId, assetInput(), png);
    const opened = await service.openOwned(userId, projectId, asset.id);
    expect(Buffer.from(await new Response(opened.body).arrayBuffer())).toEqual(Buffer.from(png));
    await expect(service.openOwned("someone-else", projectId, asset.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.openOwned(userId, "f".repeat(24), asset.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("audits orphan files in dry-run mode and deletes only after explicit apply", async () => {
    const storage = createLocalStorageProvider(await newDirectory());
    const assets = writer();
    const service = createMediaAssetService(storage, assets);
    const key = "studio/old/orphan.png";
    await storage.put({ key, bytes: png, contentType: "image/png" });
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(path.join((directories.at(-1) as string), ...key.split("/")), old, old);
    const dryRun = await service.auditOrphans({ olderThanMs: 24 * 60 * 60 * 1000 });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.candidates.map((item) => item.key)).toContain(key);
    expect(await storage.stat(key)).toMatchObject({ byteSize: png.byteLength });
    const applied = await service.auditOrphans({ olderThanMs: 24 * 60 * 60 * 1000, apply: true });
    expect(applied.dryRun).toBe(false);
    expect(await storage.stat(key)).toBeNull();
  });
});
