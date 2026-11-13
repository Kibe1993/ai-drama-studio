import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData } from "@/lib/http/errors";
import { storyDraftService } from "@/lib/services/storyDraftService";

type Context = { params: Promise<{ projectId: string; storyId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId, storyId } = await context.params;
    return jsonData(await storyDraftService.approve(actor, projectId, storyId));
  });
}
