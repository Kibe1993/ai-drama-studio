import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { toolConfigService } from "@/lib/services/toolConfigService";

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    return jsonData(await toolConfigService.runHealthCheckAll(actor.userId));
  });
}