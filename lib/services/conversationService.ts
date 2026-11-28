import "server-only";
import { getChatAgentProvider } from "@/lib/providers/chat/registry";
import { getToolExecutor } from "@/lib/assistant/mcpToolExecutor";
import { requiresApproval, isDestructive } from "@/lib/assistant/toolRegistry";
import { createPendingApproval, cancelApproval } from "@/lib/assistant/approvalManager";
import { conversationRepository } from "@/lib/repositories/conversationRepository";
import { chatMessageRepository } from "@/lib/repositories/chatMessageRepository";
import { logActivity } from "@/lib/mcp/activityLog";
import {
  estimateConversationTokens,
  estimateMessageTokens,
  getHistoryBudget,
  shouldSummarize,
  selectRecentWindow,
} from "@/lib/assistant/tokenEstimator";
import type {
  ChatAgentId,
  ChatMessage,
  ChatStreamEvent,
  McpToolSchema,
  ToolCall,
  TokenUsage,
  ConversationRecord,
  MessageRecord,
} from "@/lib/assistant/types";

const MAX_TOOL_ITERATIONS = 10;
const SYSTEM_PROMPT = `You are an AI assistant integrated into AI Drama Studio, a short drama screenplay production system.
You have access to MCP tools that let you read and modify project data.

When the user asks about their projects, story bibles, characters, scenes, or episodes, use the available tools to retrieve the information and respond conversationally.

Always explain what you are doing when calling a tool. For example: "Let me look up your projects…" then call the tool.

For write operations (updating documents, creating entities), the user will be asked to approve the action before it executes.

Be conversational, helpful, and concise. Use markdown formatting for structured responses.`;

const SUMMARIZATION_PROMPT = `Summarize this conversation, preserving:
- The project being discussed and its current state
- Important facts and user decisions
- Accepted and rejected ideas
- Pending tasks and approvals
- Tool operations already performed and their key outcomes
- The current task and remaining work
- Any unresolved questions

Be concise but complete. Do not lose any important decisions or facts.`;

export type ChatParams = {
  clerkUserId: string;
  provider: ChatAgentId;
  model: string;
  message: string;
  conversationId: string | null;
  projectId?: string | null;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type ChatStreamOutput = ChatStreamEvent | { type: "conversation"; conversationId: string };

function buildContextMessages(history: ChatMessage[], model: string, summary: string | null): ChatMessage[] {
  const systemMessages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (summary) {
    systemMessages.push({
      role: "system",
      content: `Previous conversation summary:\n${summary}`,
    });
  }

  const budget = getHistoryBudget(model);
  const historyTokens = estimateConversationTokens(history);

  if (historyTokens <= budget) {
    return [...systemMessages, ...history];
  }

  if (summary) {
    const { recent } = selectRecentWindow(history, model);
    return [...systemMessages, ...recent];
  }

  const { recent, toSummarize } = selectRecentWindow(history, model);
  const summarizeNote: ChatMessage = {
    role: "system",
    content: `[Note: ${toSummarize.length} earlier messages were omitted to fit the context window. Summarization will be generated after this response.]`,
  };
  return [...systemMessages, summarizeNote, ...recent];
}

async function generateSummary(
  provider: ReturnType<typeof getChatAgentProvider>,
  model: string,
  messagesToSummarize: ChatMessage[],
  existingSummary: string | null,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!provider || !provider.isAvailable()) return null;

  const summaryMessages: ChatMessage[] = [
    { role: "system", content: SUMMARIZATION_PROMPT },
    ...(existingSummary ? [{ role: "system" as const, content: `Previous summary:\n${existingSummary}` }] : []),
    ...messagesToSummarize,
    { role: "user" as const, content: "Generate the summary now." },
  ];

  let summaryText = "";
  try {
    const stream = provider.streamCompletion({
      model,
      messages: summaryMessages,
      temperature: 0.3,
      maxTokens: 1024,
      signal,
    });
    for await (const event of stream) {
      if (event.type === "text") {
        summaryText += event.delta;
      } else if (event.type === "error") {
        return null;
      }
    }
  } catch {
    return null;
  }

  return summaryText.trim() || null;
}

export async function* chat(params: ChatParams): AsyncGenerator<ChatStreamOutput> {
  const provider = getChatAgentProvider(params.provider);
  if (!provider) {
    yield { type: "error", error: `Unknown provider: ${params.provider}` };
    return;
  }
  if (!provider.isAvailable()) {
    yield { type: "error", error: `${provider.displayName} is not configured. Set ${provider.apiKeyEnvVar} to enable it. Get a key at ${provider.docsUrl}` };
    return;
  }

  let conversation: ConversationRecord | null = null;
  let history: ChatMessage[] = [];

  if (params.conversationId) {
    conversation = await conversationRepository.findOwned(params.clerkUserId, params.conversationId);
    if (!conversation) {
      yield { type: "error", error: "Conversation not found." };
      return;
    }
    const messages = await chatMessageRepository.listForConversation(params.clerkUserId, params.conversationId);
    history = messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      usage: m.usage,
    }));
  } else {
    conversation = await conversationRepository.create(params.clerkUserId, {
      provider: params.provider,
      model: params.model,
      projectId: params.projectId ?? null,
    });
    yield { type: "conversation", conversationId: conversation.id };
  }

  const userMessage: ChatMessage = { role: "user", content: params.message };
  history.push(userMessage);
  await chatMessageRepository.create(params.clerkUserId, conversation.id, {
    role: "user",
    content: params.message,
    provider: params.provider,
    model: params.model,
  });
  await conversationRepository.touch(params.clerkUserId, conversation.id);

  const executor = await getToolExecutor(params.clerkUserId);
  const toolSchemas = await executor.listExposedTools();

  const allMessages: ChatMessage[] = buildContextMessages(history, params.model, conversation.summary?.text ?? null);

  let iteration = 0;
  let assistantContent = "";
  let assistantToolCalls: ToolCall[] = [];
  let assistantUsage: TokenUsage | undefined;
  let assistantMessageSaved = false;

  async function saveAssistantMessage(content: string, toolCalls: ToolCall[], usage: TokenUsage | undefined) {
    if (assistantMessageSaved) return;
    assistantMessageSaved = true;
    await chatMessageRepository.create(params.clerkUserId, conversation!.id, {
      role: "assistant",
      content: content || "",
      provider: params.provider,
      model: params.model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    });
    await conversationRepository.touch(params.clerkUserId, conversation!.id);

    if (conversation!.messageCount === 0 && content) {
      const title = params.message.slice(0, 60).trim() || "New Conversation";
      await conversationRepository.update(params.clerkUserId, conversation!.id, { title });
    }
  }

  try {
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;
      const stream = provider.streamCompletion({
        model: params.model,
        messages: allMessages,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        signal: params.signal,
      });

      const pendingToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      let hasToolCalls = false;

      for await (const event of stream) {
        switch (event.type) {
          case "text":
            assistantContent += event.delta;
            yield event;
            break;
          case "tool_call":
            hasToolCalls = true;
            pendingToolCalls.push({ id: event.id, name: event.name, args: event.args });
            yield event;
            break;
          case "usage":
            assistantUsage = event.usage;
            yield event;
            break;
          case "error":
            yield event;
            break;
          case "done":
            break;
        }
      }

      if (!hasToolCalls) {
        await saveAssistantMessage(assistantContent, assistantToolCalls, assistantUsage);
        yield { type: "done", finishReason: "stop" };
        break;
      }

      for (const tc of pendingToolCalls) {
        const toolCall: ToolCall = { ...tc, status: "pending" };
        assistantToolCalls.push(toolCall);

        if (requiresApproval(tc.name)) {
          yield { type: "approval_required", id: tc.id, name: tc.name, args: tc.args };
          const approved = await createPendingApproval(tc.id);
          if (!approved) {
            toolCall.result = isDestructive(tc.name) ? "Operation rejected by user." : "Action cancelled by user.";
            toolCall.status = "rejected";
            yield { type: "tool_result", id: tc.id, result: toolCall.result, status: "rejected" };
            allMessages.push({
              role: "assistant",
              content: assistantContent,
              toolCalls: [toolCall],
            });
            allMessages.push({
              role: "tool",
              content: toolCall.result,
              toolCalls: [toolCall],
            });
            await chatMessageRepository.create(params.clerkUserId, conversation.id, {
              role: "tool",
              content: toolCall.result,
              provider: params.provider,
              model: params.model,
              toolCalls: [toolCall],
            });
            continue;
          }
        }

        const result = await executor.callTool(tc.name, tc.args);
        toolCall.result = result.result;
        toolCall.status = result.status;

        yield { type: "tool_result", id: tc.id, result: result.result, status: result.status };

        logActivity(tc.name, params.clerkUserId, null, JSON.stringify({ args: tc.args, result: result.result.slice(0, 500), conversationId: conversation.id }), result.status, "assistant");

        allMessages.push({
          role: "assistant",
          content: assistantContent,
          toolCalls: [toolCall],
        });
        allMessages.push({
          role: "tool",
          content: result.result,
          toolCalls: [toolCall],
        });

        await chatMessageRepository.create(params.clerkUserId, conversation.id, {
          role: "assistant",
          content: assistantContent,
          provider: params.provider,
          model: params.model,
          toolCalls: [toolCall],
          usage: undefined,
        });
        await chatMessageRepository.create(params.clerkUserId, conversation.id, {
          role: "tool",
          content: result.result,
          provider: params.provider,
          model: params.model,
          toolCalls: [toolCall],
        });
        await conversationRepository.touch(params.clerkUserId, conversation.id);
      }

      assistantContent = "";
      assistantToolCalls = [];
      assistantMessageSaved = false;
    }

    if (iteration >= MAX_TOOL_ITERATIONS) {
      await saveAssistantMessage(
        assistantContent || "I've reached the tool call limit. Please ask me something else.",
        assistantToolCalls,
        assistantUsage,
      );
      yield { type: "done", finishReason: "max_iterations" };
    }
  } catch (cause) {
    if (assistantContent || assistantToolCalls.length > 0) {
      await saveAssistantMessage(assistantContent, assistantToolCalls, assistantUsage);
    }
    const error = cause instanceof Error ? cause.message : "Chat failed.";
    if (error.includes("abort") || params.signal?.aborted) {
      yield { type: "done", finishReason: "stopped" };
    } else {
      yield { type: "error", error };
    }
    return;
  }

  try {
    const updatedConversation = await conversationRepository.findOwned(params.clerkUserId, conversation.id);
    const allHistory = history.concat(
      assistantContent ? [{ role: "assistant" as const, content: assistantContent }] : [],
    );

    if (shouldSummarize(allHistory, params.model) && updatedConversation) {
      const { toSummarize } = selectRecentWindow(allHistory, params.model);
      if (toSummarize.length > 5) {
        const summary = await generateSummary(
          provider,
          params.model,
          toSummarize,
          updatedConversation.summary?.text ?? null,
          params.signal,
        );
        if (summary) {
          await conversationRepository.setSummary(params.clerkUserId, conversation.id, {
            text: summary,
            messageCountAtSummary: allHistory.length,
            tokenEstimate: estimateConversationTokens(toSummarize),
          });
        }
      }
    }
  } catch { /* summarization is best-effort */ }
}

export const conversationService = {
  async list(clerkUserId: string, opts: {
    provider?: ChatAgentId;
    projectId?: string;
    limit?: number;
  }): Promise<ConversationRecord[]> {
    return conversationRepository.list(clerkUserId, null, opts.limit ?? 50, opts.provider, opts.projectId);
  },

  async get(clerkUserId: string, id: string): Promise<{ conversation: ConversationRecord; messages: MessageRecord[] } | null> {
    const conversation = await conversationRepository.findOwned(clerkUserId, id);
    if (!conversation) return null;
    const messages = await chatMessageRepository.listForConversation(clerkUserId, id);
    return { conversation, messages };
  },

  async create(clerkUserId: string, input: {
    provider: ChatAgentId;
    model: string;
    title?: string;
    projectId?: string | null;
  }): Promise<ConversationRecord> {
    return conversationRepository.create(clerkUserId, input);
  },

  async rename(clerkUserId: string, id: string, title: string): Promise<ConversationRecord | null> {
    return conversationRepository.update(clerkUserId, id, { title });
  },

  async remove(clerkUserId: string, id: string): Promise<void> {
    await chatMessageRepository.removeForConversation(clerkUserId, id);
    await conversationRepository.remove(clerkUserId, id);
  },
};