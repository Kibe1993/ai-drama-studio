export type ChatAgentId = "openai" | "gemini" | "deepseek";

export type ChatRole = "user" | "assistant" | "tool";

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "success" | "error" | "awaiting_approval";
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
};

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; result: string; status: "success" | "error" }
  | { type: "approval_required"; id: string; name: string; args: Record<string, unknown> }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: string }
  | { type: "error"; error: string };

export type McpToolSchema = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ChatAgentProviderInfo = {
  id: ChatAgentId;
  displayName: string;
  configured: boolean;
  freeTier: boolean;
  defaultModel: string;
  models: string[];
  docsUrl: string;
  apiKeyEnvVar: string;
};

export interface ChatAgentProvider {
  readonly id: ChatAgentId;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly models: string[];
  readonly freeTier: boolean;
  readonly docsUrl: string;
  readonly apiKeyEnvVar: string;

  get configured(): boolean;
  isAvailable(): boolean;

  streamCompletion(params: {
    model: string;
    messages: ChatMessage[];
    tools?: McpToolSchema[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent>;
}

export type ConversationRecord = {
  id: string;
  title: string;
  provider: ChatAgentId;
  model: string;
  projectId: string | null;
  lastMessageAt: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  provider: ChatAgentId;
  model: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  createdAt: string;
  updatedAt: string;
};

export type ConversationCreateInput = {
  title?: string;
  provider: ChatAgentId;
  model: string;
  projectId?: string | null;
};