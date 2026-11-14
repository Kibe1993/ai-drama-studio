import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { costEventRepository } from "@/lib/repositories/costEventRepository";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const totalCents = await costEventRepository.sumByProject(actor.userId, projectId);
    return jsonData({
      totalCostCents: totalCents,
      totalCostDollars: totalCents / 100,
    });
  });
}