import "server-only";
import type { ChatMessage } from "@/lib/assistant/types";
import {
  estimateConversationTokens,
  getHistoryBudget,
  selectRecentWindow,
} from "@/lib/assistant/tokenEstimator";

const SYSTEM_PROMPT = `You are an AI assistant integrated into AI Drama Studio, a short drama screenplay production system.
You have access to MCP tools that let you read and modify project data.

When the user asks about their projects, story bibles, characters, scenes, or episodes, use the available tools to retrieve the information and respond conversationally.

Always explain what you are doing when calling a tool. For example: "Let me look up your projects…" then call the tool.

For write operations (updating documents, creating entities), the user will be asked to approve the action before it executes.

Be conversational, helpful, and concise. Use markdown formatting for structured responses.`;

export type ContextAssemblyInput = {
  history: ChatMessage[];
  model: string;
  summary: string | null;
  projectMemory?: Array<{ category: string; key: string; value: string; status: string }>;
  retrievedContext?: Array<{ source: string; content: string }>;
};

export type ContextAssemblyResult = {
  messages: ChatMessage[];
  truncated: boolean;
  tokenEstimate: number;
  omittedCount: number;
};

export function assembleContext(input: ContextAssemblyInput): ContextAssemblyResult {
  const messages: ChatMessage[] = [];

  messages.push({ role: "system", content: SYSTEM_PROMPT });

  if (input.projectMemory && input.projectMemory.length > 0) {
    const memoryText = input.projectMemory
      .map((m) => `- [${m.category}] ${m.key}: ${m.value} (${m.status})`)
      .join("\n");
    messages.push({
      role: "system",
      content: `Project context:\n${memoryText}`,
    });
  }

  if (input.summary) {
    messages.push({
      role: "system",
      content: `Previous conversation summary:\n${input.summary}`,
    });
  }

  if (input.retrievedContext && input.retrievedContext.length > 0) {
    const retrievedText = input.retrievedContext
      .map((r) => `[${r.source}] ${r.content}`)
      .join("\n");
    messages.push({
      role: "system",
      content: `Relevant retrieved information:\n${retrievedText}`,
    });
  }

  const budget = getHistoryBudget(input.model);
  const historyTokens = estimateConversationTokens(input.history);

  if (historyTokens <= budget) {
    const allMessages = [...messages, ...input.history];
    return {
      messages: allMessages,
      truncated: false,
      tokenEstimate: estimateConversationTokens(allMessages),
      omittedCount: 0,
    };
  }

  const { recent, toSummarize } = selectRecentWindow(input.history, input.model);
  if (input.summary) {
    const allMessages = [...messages, ...recent];
    return {
      messages: allMessages,
      truncated: true,
      tokenEstimate: estimateConversationTokens(allMessages),
      omittedCount: toSummarize.length,
    };
  }

  const truncateNote: ChatMessage = {
    role: "system",
    content: `[Note: ${toSummarize.length} earlier messages were omitted to fit the context window. A summary will be generated after this response.]`,
  };
  const allMessages = [...messages, truncateNote, ...recent];
  return {
    messages: allMessages,
    truncated: true,
    tokenEstimate: estimateConversationTokens(allMessages),
    omittedCount: toSummarize.length,
  };
}