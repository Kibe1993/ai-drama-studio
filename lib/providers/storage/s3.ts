import "server-only";
import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { StorageProvider, StoredObject, StoredObjectInfo } from "@/lib/providers/storage/types";

type S3Config = {
  endpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateKey(key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\")) throw new Error("invalid_storage_key");
  const parts = key.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error("invalid_storage_key");
  }
  return key;
}

export function createS3StorageProvider(config: S3Config): StorageProvider {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
  });

  return {
    id: "s3",

    async put({ key, bytes, contentType }): Promise<StoredObject> {
      if (bytes.byteLength === 0) throw new Error("empty_media_file");
      const safeKey = validateKey(key);
      const contentHash = hash(bytes);
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: safeKey,
        Body: bytes,
        ContentType: contentType,
        ChecksumSHA256: Buffer.from(contentHash, "hex").toString("base64"),
      }));
      return { key: safeKey, byteSize: bytes.byteLength, sha256: contentHash, contentType };
    },

    async get(key): Promise<Uint8Array> {
      const safeKey = validateKey(key);
      const response = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: safeKey,
      }));
      if (!response.Body) throw new Error("storage_object_not_found");
      const chunks: Uint8Array[] = [];
      const reader = (response.Body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    },

    async openRead(key): Promise<ReadableStream<Uint8Array>> {
      const safeKey = validateKey(key);
      const response = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: safeKey,
      }));
      if (!response.Body) throw new Error("storage_object_not_found");
      return response.Body as ReadableStream<Uint8Array>;
    },

    async stat(key): Promise<{ byteSize: number } | null> {
      const safeKey = validateKey(key);
      try {
        const response = await client.send(new HeadObjectCommand({
          Bucket: config.bucket,
          Key: safeKey,
        }));
        return { byteSize: response.ContentLength ?? 0 };
      } catch (error) {
        if (error && typeof error === "object" && "name" in error && error.name === "NotFound") return null;
        if (error && typeof error === "object" && "$metadata" in error && (error as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404) return null;
        throw error;
      }
    },

    async head(key): Promise<StoredObject | null> {
      const safeKey = validateKey(key);
      try {
        const response = await client.send(new HeadObjectCommand({
          Bucket: config.bucket,
          Key: safeKey,
        }));
        return {
          key: safeKey,
          byteSize: response.ContentLength ?? 0,
          sha256: "",
          contentType: response.ContentType ?? "application/octet-stream",
        };
      } catch (error) {
        if (error && typeof error === "object" && "name" in error && error.name === "NotFound") return null;
        if (error && typeof error === "object" && "$metadata" in error && (error as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404) return null;
        throw error;
      }
    },

    async delete(key): Promise<void> {
      const safeKey = validateKey(key);
      await client.send(new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: safeKey,
      }));
    },

    async list(prefix): Promise<StoredObjectInfo[]> {
      const results: StoredObjectInfo[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await client.send(new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: prefix || undefined,
          ContinuationToken: continuationToken,
        }));
        for (const obj of response.Contents ?? []) {
          if (obj.Key && obj.LastModified) {
            results.push({
              key: obj.Key,
              byteSize: obj.Size ?? 0,
              lastModified: obj.LastModified,
            });
          }
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return results;
    },
  };
}

export function createS3StorageProviderFromEnv(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const bucket = env.S3_BUCKET?.trim();
  const region = env.S3_REGION?.trim();
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("s3_storage_not_configured: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY required");
  }
  return createS3StorageProvider({
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  });
}