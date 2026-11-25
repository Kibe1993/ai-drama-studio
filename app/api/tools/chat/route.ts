import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { chatService } from "@/lib/services/chatService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    await readActor();
    return jsonData({ providers: chatService.listProviders() });
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    await readActor();
    const parsed = z.object({
      action: z.enum(["complete", "provider"]),
      provider: z.string().min(1).max(50),
      model: z.string().optional(),
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(100000),
      })).min(1).max(100).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(1).max(32768).optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const { action, provider, model, messages, temperature, maxTokens } = parsed.data;
    switch (action) {
      case "provider":
        return jsonData(chatService.getProvider(provider));
      case "complete":
        if (!messages) {
          return errorResponse(400, "invalid_input", "messages are required for complete action");
        }
        return jsonData(await chatService.complete({
          provider,
          model,
          messages,
          temperature,
          maxTokens,
        }));
      default:
        return errorResponse(400, "invalid_action", "Unknown action");
    }
  });
}