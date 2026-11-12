import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { projectService } from "@/lib/services/projectService";
import { idempotencyKeySchema, projectInputSchema } from "@/lib/validation/project";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/domain/projectCatalog";

const statusSchema = z.enum(PROJECT_STATUSES);

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const url = new URL(request.url);
    const statusRaw = url.searchParams.get("status");
    let status: ProjectStatus | null = null;
    if (statusRaw) {
      const parsed = statusSchema.safeParse(statusRaw);
      if (!parsed.success) {
        return errorResponse(400, "invalid_status", "Unknown project status");
      }
      status = parsed.data;
    }
    const data = await projectService.list(actor, url.searchParams.get("cursor"), status);
    return jsonData(data);
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`project-write:${actor.userId}`);
    const parsed = projectInputSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const header = request.headers.get("idempotency-key");
    let idempotencyKey: string | null = null;
    if (header) {
      const key = idempotencyKeySchema.safeParse(header);
      if (!key.success) {
        return errorResponse(400, "invalid_idempotency_key", "The idempotency key is not valid");
      }
      idempotencyKey = key.data;
    }
    const project = await projectService.create(actor, parsed.data, idempotencyKey);
    return jsonData({ project }, 201);
  });
}
