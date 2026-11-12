import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { episodeInputSchema } from "@/lib/validation/episode";
import { episodeService } from "@/lib/services/episodeService";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    return jsonData({ episodes: await episodeService.list(actor, projectId) });
  });
}

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = episodeInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the episode details");
    const { projectId } = await context.params;
    return jsonData({ episode: await episodeService.create(actor, projectId, parsed.data) }, 201);
  });
}
