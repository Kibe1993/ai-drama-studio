import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { storyDraftService } from "@/lib/services/storyDraftService";

type Context = { params: Promise<{ jobId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { jobId } = await context.params;
    return jsonData(await storyDraftService.cancel(actor, jobId));
  });
}