import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { conversationService } from "@/lib/services/conversationService";
import { z } from "zod";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return logged(request, async () => {
    const actor = await readActor();
    const { id } = await params;
    const result = await conversationService.get(actor.userId, id);
    if (!result) return errorResponse(404, "not_found", "Conversation not found.");
    return jsonData(result);
  });
}

export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return logged(request, async () => {
    const actor = await readActor();
    const { id } = await params;
    const parsed = z.object({
      title: z.string().min(1).max(200).optional(),
      model: z.string().min(1).optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const result = await conversationService.rename(actor.userId, id, parsed.data.title ?? "");
    return jsonData(result);
  });
}

export function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return logged(request, async () => {
    const actor = await readActor();
    const { id } = await params;
    await conversationService.remove(actor.userId, id);
    return jsonData({ ok: true });
  });
}