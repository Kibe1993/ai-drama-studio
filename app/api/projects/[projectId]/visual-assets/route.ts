import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createVisualAssetService } from "@/lib/services/visualAssetService";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const service = createVisualAssetService(createStorageProvider());
    const [characters, environments, objects] = await Promise.all([
      service.listEntities(actor, projectId, "character"),
      service.listEntities(actor, projectId, "location"),
      service.listEntities(actor, projectId, "object"),
    ]);
    return jsonData({ characters, environments, objects });
  });
}