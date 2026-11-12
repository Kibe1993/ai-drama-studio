import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { storyBibleGenerationService } from "@/lib/services/storyBibleGenerationService";
import { storyBibleInputSchema } from "@/lib/validation/storyBible";

type Context = { params: Promise<{ projectId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const body = await readJson(request);
    const parsed = storyBibleInputSchema.safeParse(body);
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Add a story idea.");
    const { projectId } = await context.params;
    return jsonData(await storyBibleGenerationService.start(actor, projectId, { ...parsed.data, operation: "generate" }), 202);
  });
}
