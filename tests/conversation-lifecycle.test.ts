import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatStreamEvent, ChatMessage, ConversationRecord, MessageRecord } from "@/lib/assistant/types";

const mockConversationRepo = {
  findOwned: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  touch: vi.fn(),
  remove: vi.fn(),
  setSummary: vi.fn(),
  list: vi.fn(),
};

const mockChatMessageRepo = {
  listForConversation: vi.fn(),
  create: vi.fn(),
  removeForConversation: vi.fn(),
};

function makeMockProvider(streamOverride?: (params: { messages: ChatMessage[] }) => AsyncGenerator<ChatStreamEvent>) {
  return {
    id: "groq" as const,
    displayName: "Groq",
    defaultModel: "test-model",
    models: ["test-model"],
    freeTier: true,
    docsUrl: "https://example.com",
    apiKeyEnvVar: "GROQ_API_KEY",
    configured: true,
    isAvailable: () => true,
    streamCompletion: streamOverride ?? (async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: "text", delta: "Hello from the assistant." };
      yield { type: "done", finishReason: "stop" };
    }),
  };
}

let currentMockProvider = makeMockProvider();

vi.mock("@/lib/providers/chat/registry", () => ({
  getChatAgentProvider: () => currentMockProvider,
  listChatAgentProviders: () => [currentMockProvider],
}));

vi.mock("@/lib/assistant/mcpToolExecutor", () => ({
  getToolExecutor: async () => ({
    listExposedTools: async () => [],
    callTool: async () => ({ result: "tool result", status: "success" as const }),
  }),
}));

vi.mock("@/lib/repositories/conversationRepository", () => ({
  conversationRepository: mockConversationRepo,
}));

vi.mock("@/lib/repositories/chatMessageRepository", () => ({
  chatMessageRepository: mockChatMessageRepo,
}));

vi.mock("@/lib/assistant/toolRegistry", () => ({
  requiresApproval: () => false,
  isDestructive: () => false,
  isExposed: () => true,
  ALL_EXPOSED_TOOLS: [] as string[],
  EXPOSED_READ_TOOLS: new Set<string>(),
  EXPOSED_WRITE_TOOLS: new Set<string>(),
}));

vi.mock("@/lib/assistant/approvalManager", () => ({
  createPendingApproval: async () => true,
  cancelApproval: () => {},
}));

vi.mock("@/lib/mcp/activityLog", () => ({
  logActivity: () => {},
}));

function makeConversationRecord(id: string, overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id,
    title: "Test Conversation",
    provider: "groq",
    model: "test-model",
    projectId: null,
    lastMessageAt: new Date().toISOString(),
    messageCount: 0,
    summary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessageRecord(id: string, conversationId: string, role: string, content: string): MessageRecord {
  return {
    id,
    conversationId,
    role: role as MessageRecord["role"],
    content,
    provider: "groq",
    model: "test-model",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function collectEvents(gen: AsyncGenerator): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of gen) {
    events.push(event as Record<string, unknown>);
  }
  return events;
}

describe("Conversation lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockProvider = makeMockProvider();
  });

  describe("1. Starting a new chat creates exactly one conversation", () => {
    it("creates one conversation when conversationId is null", async () => {
      mockConversationRepo.create.mockResolvedValue(makeConversationRecord("conv-1"));
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-1", "conv-1", "user", "hi"));
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-1", { messageCount: 2 }));

      const { chat } = await import("@/lib/services/conversationService");
      const events = await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: null,
        }),
      );

      expect(mockConversationRepo.create).toHaveBeenCalledTimes(1);
      const conversationEvent = events.find((e) => e.type === "conversation");
      expect(conversationEvent).toBeDefined();
      expect(conversationEvent?.conversationId).toBe("conv-1");
    });
  });

  describe("2. Sending the first message does not create a duplicate conversation", () => {
    it("does not create a new conversation when conversationId is provided", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-existing"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-1", "conv-existing", "user", "hi"));

      const { chat } = await import("@/lib/services/conversationService");
      const events = await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: "conv-existing",
        }),
      );

      expect(mockConversationRepo.create).not.toHaveBeenCalled();
      expect(mockConversationRepo.findOwned).toHaveBeenCalledWith("user-1", "conv-existing");
      const conversationEvent = events.find((e) => e.type === "conversation");
      expect(conversationEvent).toBeUndefined();
    });
  });

  describe("3. Sending five consecutive messages keeps them in one conversation", () => {
    it("reuses the same conversation ID for five messages", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-multi"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-multi", "user", "text"));

      const { chat } = await import("@/lib/services/conversationService");

      for (let i = 0; i < 5; i++) {
        await collectEvents(
          chat({
            clerkUserId: "user-1",
            provider: "groq",
            model: "test-model",
            message: `Message ${i + 1}`,
            conversationId: "conv-multi",
          }),
        );
      }

      expect(mockConversationRepo.create).not.toHaveBeenCalled();
      expect(mockConversationRepo.findOwned).toHaveBeenCalledTimes(10);
      expect(mockConversationRepo.findOwned).toHaveBeenNthCalledWith(1, "user-1", "conv-multi");
      expect(mockConversationRepo.findOwned).toHaveBeenNthCalledWith(9, "user-1", "conv-multi");

      const allCreateCalls = mockChatMessageRepo.create.mock.calls;
      for (const call of allCreateCalls) {
        expect(call[1]).toBe("conv-multi");
      }
    });
  });

  describe("4. Assistant responses are stored in the same conversation", () => {
    it("saves both user and assistant messages under the same conversation ID", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-resp"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-resp", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: "conv-resp",
        }),
      );

      const createCalls = mockChatMessageRepo.create.mock.calls;
      const roles = createCalls.map((c) => c[2].role);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
      for (const call of createCalls) {
        expect(call[1]).toBe("conv-resp");
      }
    });
  });

  describe("5. MCP tool calls and results remain in the same conversation", () => {
    it("saves tool messages under the same conversation ID", async () => {
      currentMockProvider = makeMockProvider(async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: "tool_call", id: "tc-1", name: "project.list", args: {} };
        yield { type: "text", delta: "Done." };
        yield { type: "done", finishReason: "stop" };
      });

      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-tool"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-tool", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      const events = await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "List my projects",
          conversationId: "conv-tool",
        }),
      );

      expect(events.some((e) => e.type === "tool_call")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);

      const createCalls = mockChatMessageRepo.create.mock.calls;
      const roles = createCalls.map((c) => c[2].role);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
      expect(roles).toContain("tool");
      for (const call of createCalls) {
        expect(call[1]).toBe("conv-tool");
      }
    });
  });

  describe("6. Opening an existing conversation restores its messages", () => {
    it("loads conversation history from the repository", async () => {
      const existingMessages = [
        makeMessageRecord("m1", "conv-load", "user", "First message"),
        makeMessageRecord("m2", "conv-load", "assistant", "First response"),
      ];
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-load"));
      mockChatMessageRepo.listForConversation.mockResolvedValue(existingMessages);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m3", "conv-load", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Continue",
          conversationId: "conv-load",
        }),
      );

      expect(mockChatMessageRepo.listForConversation).toHaveBeenCalledWith("user-1", "conv-load");
    });
  });

  describe("7. Switching providers retains the same conversation ID", () => {
    it("keeps the same conversation ID when switching from groq to gemini", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-switch", { provider: "groq" }));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-switch", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");

      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Message with Groq",
          conversationId: "conv-switch",
        }),
      );

      vi.clearAllMocks();
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-switch", { provider: "groq" }));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-switch", "user", ""));

      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "gemini",
          model: "gemini-3.8-flash",
          message: "Message with Gemini",
          conversationId: "conv-switch",
        }),
      );

      expect(mockConversationRepo.create).not.toHaveBeenCalled();
      expect(mockConversationRepo.findOwned).toHaveBeenCalledWith("user-1", "conv-switch");
    });

    it("keeps the same conversation ID when switching from gemini to openai", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-switch2", { provider: "gemini" }));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-switch2", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");

      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "openai",
          model: "gpt-4o",
          message: "Message with OpenAI",
          conversationId: "conv-switch2",
        }),
      );

      expect(mockConversationRepo.create).not.toHaveBeenCalled();
      expect(mockConversationRepo.findOwned).toHaveBeenCalledWith("user-1", "conv-switch2");
    });
  });

  describe("8. Clicking New Chat creates a different conversation ID", () => {
    it("creates a new conversation with a different ID when conversationId is null", async () => {
      mockConversationRepo.create
        .mockResolvedValueOnce(makeConversationRecord("conv-A"))
        .mockResolvedValueOnce(makeConversationRecord("conv-B"));
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-A", "user", ""));
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-A", { messageCount: 2 }));

      const { chat } = await import("@/lib/services/conversationService");

      const events1 = await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "First chat",
          conversationId: null,
        }),
      );

      vi.clearAllMocks();
      mockConversationRepo.create.mockResolvedValue(makeConversationRecord("conv-B"));
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-B", "user", ""));
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-B", { messageCount: 2 }));

      const events2 = await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Second chat",
          conversationId: null,
        }),
      );

      const id1 = events1.find((e) => e.type === "conversation")?.conversationId;
      const id2 = events2.find((e) => e.type === "conversation")?.conversationId;
      expect(id1).toBe("conv-A");
      expect(id2).toBe("conv-B");
      expect(id1).not.toBe(id2);
    });
  });

  describe("9. The previous conversation remains accessible after starting a new one", () => {
    it("can load the old conversation by its ID after creating a new one", async () => {
      mockConversationRepo.create.mockResolvedValue(makeConversationRecord("conv-new"));
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-new", "user", ""));
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-new", { messageCount: 2 }));

      const { chat, conversationService } = await import("@/lib/services/conversationService");

      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "New chat message",
          conversationId: null,
        }),
      );

      vi.clearAllMocks();
      const oldConversation = makeConversationRecord("conv-old", { title: "Old Chat" });
      const oldMessages = [makeMessageRecord("old-msg", "conv-old", "user", "old message")];
      mockConversationRepo.findOwned.mockResolvedValue(oldConversation);
      mockChatMessageRepo.listForConversation.mockResolvedValue(oldMessages);

      const result = await conversationService.get("user-1", "conv-old");
      expect(result).not.toBeNull();
      expect(result?.conversation.id).toBe("conv-old");
      expect(result?.conversation.title).toBe("Old Chat");
      expect(result?.messages).toHaveLength(1);
    });
  });

  describe("10. Failed requests do not create duplicate conversations", () => {
    it("does not create a new conversation when the provider throws and conversationId is provided", async () => {
      currentMockProvider = makeMockProvider(async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: "text", delta: "partial" };
        throw new Error("Provider failed");
      });

      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-fail"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-fail", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      const events = await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: "conv-fail",
        }),
      );

      expect(mockConversationRepo.create).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === "error")).toBe(true);
    });

    it("saves partial content on failure under the same conversation", async () => {
      currentMockProvider = makeMockProvider(async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: "text", delta: "partial response" };
        throw new Error("Provider failed mid-stream");
      });

      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-partial"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-partial", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: "conv-partial",
        }),
      );

      const createCalls = mockChatMessageRepo.create.mock.calls;
      const assistantMessages = createCalls.filter((c) => c[2].role === "assistant");
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
      for (const call of assistantMessages) {
        expect(call[1]).toBe("conv-partial");
      }
    });
  });

  describe("11. A user cannot access another user's conversation", () => {
    it("returns an error when the conversation is not owned by the user", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(null);

      const { chat } = await import("@/lib/services/conversationService");
      const events = await collectEvents(
        chat({
          clerkUserId: "user-attacker",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: "conv-victim",
        }),
      );

      expect(mockConversationRepo.findOwned).toHaveBeenCalledWith("user-attacker", "conv-victim");
      expect(mockChatMessageRepo.create).not.toHaveBeenCalled();
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toContain("not found");
    });
  });

  describe("12. Streaming responses do not create duplicate messages or conversations", () => {
    it("yields text deltas but creates exactly one assistant message", async () => {
      currentMockProvider = makeMockProvider(async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: "text", delta: "Hello " };
        yield { type: "text", delta: "world " };
        yield { type: "text", delta: "!" };
        yield { type: "done", finishReason: "stop" };
      });

      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-stream"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-stream", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      const events = await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: "conv-stream",
        }),
      );

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(3);

      const assistantMessages = mockChatMessageRepo.create.mock.calls.filter((c) => c[2].role === "assistant");
      expect(assistantMessages).toHaveLength(1);

      expect(mockConversationRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("13. Retrying a failed request does not create a new conversation", () => {
    it("reuses the same conversation ID on retry", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-retry"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-retry", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");

      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: "conv-retry",
        }),
      );

      vi.clearAllMocks();
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-retry"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-retry", "user", ""));

      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Hello",
          conversationId: "conv-retry",
        }),
      );

      expect(mockConversationRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("14. New conversation gets title from first message", () => {
    it("sets the conversation title from the first user message", async () => {
      mockConversationRepo.create.mockResolvedValue(makeConversationRecord("conv-title", { messageCount: 0 }));
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("msg-x", "conv-title", "user", ""));
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-title", { messageCount: 2 }));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(
        chat({
          clerkUserId: "user-1",
          provider: "groq",
          model: "test-model",
          message: "Develop a story concept about space exploration",
          conversationId: null,
        }),
      );

      expect(mockConversationRepo.update).toHaveBeenCalledWith(
        "user-1",
        "conv-title",
        { title: "Develop a story concept about space exploration" },
      );
    });
  });

  describe("15. Conversation service CRUD operations", () => {
    it("list returns conversations from the repository", async () => {
      const convs = [makeConversationRecord("c1"), makeConversationRecord("c2")];
      mockConversationRepo.list.mockResolvedValue(convs);

      const { conversationService } = await import("@/lib/services/conversationService");
      const result = await conversationService.list("user-1", { limit: 10 });

      expect(result).toHaveLength(2);
      expect(mockConversationRepo.list).toHaveBeenCalledWith("user-1", null, 10, undefined, undefined);
    });

    it("get returns null when conversation is not found", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(null);

      const { conversationService } = await import("@/lib/services/conversationService");
      const result = await conversationService.get("user-1", "nonexistent");

      expect(result).toBeNull();
    });

    it("remove deletes messages then conversation", async () => {
      mockChatMessageRepo.removeForConversation.mockResolvedValue(undefined);
      mockConversationRepo.remove.mockResolvedValue(undefined);

      const { conversationService } = await import("@/lib/services/conversationService");
      await conversationService.remove("user-1", "conv-del");

      expect(mockChatMessageRepo.removeForConversation).toHaveBeenCalledWith("user-1", "conv-del");
      expect(mockConversationRepo.remove).toHaveBeenCalledWith("user-1", "conv-del");
    });
  });
});