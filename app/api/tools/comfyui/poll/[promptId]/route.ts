import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { comfyUIService } from "@/lib/services/comfyUIService";

export function GET(request: Request, ctx: { params: Promise<{ promptId: string }> }) {
  return logged(request, async () => {
    const actor = await readActor();
    const { promptId } = await ctx.params;
    return jsonData(await comfyUIService.poll(actor.userId, promptId));
  });
}