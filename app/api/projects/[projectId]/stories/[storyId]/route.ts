import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData } from "@/lib/http/errors";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { createPipelineService } from "@/lib/services/pipelineService";

type Context = { params: Promise<{ projectId: string; storyId: string }> };

/** Save a creator's manual screenplay edit and revalidate it against canon. */
export function PATCH(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId, storyId } = await context.params;
    return jsonData(
      await createPipelineService(livePipelineDeps()).updateStory(
        actor,
        projectId,
        storyId,
        await readJson(request)
      )
    );
  });
}
