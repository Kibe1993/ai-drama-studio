import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { z } from "zod";
import { productionDesignService } from "@/lib/services/productionDesignService";

type Context = { params: Promise<{ projectId: string; sceneId: string }> };

const approveSchema = z.object({ expectedVersion: z.number().int().min(1) });

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = approveSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the approval details");
    const { projectId, sceneId } = await context.params;
    return jsonData({ design: await productionDesignService.approve(actor, projectId, sceneId, parsed.data.expectedVersion) });
  });
}