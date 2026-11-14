import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createShotProductionService } from "@/lib/services/shotProductionService";

type Context = { params: Promise<{ projectId: string; sceneId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { sceneId } = await context.params;
    const service = createShotProductionService();
    const records = await service.listByScene(actor, sceneId);
    const eligible = records.filter((r) => r.productionStatus === "failed" || r.productionStatus === "pending");
    return jsonData({
      retriable: eligible.map((r) => ({ id: r.id, shotNumber: r.shotNumber, productionStatus: r.productionStatus })),
    });
  });
}