import OpenAI from "openai";
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
        max_completion_tokens: 8000,
        ...options.extra,
      },
      { signal: options.signal, maxRetries: 0, timeout: options.timeoutMs }
    );
    const text = completion.choices[0]?.message?.content ?? "";
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
