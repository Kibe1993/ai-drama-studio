import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createMediaAssetService } from "@/lib/services/mediaAssetService";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const service = createMediaAssetService(createStorageProvider(), mediaAssetRepository);
    const assets = await service.listOwned(actor.userId, projectId);
    return jsonData({ assets: assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      provider: asset.provider,
      model: asset.model,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
      byteSize: asset.byteSize,
      durationSeconds: asset.durationSeconds,
      width: asset.width,
      height: asset.height,
      validationStatus: asset.validationStatus,
      reviewStatus: asset.reviewStatus,
      createdAt: asset.createdAt,
    })) });
  });
}
