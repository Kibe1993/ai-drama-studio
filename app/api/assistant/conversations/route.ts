import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { conversationService } from "@/lib/services/conversationService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider") as "openai" | "gemini" | "deepseek" | "groq" | "ollama" | null;
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const conversations = await conversationService.list(actor.userId, {
      provider: provider ?? undefined,
      projectId,
      limit,
    });
    return jsonData(conversations);
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = z.object({
      provider: z.enum(["openai", "gemini", "deepseek", "groq", "ollama"]),
      model: z.string().min(1),
      title: z.string().max(200).optional(),
      projectId: z.string().nullable().optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const conversation = await conversationService.create(actor.userId, {
      provider: parsed.data.provider,
      model: parsed.data.model,
      title: parsed.data.title,
      projectId: parsed.data.projectId ?? null,
    });
    return jsonData(conversation);
  });
}