import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { storyBibleGenerationService } from "@/lib/services/storyBibleGenerationService";
import { storyBibleSectionRequestSchema } from "@/lib/validation/storyBible";
import { isStoryBibleSection } from "@/lib/providers/llm/storyBibleTask";

type Context = { params: Promise<{ projectId: string; section: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = storyBibleSectionRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", "Check the section regeneration request.");
    const { projectId, section } = await context.params;
    if (!isStoryBibleSection(section)) return errorResponse(404, "not_found", "That Story Bible section does not exist.");
    return jsonData(await storyBibleGenerationService.start(actor, projectId, { ...parsed.data, section, operation: "section" }), 202);
  });
}
