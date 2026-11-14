import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createVisualAssetService } from "@/lib/services/visualAssetService";

type Context = { params: Promise<{ projectId: string; entityId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { entityId } = await context.params;
    const service = createVisualAssetService(createStorageProvider());
    const references = await service.listReferences(actor, entityId, "character_reference");
    return jsonData({
      references: references.map((asset) => ({
        id: asset.id,
        type: asset.type,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
        reviewStatus: asset.reviewStatus,
        createdAt: asset.createdAt,
      })),
    });
  });
}