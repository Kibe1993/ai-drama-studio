import { loadEnvConfig } from "@next/env";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createMediaAssetService } from "@/lib/services/mediaAssetService";

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const hoursArg = args.find((argument) => argument.startsWith("--older-than-hours="));
  const hours = hoursArg ? Number(hoursArg.split("=")[1]) : 24;
  if (!Number.isFinite(hours) || hours < 24) {
    throw new Error("--older-than-hours must be at least 24");
  }
  const service = createMediaAssetService(createStorageProvider(), mediaAssetRepository);
  const result = await service.auditOrphans({ olderThanMs: hours * 60 * 60 * 1000, apply });
  const bytes = result.candidates.reduce((sum, file) => sum + file.byteSize, 0);
  console.log(`[media] orphan audit mode=${result.dryRun ? "dry-run" : "deleted"} count=${result.candidates.length} bytes=${bytes}`);
  for (const file of result.candidates) {
    console.log(`[media] orphan key=${file.key} bytes=${file.byteSize} modified=${file.lastModified.toISOString()}`);
  }
}

main().catch((error: unknown) => {
  console.error(`[media] orphan audit failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
