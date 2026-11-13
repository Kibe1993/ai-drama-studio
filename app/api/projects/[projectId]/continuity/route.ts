import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { continuityService } from "@/lib/services/continuityService";

type Context = { params: Promise<{ projectId: string }> };

/**
 * Established canon plus the developments an unapproved episode draft proposes.
 * The two are returned separately: proposals never become canon on their own.
 */
export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    return jsonData(await continuityService.get(actor, projectId));
  });
}
