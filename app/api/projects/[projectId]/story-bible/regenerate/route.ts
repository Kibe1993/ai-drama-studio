import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { storyBibleGenerationService } from "@/lib/services/storyBibleGenerationService";
import { storyBibleInputSchema } from "@/lib/validation/storyBible";
import { z } from "zod";

type Context = { params: Promise<{ projectId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = storyBibleInputSchema.extend({ freshInterpretation: z.boolean().optional() }).safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the regeneration request.");
    const { projectId } = await context.params;
    return jsonData(await storyBibleGenerationService.start(actor, projectId, { ...parsed.data, operation: "regenerate" }), 202);
  });
}
