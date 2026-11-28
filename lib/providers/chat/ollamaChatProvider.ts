import "server-only";
import type {
  ChatAgentProvider,
  ChatAgentId,
  ChatStreamEvent,
  ChatMessage,
  McpToolSchema,
} from "@/lib/assistant/types";
import { ollamaBaseUrl } from "@/lib/providers/llm/ollama";

const SUGGESTED_MODEL = "qwen3:8b";
const MODELS = [SUGGESTED_MODEL];
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_NUM_CTX = 8192;
const REQUEST_TIMEOUT_MS = 120_000;

function resolveDefaultModel(): string {
  return process.env.OLLAMA_CHAT_MODEL?.trim() || SUGGESTED_MODEL;
}

function isDisabled(): boolean {
  return (
    process.env.OLLAMA_DISABLED?.trim() === "true" ||
    process.env.OLLAMA_ENABLED?.trim() === "false"
  );
}

type OllamaChatMessage = {
  role: string;
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: string } }>;
};

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaStreamChunk = {
  model?: string;
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{ function: { name: string; arguments: string } }>;
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
};

type OllamaTagsResponse = {
  models?: Array<{ name: string; model?: string }>;
};

function toOllamaMessages(messages: ChatMessage[]): OllamaChatMessage[] {
  return messages.map((msg) => {
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: msg.content,
        tool_calls: msg.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    if (msg.role === "tool" && msg.toolCalls) {
      const results = msg.toolCalls.map((tc) => tc.result ?? "").join("\n");
      return { role: "tool", content: results };
    }
    return { role: msg.role, content: msg.content };
  });
}

function toOllamaTools(tools: McpToolSchema[]): OllamaTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export async function fetchOllamaModels(
  baseURL?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const base = baseURL ?? ollamaBaseUrl();
  const response = await fetch(`${base}/api/tags`, {
    signal: signal ?? AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Ollama /api/tags returned ${response.status}`);
  }
  const data = (await response.json()) as OllamaTagsResponse;
  return (data.models ?? []).map((m) => m.name || m.model || "").filter(Boolean);
}

export async function isOllamaReachable(
  baseURL?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const models = await fetchOllamaModels(baseURL, signal);
    return true;
  } catch {
    return false;
  }
}

export class OllamaChatProvider implements ChatAgentProvider {
  readonly id: ChatAgentId = "ollama";
  readonly displayName = "Ollama";
  get defaultModel(): string {
    return resolveDefaultModel();
  }
  readonly models = MODELS;
  readonly freeTier = true;
  readonly docsUrl = "https://ollama.com";
  readonly apiKeyEnvVar = "";

  get configured(): boolean {
    return !isDisabled();
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
    if (isDisabled()) {
      yield { type: "error", error: "Ollama is disabled (OLLAMA_DISABLED=true)." };
      return;
    }

    const base = ollamaBaseUrl();
    const url = `${base}/api/chat`;

    const body: Record<string, unknown> = {
      model: params.model,
      messages: toOllamaMessages(params.messages),
      stream: true,
      options: {
        temperature: params.temperature ?? DEFAULT_TEMPERATURE,
        num_ctx: DEFAULT_NUM_CTX,
        ...(params.maxTokens ? { num_predict: params.maxTokens } : {}),
      },
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = toOllamaTools(params.tools);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: params.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (response.status === 404 || text.includes("not found")) {
          yield {
            type: "error",
            error: `Model "${params.model}" is not installed. Pull it with: ollama pull ${params.model}`,
          };
          return;
        }
        if (response.status >= 500) {
          yield {
            type: "error",
            error: `Ollama returned HTTP ${response.status}. The daemon may be overloaded.`,
          };
          return;
        }
        yield {
          type: "error",
          error: `Ollama returned HTTP ${response.status}: ${text.slice(0, 200)}`,
        };
        return;
      }

      if (!response.body) {
        yield { type: "error", error: "Ollama returned no response body." };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let promptEvalCount = 0;
      let evalCount = 0;
      let doneReason = "stop";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let chunk: OllamaStreamChunk;
            try {
              chunk = JSON.parse(trimmed) as OllamaStreamChunk;
            } catch {
              continue;
            }

            if (chunk.message?.content) {
              yield { type: "text", delta: chunk.message.content };
            }

            if (chunk.message?.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.function.arguments || "{}");
                } catch {
                  args = {};
                }
                yield {
                  type: "tool_call",
                  id: `ollama-tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  name: tc.function.name,
                  args,
                };
              }
            }

            if (chunk.done) {
              if (chunk.done_reason) doneReason = chunk.done_reason;
              if (chunk.prompt_eval_count) promptEvalCount = chunk.prompt_eval_count;
              if (chunk.eval_count) evalCount = chunk.eval_count;
            }
          }
        }

        const remaining = buffer.trim();
        if (remaining) {
          try {
            const chunk = JSON.parse(remaining) as OllamaStreamChunk;
            if (chunk.message?.content) {
              yield { type: "text", delta: chunk.message.content };
            }
            if (chunk.message?.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.function.arguments || "{}");
                } catch {
                  args = {};
                }
                yield {
                  type: "tool_call",
                  id: `ollama-tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  name: tc.function.name,
                  args,
                };
              }
            }
            if (chunk.done) {
              if (chunk.done_reason) doneReason = chunk.done_reason;
              if (chunk.prompt_eval_count) promptEvalCount = chunk.prompt_eval_count;
              if (chunk.eval_count) evalCount = chunk.eval_count;
            }
          } catch {
            // partial JSON, ignore
          }
        }

        if (promptEvalCount > 0 || evalCount > 0) {
          yield {
            type: "usage",
            usage: {
              promptTokens: promptEvalCount,
              completionTokens: evalCount,
              totalTokens: promptEvalCount + evalCount,
            },
          };
        }

        yield { type: "done", finishReason: doneReason };
      } finally {
        reader.releaseLock();
      }
    } catch (cause) {
      if (cause instanceof Error) {
        const msg = cause.message;
        if (
          msg.includes("ECONNREFUSED") ||
          msg.includes("fetch failed") ||
          msg.includes("connect")
        ) {
          yield {
            type: "error",
            error: `Ollama is offline at ${base}. Start the Ollama daemon (ollama serve).`,
          };
          return;
        }
        if (cause.name === "AbortError" || msg.includes("abort")) {
          yield { type: "done", finishReason: "stopped" };
          return;
        }
        if (cause.name === "TimeoutError" || msg.includes("timeout")) {
          yield {
            type: "error",
            error: `Ollama request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`,
          };
          return;
        }
      }
      yield {
        type: "error",
        error: cause instanceof Error ? cause.message : "Ollama streaming failed.",
      };
    }
  }
}