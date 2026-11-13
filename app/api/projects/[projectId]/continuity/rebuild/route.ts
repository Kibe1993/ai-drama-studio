import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, StudioError } from "@/lib/http/errors";
import { continuityService } from "@/lib/services/continuityService";

type Context = { params: Promise<{ projectId: string }> };

const requestSchema = z
  .object({
    dryRun: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .default({});

/**
 * Rebuild continuity from approved episodes only. Used when a season was
 * produced before the Continuity Ledger existed. `dryRun` previews the result
 * without writing.
 */
export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const { projectId } = await context.params;
    const parsed = requestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new StudioError("Check the rebuild request", 400, "invalid_input");
    const result = await continuityService.rebuild(actor, projectId, parsed.data);
    return jsonData(result);
  });
}
