import type { ChatMessage } from "@/lib/assistant/types";

const CHARS_PER_TOKEN = 4;
const TOOL_CALL_OVERHEAD = 20;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message: ChatMessage): number {
  let total = estimateTokens(message.content);
  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      total += TOOL_CALL_OVERHEAD;
      total += estimateTokens(tc.name);
      total += estimateTokens(JSON.stringify(tc.args));
      if (tc.result) total += estimateTokens(tc.result);
    }
  }
  return total;
}

export function estimateConversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export type ModelContextWindow = {
  contextWindow: number;
  responseReserve: number;
};

const MODEL_CONTEXT_WINDOWS: Record<string, ModelContextWindow> = {
  "openai/gpt-oss-120b": { contextWindow: 131072, responseReserve: 8192 },
  "openai/gpt-oss-20b": { contextWindow: 131072, responseReserve: 8192 },
  "llama-3.3-70b-versatile": { contextWindow: 32768, responseReserve: 4096 },
  "llama-3.1-8b-instant": { contextWindow: 32768, responseReserve: 4096 },
  "gemini-3.8-flash": { contextWindow: 1048576, responseReserve: 8192 },
  "gemini-3.6-flash": { contextWindow: 1048576, responseReserve: 8192 },
  "gemini-2.0-flash": { contextWindow: 1048576, responseReserve: 8192 },
  "gemini-flash-latest": { contextWindow: 1048576, responseReserve: 8192 },
  "gpt-4o": { contextWindow: 128000, responseReserve: 8192 },
  "gpt-4o-mini": { contextWindow: 128000, responseReserve: 8192 },
  "gpt-4-turbo": { contextWindow: 128000, responseReserve: 8192 },
  "deepseek-chat": { contextWindow: 65536, responseReserve: 8192 },
  "deepseek-reasoner": { contextWindow: 65536, responseReserve: 8192 },
};

const DEFAULT_CONTEXT_WINDOW: ModelContextWindow = { contextWindow: 32768, responseReserve: 4096 };

export function getModelContextWindow(model: string): ModelContextWindow {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

export function getHistoryBudget(model: string): number {
  const { contextWindow, responseReserve } = getModelContextWindow(model);
  return Math.floor((contextWindow - responseReserve) * 0.65);
}

export function shouldSummarize(messages: ChatMessage[], model: string): boolean {
  const budget = getHistoryBudget(model);
  return estimateConversationTokens(messages) > budget * 0.6;
}

export function selectRecentWindow(messages: ChatMessage[], model: string): {
  recent: ChatMessage[];
  toSummarize: ChatMessage[];
} {
  const budget = getHistoryBudget(model);
  const toSummarize: ChatMessage[] = [];
  const recent: ChatMessage[] = [];
  let recentTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(messages[i]);
    if (recentTokens + msgTokens > budget && recent.length > 0) {
      toSummarize.unshift(...messages.slice(0, i + 1));
      break;
    }
    recentTokens += msgTokens;
    recent.unshift(messages[i]);
    if (i === 0) {
      break;
    }
  }

  return { recent, toSummarize };
}