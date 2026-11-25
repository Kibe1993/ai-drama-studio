import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { comfyUIService } from "@/lib/services/comfyUIService";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const [workflows, models] = await Promise.all([
      comfyUIService.getWorkflows(actor.userId).catch(() => []),
      comfyUIService.listModels(actor.userId).catch(() => ({ checkpoints: [], loras: [] })),
    ]);
    return jsonData({ workflows, models });
  });
}