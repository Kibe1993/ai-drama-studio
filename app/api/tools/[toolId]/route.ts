import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { toolConfigService } from "@/lib/services/toolConfigService";
import { toolConfigUpdateSchema } from "@/lib/validation/toolConfig";

export function GET(request: Request, ctx: { params: Promise<{ toolId: string }> }) {
  return logged(request, async () => {
    const actor = await readActor();
    const { toolId } = await ctx.params;
    return jsonData(await toolConfigService.findById(actor.userId, toolId));
  });
}

export function PATCH(request: Request, ctx: { params: Promise<{ toolId: string }> }) {
  return logged(request, async () => {
    const actor = await readActor();
    const { toolId } = await ctx.params;
    const parsed = toolConfigUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    return jsonData(await toolConfigService.update(actor.userId, toolId, parsed.data));
  });
}

export function DELETE(request: Request, ctx: { params: Promise<{ toolId: string }> }) {
  return logged(request, async () => {
    const actor = await readActor();
    const { toolId } = await ctx.params;
    await toolConfigService.remove(actor.userId, toolId);
    return jsonData({ ok: true });
  });
}