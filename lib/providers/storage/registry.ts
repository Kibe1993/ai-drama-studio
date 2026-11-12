import { createLocalStorageProvider } from "@/lib/providers/storage/local";
import type { StorageProvider } from "@/lib/providers/storage/types";

export function createStorageProvider(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const provider = env.MEDIA_STORAGE_PROVIDER?.trim().toLowerCase();
  if (provider === "local") {
    return createLocalStorageProvider(env.MEDIA_LOCAL_STORAGE_DIR?.trim() || undefined);
  }
  if (provider === "s3" || provider === "cloudinary") {
    throw new Error(`${provider}_storage_adapter_not_implemented`);
  }
  throw new Error("MEDIA_STORAGE_PROVIDER must explicitly be set to an implemented storage adapter");
}
