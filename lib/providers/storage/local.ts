import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import type { StorageProvider, StoredObject } from "@/lib/providers/storage/types";

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safePath(root: string, key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\")) throw new Error("invalid_storage_key");
  const parts = key.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error("invalid_storage_key");
  }
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, ...parts);
  if (!target.startsWith(`${rootPath}${path.sep}`)) throw new Error("invalid_storage_key");
  return target;
}

export function createLocalStorageProvider(root = path.resolve(process.cwd(), "storage", "media")): StorageProvider {
  async function walk(directory: string, relative = ""): Promise<{ key: string; info: Awaited<ReturnType<typeof stat>> }[]> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const output: { key: string; info: Awaited<ReturnType<typeof stat>> }[] = [];
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) output.push(...await walk(file, key));
      else if (entry.isFile()) output.push({ key, info: await stat(file) });
    }
    return output;
  }
  return {
    id: "local",
    async put({ key, bytes, contentType }): Promise<StoredObject> {
      if (bytes.byteLength === 0) throw new Error("empty_media_file");
      const target = safePath(root, key);
      await mkdir(path.dirname(target), { recursive: true });
      const contentHash = hash(bytes);
      try {
        await writeFile(target, bytes, { flag: "wx" });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
        const existing = await readFile(target);
        if (hash(existing) !== contentHash) throw new Error("storage_key_collision");
      }
      const saved = await readFile(target);
      if (saved.byteLength !== bytes.byteLength || hash(saved) !== contentHash) {
        throw new Error("storage_verification_failed");
      }
      return { key, byteSize: saved.byteLength, sha256: contentHash, contentType };
    },
    async get(key) {
      return new Uint8Array(await readFile(safePath(root, key)));
    },
    async openRead(key) {
      const target = safePath(root, key);
      await stat(target);
      return Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
    },
    async stat(key) {
      try {
        const info = await stat(safePath(root, key));
        return info.isFile() ? { byteSize: info.size } : null;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async head(key) {
      const target = safePath(root, key);
      try {
        const [info, bytes] = await Promise.all([stat(target), readFile(target)]);
        if (!info.isFile()) return null;
        return { key, byteSize: info.size, sha256: hash(bytes), contentType: "application/octet-stream" };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(safePath(root, key), { force: true });
    },
    async list(prefix) {
      if (prefix && (prefix.startsWith("/") || prefix.includes("\\") || prefix.split("/").some((part) => part === ".."))) {
        throw new Error("invalid_storage_prefix");
      }
      const all = await walk(path.resolve(root));
      return all.filter((entry) => entry.key.startsWith(prefix)).map((entry) => ({
        key: entry.key,
        byteSize: Number(entry.info.size),
        lastModified: entry.info.mtime,
      }));
    },
  };
}
