import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createVisualAssetService } from "@/lib/services/visualAssetService";

type Context = { params: Promise<{ projectId: string; entityId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { entityId } = await context.params;
    const service = createVisualAssetService(createStorageProvider());
    const result = await service.approveEntity(actor, entityId);
    return jsonData(result);
  });
}