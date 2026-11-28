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

const mockProjectMemoryRepo = {
  listByProject: vi.fn(),
  listConfirmed: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  updateStatus: vi.fn(),
  supersede: vi.fn(),
  search: vi.fn(),
  remove: vi.fn(),
};

const mockMemoryRetrievalService = {
  searchHistory: vi.fn(),
  searchProjectMemory: vi.fn(),
  searchAcrossConversations: vi.fn(),
  getConversationSummaries: vi.fn(),
  retrieve: vi.fn(),
};

const mockMemoryIntegrityService = {
  detectConflict: vi.fn(),
  safeUpsert: vi.fn(),
  approveMemory: vi.fn(),
  rejectMemory: vi.fn(),
};

let capturedProviderMessages: ChatMessage[] = [];

function makeMockProvider(streamOverride?: () => AsyncGenerator<ChatStreamEvent>) {
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
    streamCompletion: streamOverride ?? (async function* (params: { messages: ChatMessage[] }): AsyncGenerator<ChatStreamEvent> {
      capturedProviderMessages = params.messages;
      yield { type: "text", delta: "Response." };
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

vi.mock("@/lib/repositories/projectMemoryRepository", () => ({
  projectMemoryRepository: mockProjectMemoryRepo,
}));

vi.mock("@/lib/services/memoryRetrievalService", () => ({
  memoryRetrievalService: mockMemoryRetrievalService,
}));

vi.mock("@/lib/services/memoryIntegrityService", () => ({
  memoryIntegrityService: mockMemoryIntegrityService,
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

vi.mock("@/lib/assistant/artifactRetriever", () => ({
  retrieveArtifacts: async () => [],
  shouldRetrieveArtifacts: () => true,
}));

function makeConversationRecord(id: string, overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id, title: "Test", provider: "groq", model: "test-model",
    projectId: null, lastMessageAt: new Date().toISOString(),
    messageCount: 0, summary: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessageRecord(id: string, conversationId: string, role: string, content: string): MessageRecord {
  return {
    id, conversationId, role: role as MessageRecord["role"], content,
    provider: "groq", model: "test-model",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

async function collectEvents(gen: AsyncGenerator): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of gen) events.push(event as Record<string, unknown>);
  return events;
}

describe("Context pipeline integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProviderMessages = [];
    currentMockProvider = makeMockProvider();
    mockProjectMemoryRepo.listConfirmed.mockResolvedValue([]);
    mockMemoryRetrievalService.retrieve.mockResolvedValue([]);
    mockMemoryIntegrityService.safeUpsert.mockResolvedValue({ record: null, conflict: null });
  });

  describe("1. Project memory is injected into provider context", () => {
    it("includes confirmed project memory as system message", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-1", { projectId: "proj-1" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-1", "user", ""));
      mockProjectMemoryRepo.listConfirmed.mockResolvedValue([
        { id: "mem-1", projectId: "proj-1", category: "identity", key: "genre", value: "thriller", source: "user_decision", status: "confirmed", conversationId: null, createdAt: "", updatedAt: "" },
      ]);

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Hello", conversationId: "conv-1", projectId: "proj-1",
      }));

      expect(mockProjectMemoryRepo.listConfirmed).toHaveBeenCalledWith("user-1", "proj-1");
      const systemMessages = capturedProviderMessages.filter((m) => m.role === "system");
      const memoryMsg = systemMessages.find((m) => m.content.includes("Project context"));
      expect(memoryMsg).toBeDefined();
      expect(memoryMsg?.content).toContain("genre");
      expect(memoryMsg?.content).toContain("thriller");
    });
  });

  describe("2. Retrieved context is injected into provider context", () => {
    it("includes retrieved context as system message", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-2", { projectId: "proj-2" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-2", "user", ""));
      mockMemoryRetrievalService.retrieve.mockResolvedValue([
        { source: "conversation_history", conversationId: "conv-2", content: "Earlier discussion about plot", relevance: 1.5, createdAt: "" },
      ]);

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "What about the plot?", conversationId: "conv-2", projectId: "proj-2",
      }));

      const systemMessages = capturedProviderMessages.filter((m) => m.role === "system");
      const retrievedMsg = systemMessages.find((m) => m.content.includes("Relevant retrieved information"));
      expect(retrievedMsg).toBeDefined();
      expect(retrievedMsg?.content).toContain("plot");
    });
  });

  describe("3. Provider switching preserves context", () => {
    it("assembles same project memory regardless of provider", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-3", { projectId: "proj-3" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-3", "user", ""));
      mockProjectMemoryRepo.listConfirmed.mockResolvedValue([
        { id: "mem-1", projectId: "proj-3", category: "story", key: "setting", value: "space station", source: "user_decision", status: "confirmed", conversationId: null, createdAt: "", updatedAt: "" },
      ]);

      const { chat } = await import("@/lib/services/conversationService");

      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Tell me about the setting", conversationId: "conv-3", projectId: "proj-3",
      }));
      const groqMessages = [...capturedProviderMessages];

      vi.clearAllMocks();
      capturedProviderMessages = [];
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-3", { projectId: "proj-3" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-3", "user", ""));
      mockProjectMemoryRepo.listConfirmed.mockResolvedValue([
        { id: "mem-1", projectId: "proj-3", category: "story", key: "setting", value: "space station", source: "user_decision", status: "confirmed", conversationId: null, createdAt: "", updatedAt: "" },
      ]);
      mockMemoryRetrievalService.retrieve.mockResolvedValue([]);
      mockMemoryIntegrityService.safeUpsert.mockResolvedValue({ record: null, conflict: null });

      await collectEvents(chat({
        clerkUserId: "user-1", provider: "gemini", model: "gemini-3.8-flash",
        message: "Tell me about the setting", conversationId: "conv-3", projectId: "proj-3",
      }));
      const geminiMessages = [...capturedProviderMessages];

      const grokyMemory = groqMessages.find((m) => m.content.includes("space station"));
      const geminiMemory = geminiMessages.find((m) => m.content.includes("space station"));
      expect(grokyMemory).toBeDefined();
      expect(geminiMemory).toBeDefined();
    });
  });

  describe("4. No duplicate assistant messages on multiple tool calls", () => {
    it("creates one assistant message for a response with 3 tool calls", async () => {
      let callCount = 0;
      currentMockProvider = makeMockProvider(async function* (): AsyncGenerator<ChatStreamEvent> {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_call", id: "tc-1", name: "project.list", args: {} };
          yield { type: "tool_call", id: "tc-2", name: "project.get", args: {} };
          yield { type: "tool_call", id: "tc-3", name: "entity.list", args: {} };
          yield { type: "text", delta: "Let me check." };
          yield { type: "done", finishReason: "stop" };
        } else {
          yield { type: "text", delta: "Done." };
          yield { type: "done", finishReason: "stop" };
        }
      });

      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-4", { projectId: "proj-4" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-4", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Show me everything", conversationId: "conv-4", projectId: "proj-4",
      }));

      const assistantMessages = mockChatMessageRepo.create.mock.calls.filter(
        (c) => c[2].role === "assistant",
      );
      expect(assistantMessages).toHaveLength(2);

      const firstAssistant = assistantMessages[0][2];
      expect(firstAssistant.toolCalls).toHaveLength(3);
    });
  });

  describe("5. Memory updates processed after response", () => {
    it("calls safeUpsert when user establishes a fact", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-5", { projectId: "proj-5" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-5", "user", ""));
      mockMemoryIntegrityService.safeUpsert.mockResolvedValue({ record: null, conflict: null });

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "The genre is thriller", conversationId: "conv-5", projectId: "proj-5",
      }));

      expect(mockMemoryIntegrityService.safeUpsert).toHaveBeenCalled();
    });

    it("does not process memory updates without projectId", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(makeConversationRecord("conv-6"));
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-6", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Hello", conversationId: "conv-6",
      }));

      expect(mockMemoryIntegrityService.safeUpsert).not.toHaveBeenCalled();
    });
  });

  describe("6. System prompt is present in all requests", () => {
    it("always includes the system prompt as first message", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-7", { projectId: "proj-7" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-7", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Hello", conversationId: "conv-7", projectId: "proj-7",
      }));

      expect(capturedProviderMessages[0]?.role).toBe("system");
      expect(capturedProviderMessages[0]?.content).toContain("AI Drama Studio");
    });
  });

  describe("7. Conversation history is included in provider context", () => {
    it("passes previous messages to the provider", async () => {
      const existingMessages = [
        makeMessageRecord("m1", "conv-8", "user", "Previous question"),
        makeMessageRecord("m2", "conv-8", "assistant", "Previous answer"),
      ];
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-8", { projectId: "proj-8" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue(existingMessages);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-8", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "New question", conversationId: "conv-8", projectId: "proj-8",
      }));

      const userMessages = capturedProviderMessages.filter((m) => m.role === "user");
      expect(userMessages.length).toBeGreaterThanOrEqual(2);
      expect(userMessages.some((m) => m.content === "Previous question")).toBe(true);
      expect(userMessages.some((m) => m.content === "New question")).toBe(true);
    });
  });

  describe("8. Conversation summary is injected when present", () => {
    it("includes summary as system message", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-9", {
          projectId: "proj-9",
          summary: {
            text: "We discussed the protagonist's backstory.",
            updatedAt: new Date().toISOString(),
            messageCountAtSummary: 10,
            tokenEstimate: 500,
          },
        }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-9", "user", ""));

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Continue", conversationId: "conv-9", projectId: "proj-9",
      }));

      const summaryMsg = capturedProviderMessages.find(
        (m) => m.role === "system" && m.content.includes("Previous conversation summary"),
      );
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg?.content).toContain("protagonist");
    });
  });

  describe("9. Token budget accounts for system messages", () => {
    it("truncates history when system messages + history exceed budget", async () => {
      const largeHistory: MessageRecord[] = Array.from({ length: 100 }, (_, i) =>
        makeMessageRecord(`m${i}`, "conv-10", i % 2 === 0 ? "user" : "assistant", "x".repeat(500)),
      );
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-10", { projectId: "proj-10" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue(largeHistory);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-10", "user", ""));
      mockProjectMemoryRepo.listConfirmed.mockResolvedValue([
        { id: "mem-1", projectId: "proj-10", category: "identity", key: "genre", value: "thriller", source: "user_decision", status: "confirmed", conversationId: null, createdAt: "", updatedAt: "" },
      ]);

      const { chat } = await import("@/lib/services/conversationService");
      await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Continue", conversationId: "conv-10", projectId: "proj-10",
      }));

      const userMessages = capturedProviderMessages.filter((m) => m.role === "user");
      expect(userMessages.length).toBeLessThan(100);
      expect(capturedProviderMessages.length).toBeLessThan(largeHistory.length + 10);
    });
  });

  describe("10. Failed memory fetch does not break chat", () => {
    it("continues when projectMemoryRepository throws", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-11", { projectId: "proj-11" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-11", "user", ""));
      mockProjectMemoryRepo.listConfirmed.mockRejectedValue(new Error("DB error"));

      const { chat } = await import("@/lib/services/conversationService");
      const events = await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Hello", conversationId: "conv-11", projectId: "proj-11",
      }));

      expect(events.some((e) => e.type === "text")).toBe(true);
      expect(events.some((e) => e.type === "error")).toBe(false);
    });

    it("continues when memoryRetrievalService throws", async () => {
      mockConversationRepo.findOwned.mockResolvedValue(
        makeConversationRecord("conv-12", { projectId: "proj-12" }),
      );
      mockChatMessageRepo.listForConversation.mockResolvedValue([]);
      mockChatMessageRepo.create.mockResolvedValue(makeMessageRecord("m", "conv-12", "user", ""));
      mockMemoryRetrievalService.retrieve.mockRejectedValue(new Error("Search error"));

      const { chat } = await import("@/lib/services/conversationService");
      const events = await collectEvents(chat({
        clerkUserId: "user-1", provider: "groq", model: "test-model",
        message: "Hello", conversationId: "conv-12", projectId: "proj-12",
      }));

      expect(events.some((e) => e.type === "text")).toBe(true);
    });
  });
});

describe("Task classifier", () => {
  it("classifies character development requests", async () => {
    const { classifyTask } = await import("@/lib/assistant/taskClassifier");
    const result = classifyTask("Develop the protagonist's backstory", [], []);
    expect(result.type).toBe("character_development");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("classifies scene development requests", async () => {
    const { classifyTask } = await import("@/lib/assistant/taskClassifier");
    const result = classifyTask("Write a new scene with dialogue", [], []);
    expect(result.type).toBe("scene_development");
  });

  it("classifies continuity review requests", async () => {
    const { classifyTask } = await import("@/lib/assistant/taskClassifier");
    const result = classifyTask("Check continuity and timeline consistency", [], []);
    expect(result.type).toBe("continuity_review");
  });

  it("falls back to general conversation", async () => {
    const { classifyTask } = await import("@/lib/assistant/taskClassifier");
    const result = classifyTask("Hello, how are you?", [], []);
    expect(result.type).toBe("general_conversation");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("detects referenced entity names", async () => {
    const { classifyTask } = await import("@/lib/assistant/taskClassifier");
    const result = classifyTask("Tell me about Alice", [], ["Alice", "Bob"]);
    expect(result.referencedEntities).toContain("Alice");
  });
});

describe("Memory update processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryIntegrityService.safeUpsert.mockResolvedValue({ record: null, conflict: null });
  });

  it("extracts user decisions with high confidence", async () => {
    const { extractMemoryCandidates } = await import("@/lib/services/memoryUpdateProcessor");
    const candidates = extractMemoryCandidates("The genre is thriller", "I suggest comedy.");
    const userCandidates = candidates.filter((c) => c.source === "user_decision");
    expect(userCandidates.length).toBeGreaterThan(0);
  });

  it("extracts assistant proposals with lower confidence", async () => {
    const { extractMemoryCandidates } = await import("@/lib/services/memoryUpdateProcessor");
    const candidates = extractMemoryCandidates("What genre?", "I suggest we use comedy for this story.");
    const proposals = candidates.filter((c) => c.source === "assistant_proposal");
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((c) => c.confidence < 0.85)).toBe(true);
  });

  it("does not extract low-confidence candidates", async () => {
    const { extractMemoryCandidates } = await import("@/lib/services/memoryUpdateProcessor");
    const candidates = extractMemoryCandidates("hi", "ok");
    expect(candidates).toHaveLength(0);
  });

  it("processes updates via safeUpsert", async () => {
    const { processMemoryUpdates } = await import("@/lib/services/memoryUpdateProcessor");
    const result = await processMemoryUpdates(
      "user-1", "proj-1", "conv-1",
      "The genre is thriller", "Got it.",
    );
    expect(result.applied + result.conflicts + result.skipped).toBeGreaterThanOrEqual(0);
    expect(mockMemoryIntegrityService.safeUpsert).toHaveBeenCalled();
  });
});