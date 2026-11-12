import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { projectService } from "@/lib/services/projectService";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const summary = await projectService.summary(actor);
    return jsonData(summary);
  });
}
