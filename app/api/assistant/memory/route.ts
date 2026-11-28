import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData, errorResponse } from "@/lib/http/errors";
import { projectMemoryRepository } from "@/lib/repositories/projectMemoryRepository";
import { memoryIntegrityService } from "@/lib/services/memoryIntegrityService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return errorResponse(400, "missing_project", "projectId is required");

    const memories = await projectMemoryRepository.listByProject(actor.userId, projectId);
    return jsonData({ memories });
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const body = await readJson(request);
    const parsed = z.object({
      action: z.enum(["create", "approve", "reject", "supersede"]),
      projectId: z.string(),
      memoryId: z.string().optional(),
      category: z.enum(["identity", "story", "development", "technical"]).optional(),
      key: z.string().optional(),
      value: z.string().optional(),
      source: z.enum(["user_decision", "assistant_proposal", "mcp_result", "canon", "correction"]).optional(),
    }).safeParse(body);

    if (!parsed.success) return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid");

    const { action, projectId } = parsed.data;

    if (action === "approve" && parsed.data.memoryId) {
      await memoryIntegrityService.approveMemory(actor.userId, parsed.data.memoryId);
      return jsonData({ ok: true });
    }

    if (action === "reject" && parsed.data.memoryId) {
      await memoryIntegrityService.rejectMemory(actor.userId, parsed.data.memoryId);
      return jsonData({ ok: true });
    }

    if (action === "create" && parsed.data.category && parsed.data.key && parsed.data.value) {
      const result = await memoryIntegrityService.safeUpsert(actor.userId, {
        projectId,
        category: parsed.data.category,
        key: parsed.data.key,
        value: parsed.data.value,
        source: parsed.data.source ?? "user_decision",
        status: "confirmed",
      });
      return jsonData({ memory: result.record, conflict: result.conflict });
    }

    return errorResponse(400, "invalid_action", "Invalid action or missing fields");
  });
}