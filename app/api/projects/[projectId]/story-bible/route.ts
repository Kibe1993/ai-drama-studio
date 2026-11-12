import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { storyBibleApprovalSchema, storyBibleDraftSchema } from "@/lib/validation/storyBible";
import { storyBibleService } from "@/lib/services/storyBibleService";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    return jsonData({ bible: await storyBibleService.get(actor, projectId) });
  });
}

export function PATCH(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = storyBibleDraftSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the Story Bible");
    const { projectId } = await context.params;
    return jsonData({ bible: await storyBibleService.save(actor, projectId, parsed.data) });
  });
}

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = storyBibleApprovalSchema.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, "invalid_input", "Review the Story Bible version before approving it.");
    const { projectId } = await context.params;
    return jsonData({ bible: await storyBibleService.approve(actor, projectId, parsed.data.expectedVersion, parsed.data.expectedDraftRevision) });
  });
}
