import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData, toErrorResponse } from "@/lib/http/errors";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createMediaAssetService } from "@/lib/services/mediaAssetService";

type Context = { params: Promise<{ projectId: string; assetId: string }> };

function safeInlineName(name: string): string {
  return name.replace(/[\r\n"\\/]/g, "_").replace(/[^\x20-\x7E]/g, "_").slice(0, 120) || "media";
}

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, assetId } = await context.params;
    const service = createMediaAssetService(createStorageProvider(), mediaAssetRepository);
    const { asset, body } = await service.openOwned(actor.userId, projectId, assetId);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.byteSize),
        "Content-Disposition": `inline; filename="${safeInlineName(asset.fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export function DELETE(request: Request, context: Context) {
  return logged(request, async () => {
    try {
      const actor = await readActor();
      const { projectId, assetId } = await context.params;
      const service = createMediaAssetService(createStorageProvider(), mediaAssetRepository);
      const deleted = await service.deleteOwned(actor.userId, projectId, assetId);
      return jsonData({ deleted: true, id: deleted.id });
    } catch (error) {
      return toErrorResponse(error);
    }
  });
}
