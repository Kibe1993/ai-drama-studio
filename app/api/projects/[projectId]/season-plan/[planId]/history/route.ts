import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, StudioError } from "@/lib/http/errors";
import { isObjectId } from "@/lib/repositories/ownership";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";

type Context = { params: Promise<{ projectId: string; planId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-read:${actor.userId}`);
    const { projectId, planId } = await context.params;
    if (!isObjectId(projectId) || !isObjectId(planId)) {
      throw new StudioError("Invalid id", 400, "invalid_id");
    }
    const versions = await seasonPlanRepository.listVersions(actor.userId, projectId);
    if (versions.length === 0) {
      throw new StudioError("Season plan not found", 404, "not_found");
    }
    const history = versions.map((v) => ({
      version: v.version,
      planId: v.id,
      status: v.status,
      createdAt: v.createdAt,
      revisionHistory: v.revisionHistory ?? [],
    }));
    return jsonData({
      projectId,
      planId,
      versions: history,
      totalVersions: versions.length,
    });
  });
}