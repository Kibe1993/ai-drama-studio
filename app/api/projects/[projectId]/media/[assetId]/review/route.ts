import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createVisualAssetService } from "@/lib/services/visualAssetService";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

type Context = { params: Promise<{ projectId: string; assetId: string }> };

export function PATCH(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { assetId } = await context.params;
    const body = reviewSchema.parse(await readJson(request));
    const service = createVisualAssetService(createStorageProvider());
    const asset = body.action === "approve"
      ? await service.approveReference(actor, assetId)
      : await service.rejectReference(actor, assetId);
    return jsonData({
      asset: {
        id: asset.id,
        reviewStatus: asset.reviewStatus,
        previousVersionId: asset.previousVersionId ?? null,
        replacedById: asset.replacedById ?? null,
      },
    });
  });
}