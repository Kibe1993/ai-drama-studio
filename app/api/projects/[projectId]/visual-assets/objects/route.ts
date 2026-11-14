import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createVisualAssetService } from "@/lib/services/visualAssetService";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const createObjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1200).optional(),
  visualProfile: z.record(z.string(), z.unknown()).optional(),
});

type Context = { params: Promise<{ projectId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const body = createObjectSchema.parse(await readJson(request));
    const service = createVisualAssetService(createStorageProvider());
    const entity = await service.createObjectProfile(actor, projectId, body);
    return jsonData({ entity }, 201);
  });
}

export { objectId };