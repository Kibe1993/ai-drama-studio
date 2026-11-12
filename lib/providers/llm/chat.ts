import OpenAI from "openai";
import { log } from "@/lib/log";
import { classifyProviderError } from "@/lib/providers/llm/errors";
import type { TokenUsage } from "@/lib/providers/llm/types";

type ChatJsonOptions = {
  label: string;
  apiKey: string;
  baseURL?: string;
  model: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
  timeoutMs: number;
  headers?: Record<string, string>;
  responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
  extra?: Record<string, unknown>;
  maxCompletionTokens?: number;
};

export async function chatJson(options: ChatJsonOptions): Promise<{ text: string; usage?: TokenUsage }> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    defaultHeaders: options.headers,
    maxRetries: 0,
    timeout: options.timeoutMs,
  });
  try {
    const completion = await client.chat.completions.create(
      {
        model: options.model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.prompt },
        ],
        response_format: options.responseFormat,
        max_completion_tokens: options.maxCompletionTokens ?? 8000,
        ...options.extra,
      },
      { signal: options.signal, maxRetries: 0, timeout: options.timeoutMs }
    );
    const text = completion.choices[0]?.message?.content ?? "";
    if (!text.trim()) {
      const first = completion.choices[0];
      log.error("llm", "empty completion diagnostic", {
        provider: options.label,
        requestedModel: options.model,
        returnedModel: completion.model ?? "",
        choiceCount: completion.choices.length,
        finishReason: first?.finish_reason ?? "",
        refusalPresent: Boolean(first?.message?.refusal),
        toolCallCount: first?.message?.tool_calls?.length ?? 0,
        contentChars: text.length,
      });
    }
    const usage = completion.usage;
    const inputTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
    const outputTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
    return {
      text,
      usage: inputTokens == null && outputTokens == null ? undefined : { inputTokens, outputTokens },
    };
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      throw classifyProviderError(options.label, error);
    }
    throw classifyProviderError(options.label, error);
  }
}
