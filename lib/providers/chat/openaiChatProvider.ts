import "server-only";
import OpenAI from "openai";
import type { ChatAgentProvider, ChatAgentId, ChatStreamEvent, ChatMessage, McpToolSchema } from "@/lib/assistant/types";

const MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"];

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      });
    } else if (msg.role === "tool" && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        result.push({
          role: "tool",
          tool_call_id: tc.id,
          content: tc.result ?? "",
        });
      }
    } else {
      result.push({ role: msg.role as "system" | "user" | "assistant", content: msg.content });
    }
  }
  return result;
}

function toOpenAITools(tools: McpToolSchema[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

export class OpenAIChatProvider implements ChatAgentProvider {
  readonly id: ChatAgentId = "openai";
  readonly displayName = "ChatGPT (OpenAI)";
  readonly defaultModel = "gpt-4o";
  readonly models = MODELS;
  readonly freeTier = false;
  readonly docsUrl = "https://platform.openai.com/api-keys";
  readonly apiKeyEnvVar = "OPENAI_API_KEY";

  get configured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  isAvailable(): boolean {
    return this.configured;
  }

  async *streamCompletion(params: {
    model: string;
    messages: ChatMessage[];
    tools?: McpToolSchema[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      yield { type: "error", error: "OPENAI_API_KEY is not set. Get a key at https://platform.openai.com/api-keys" };
      return;
    }

    const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 60_000 });

    try {
      const stream = await client.chat.completions.create({
        model: params.model,
        messages: toOpenAIMessages(params.messages),
        ...(params.tools && params.tools.length > 0 ? { tools: toOpenAITools(params.tools) } : {}),
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        stream: true,
      }, { signal: params.signal });

      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { type: "text", delta: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallBuffers.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolCallBuffers.set(idx, existing);
          }
        }
        if (chunk.usage) {
          yield {
            type: "usage",
            usage: {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            },
          };
        }
      }

      for (const [, tc] of toolCallBuffers) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.args || "{}"); } catch { /* */ }
        yield { type: "tool_call", id: tc.id, name: tc.name, args };
      }

      yield { type: "done", finishReason: "stop" };
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "OpenAI streaming failed";
      if (msg.includes("429") || msg.includes("rate")) {
        yield { type: "error", error: "OpenAI rate limit reached. Try again in a moment." };
      } else if (msg.includes("401") || msg.includes("authentication")) {
        yield { type: "error", error: "OpenAI API key invalid. Check OPENAI_API_KEY." };
      } else {
        yield { type: "error", error: msg };
      }
    }
  }
}