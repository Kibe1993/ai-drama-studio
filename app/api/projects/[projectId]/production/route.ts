import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { livePipelineDeps } from "@/lib/pipeline/live";
import { createPipelineService } from "@/lib/services/pipelineService";
import { productionActionSchema } from "@/lib/validation/production";

type Context = { params: Promise<{ projectId: string }> };

function service() {
  return createPipelineService(livePipelineDeps());
}

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    return jsonData(await service().get(actor, projectId));
  });
}

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`production:${actor.userId}`);
    const parsed = productionActionSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the request");
    }
    const { projectId } = await context.params;
    const pipeline = service();
    const action = parsed.data;
    log.info("pipeline", `api ${action.action}`, {
      projectId,
      sceneNumber: "sceneNumber" in action ? action.sceneNumber : "",
      workflowMode: "workflowMode" in action ? action.workflowMode : "",
    });
    if (action.action === "start") return jsonData(await pipeline.start(actor, projectId, action.workflowMode));
    if (action.action === "story") return jsonData(await pipeline.generateStory(actor, projectId));
    if (action.action === "approve") return jsonData(await pipeline.approve(actor, projectId));
    if (action.action === "scenes") return jsonData(await pipeline.generateScenes(actor, projectId));
    if (action.action === "retry") return jsonData(await pipeline.retry(actor, projectId));
    if (action.action === "retryScene") {
      return jsonData(await pipeline.retryScene(actor, projectId, action.sceneNumber));
    }
    return jsonData(await pipeline.cancel(actor, projectId));
  });
}
