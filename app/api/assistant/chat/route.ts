import { readActor } from "@/lib/http/request";
import { errorResponse } from "@/lib/http/errors";
import { chat } from "@/lib/services/conversationService";
import { z } from "zod";
import type { ChatAgentId } from "@/lib/assistant/types";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return (async () => {
    let actor;
    try {
      actor = await readActor();
    } catch {
      return errorResponse(401, "unauthorized", "Authentication required.");
    }

    const body = await request.json().catch(() => null);
    const parsed = z.object({
      provider: z.enum(["openai", "gemini", "deepseek", "groq", "ollama"]),
      model: z.string().min(1),
      message: z.string().min(1).max(50000),
      conversationId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(1).max(32768).optional(),
    }).safeParse(body);

    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }

    const { provider, model, message, conversationId, projectId, temperature, maxTokens } = parsed.data;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of chat({
            clerkUserId: actor.userId,
            provider: provider as ChatAgentId,
            model,
            message,
            conversationId: conversationId ?? null,
            projectId: projectId ?? null,
            temperature,
            maxTokens,
            signal: request.signal,
          })) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : "Chat failed.";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  })();
}