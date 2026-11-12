import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { createPipelineService } from "@/lib/services/pipelineService";

type Context = { params: Promise<{ projectId: string; storyId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`story-approve:${actor.userId}`);
    const { projectId, storyId } = await context.params;
    log.info("pipeline", "approve story", { projectId, storyId });
    const result = await createPipelineService(livePipelineDeps()).approveStory(actor, projectId, storyId);
    return jsonData(result);
  });
}
