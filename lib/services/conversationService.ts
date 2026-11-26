import "server-only";
import { getChatAgentProvider } from "@/lib/providers/chat/registry";
import { getToolExecutor } from "@/lib/assistant/mcpToolExecutor";
import { requiresApproval, isDestructive } from "@/lib/assistant/toolRegistry";
import { createPendingApproval, cancelApproval } from "@/lib/assistant/approvalManager";
import { conversationRepository } from "@/lib/repositories/conversationRepository";
import { chatMessageRepository } from "@/lib/repositories/chatMessageRepository";
import { logActivity } from "@/lib/mcp/activityLog";
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

  const allMessages: ChatMessage[] = [
    { role: "user", content: SYSTEM_PROMPT },
    ...history,
  ];

  let iteration = 0;
  let assistantContent = "";
  let assistantToolCalls: ToolCall[] = [];
  let assistantUsage: TokenUsage | undefined;

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
      await chatMessageRepository.create(params.clerkUserId, conversation.id, {
        role: "assistant",
        content: assistantContent,
        provider: params.provider,
        model: params.model,
        usage: assistantUsage,
      });
      await conversationRepository.touch(params.clerkUserId, conversation.id);

      if (conversation.messageCount === 0 && assistantContent) {
        const title = params.message.slice(0, 60).trim() || "New Conversation";
        await conversationRepository.update(params.clerkUserId, conversation.id, { title });
      }

      yield { type: "done", finishReason: "stop" };
      return;
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
    }

    assistantContent = "";
  }

  await chatMessageRepository.create(params.clerkUserId, conversation.id, {
    role: "assistant",
    content: assistantContent || "I've reached the tool call limit. Please ask me something else.",
    provider: params.provider,
    model: params.model,
    toolCalls: assistantToolCalls,
    usage: assistantUsage,
  });
  await conversationRepository.touch(params.clerkUserId, conversation.id);

  yield { type: "done", finishReason: "max_iterations" };
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