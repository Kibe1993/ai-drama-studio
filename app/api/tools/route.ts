import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { toolConfigService } from "@/lib/services/toolConfigService";
import { toolConfigSchema } from "@/lib/validation/toolConfig";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    return jsonData(await toolConfigService.list(actor.userId));
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = toolConfigSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    return jsonData(await toolConfigService.create(actor.userId, parsed.data), 201);
  });
}