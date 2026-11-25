import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import type { ChatAgentProvider, ChatAgentId, ChatStreamEvent, ChatMessage, McpToolSchema } from "@/lib/assistant/types";

const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.0-flash", "gemini-flash-latest"];

function toGeminiContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  return messages.map((msg) => {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts: Array<Record<string, unknown>> = [{ text: msg.content }];
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.result !== undefined) {
          parts.push({
            functionResponse: {
              name: tc.name,
              response: { result: tc.result },
            },
          });
        }
      }
    }
    return { role, parts };
  });
}

function toGeminiTools(tools: McpToolSchema[]): Array<{ functionDeclarations: Array<Record<string, unknown>> }> {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toGeminiSchema(t.inputSchema),
    })),
  }];
}

function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const typeMap: Record<string, unknown> = {
    string: Type.STRING,
    number: Type.NUMBER,
    integer: Type.INTEGER,
    boolean: Type.BOOLEAN,
    array: Type.ARRAY,
    object: Type.OBJECT,
  };
  const result: Record<string, unknown> = {};
  if (schema.type && typeMap[schema.type as string]) {
    result.type = typeMap[schema.type as string];
  }
  if (schema.description) result.description = schema.description;
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(schema.properties as Record<string, unknown>)) {
      props[key] = toGeminiSchema(val as Record<string, unknown>);
    }
    result.properties = props;
  }
  if (schema.required) result.required = schema.required;
  if (schema.enum) result.enum = schema.enum;
  return result;
}

export class GeminiChatProvider implements ChatAgentProvider {
  readonly id: ChatAgentId = "gemini";
  readonly displayName = "Google Gemini";
  readonly defaultModel = "gemini-3.8-flash";
  readonly models = MODELS;
  readonly freeTier = true;
  readonly docsUrl = "https://aistudio.google.com/apikey";
  readonly apiKeyEnvVar = "GEMINI_API_KEY";

  get configured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
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
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      yield { type: "error", error: "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey" };
      return;
    }

    const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
    const contents = toGeminiContents(params.messages);
    const config: Record<string, unknown> = {
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxTokens ?? 8192,
      abortSignal: params.signal,
    };
    if (params.tools && params.tools.length > 0) {
      config.tools = toGeminiTools(params.tools);
    }

    try {
      const stream = await ai.models.generateContentStream({
        model: params.model,
        contents,
        config,
      });

      let totalText = "";
      let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;

      for await (const chunk of stream) {
        const text = chunk.text ?? "";
        if (text) {
          totalText += text;
          yield { type: "text", delta: text };
        }

        const candidates = chunk.candidates ?? [];
        for (const candidate of candidates) {
          const parts = candidate.content?.parts ?? [];
          for (const part of parts) {
            const fc = part.functionCall;
            if (fc) {
              yield {
                type: "tool_call",
                id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: fc.name ?? "",
                args: (fc.args as Record<string, unknown>) ?? {},
              };
            }
          }
        }

        const meta = chunk.usageMetadata;
        if (meta) {
          usage = {
            promptTokens: meta.promptTokenCount,
            completionTokens: meta.candidatesTokenCount,
            totalTokens: meta.totalTokenCount,
          };
        }
      }

      if (usage) yield { type: "usage", usage };
      yield { type: "done", finishReason: "stop" };
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Gemini streaming failed";
      if (msg.includes("429") || msg.includes("rate")) {
        yield { type: "error", error: "Gemini rate limit reached. Try again in a moment." };
      } else if (msg.includes("401") || msg.includes("API key")) {
        yield { type: "error", error: "Gemini API key invalid. Check GEMINI_API_KEY." };
      } else {
        yield { type: "error", error: msg };
      }
    }
  }
}