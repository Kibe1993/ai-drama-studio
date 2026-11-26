import "server-only";
import OpenAI from "openai";
import type { ChatAgentProvider, ChatAgentId, ChatStreamEvent, ChatMessage, McpToolSchema } from "@/lib/assistant/types";

const MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
];

const DEFAULT_MODEL = "openai/gpt-oss-120b";

function resolveDefaultModel(): string {
  return process.env.GROQ_CHAT_MODEL?.trim() || DEFAULT_MODEL;
}

function toGroqMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
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

function toGroqTools(tools: McpToolSchema[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

export class GroqChatProvider implements ChatAgentProvider {
  readonly id: ChatAgentId = "groq";
  readonly displayName = "Groq";
  get defaultModel(): string { return resolveDefaultModel(); }
  readonly models = MODELS;
  readonly freeTier = true;
  readonly docsUrl = "https://console.groq.com/keys";
  readonly apiKeyEnvVar = "GROQ_API_KEY";

  get configured(): boolean {
    return Boolean(process.env.GROQ_API_KEY?.trim());
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
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      yield { type: "error", error: "GROQ_API_KEY is not set. Get a key at https://console.groq.com/keys" };
      return;
    }

    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      maxRetries: 1,
      timeout: 60_000,
    });

    try {
      const stream = await client.chat.completions.create({
        model: params.model,
        messages: toGroqMessages(params.messages),
        ...(params.tools && params.tools.length > 0 ? { tools: toGroqTools(params.tools) } : {}),
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
        try { args = JSON.parse(tc.args || "{}"); } catch { /* malformed tool args */ }
        yield { type: "tool_call", id: tc.id, name: tc.name, args };
      }

      yield { type: "done", finishReason: "stop" };
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Groq streaming failed";
      if (msg.includes("429") || msg.includes("rate")) {
        yield { type: "error", error: "Groq rate limit reached. Try again in a moment." };
      } else if (msg.includes("401") || msg.includes("authentication")) {
        yield { type: "error", error: "Groq API key invalid. Check GROQ_API_KEY." };
      } else if (msg.includes("404") || msg.includes("model_not_found")) {
        yield { type: "error", error: `Model not found: ${params.model}. Check GROQ_CHAT_MODEL or select a different model.` };
      } else {
        yield { type: "error", error: msg };
      }
    }
  }
}