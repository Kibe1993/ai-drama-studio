import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { toolConfigService } from "@/lib/services/toolConfigService";

export function POST(request: Request, ctx: { params: Promise<{ toolId: string }> }) {
  return logged(request, async () => {
    const actor = await readActor();
    const { toolId } = await ctx.params;
    return jsonData(await toolConfigService.runHealthCheck(actor.userId, toolId));
  });
}