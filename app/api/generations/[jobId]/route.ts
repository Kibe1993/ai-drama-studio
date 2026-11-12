import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import { generationJobRepository } from "@/lib/repositories/generationJobRepository";

type Context = { params: Promise<{ jobId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { jobId } = await context.params;
    if (!isObjectId(jobId)) throw new StudioError("That job id is not valid", 400, "invalid_id");
    const job = await generationJobRepository.findOwned(actor.userId, jobId);
    if (!job) throw new StudioError("Job not found", 404, "not_found");
    return jsonData({ job });
  });
}
