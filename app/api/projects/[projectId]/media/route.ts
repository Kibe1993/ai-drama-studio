import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createMediaAssetService } from "@/lib/services/mediaAssetService";
import { MEDIA_ASSET_TYPES, MEDIA_REVIEW_STATUSES } from "@/lib/validation/mediaAsset";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const reviewStatus = url.searchParams.get("reviewStatus");
    const episodeId = url.searchParams.get("episodeId");
    const sceneId = url.searchParams.get("sceneId");
    const isMockParam = url.searchParams.get("isMock");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100") || 100, 500);
    const offset = parseInt(url.searchParams.get("offset") ?? "0") || 0;

    const filters: Record<string, unknown> = {};
    if (type && MEDIA_ASSET_TYPES.includes(type as never)) filters.type = type;
    if (reviewStatus && MEDIA_REVIEW_STATUSES.includes(reviewStatus as never)) filters.reviewStatus = reviewStatus;
    if (episodeId && /^[a-f\d]{24}$/i.test(episodeId)) filters.episodeId = episodeId;
    if (sceneId && /^[a-f\d]{24}$/i.test(sceneId)) filters.sceneId = sceneId;
    if (isMockParam === "true") filters.isMock = true;
    if (isMockParam === "false") filters.isMock = false;

    const service = createMediaAssetService(createStorageProvider(), mediaAssetRepository);
    const assets = await service.listFiltered(actor.userId, projectId, filters, limit, offset);
    const total = await mediaAssetRepository.count(actor.userId, projectId, filters);

    return jsonData({
      assets: assets.map((asset) => ({
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
        frameRate: asset.frameRate,
        episodeId: asset.episodeId,
        sceneId: asset.sceneId,
        shotId: asset.shotId,
        storageProvider: asset.storageProvider,
        validationStatus: asset.validationStatus,
        storageVerified: asset.storageVerified,
        reviewStatus: asset.reviewStatus,
        isMock: asset.isMock,
        canonicalEntityId: asset.canonicalEntityId,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      })),
      total,
      limit,
      offset,
    });
  });
}
