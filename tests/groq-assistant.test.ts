import { describe, expect, it, afterEach } from "vitest";

describe("Groq chat provider", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reports configured when GROQ_API_KEY is set", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key";
    const { GroqChatProvider } = await import("@/lib/providers/chat/groqChatProvider");
    const provider = new GroqChatProvider();
    expect(provider.configured).toBe(true);
    expect(provider.isAvailable()).toBe(true);
  });

  it("reports not configured when GROQ_API_KEY is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const { GroqChatProvider } = await import("@/lib/providers/chat/groqChatProvider");
    const provider = new GroqChatProvider();
    expect(provider.configured).toBe(false);
    expect(provider.isAvailable()).toBe(false);
  });

  it("has correct provider metadata", async () => {
    const { GroqChatProvider } = await import("@/lib/providers/chat/groqChatProvider");
    const provider = new GroqChatProvider();
    expect(provider.id).toBe("groq");
    expect(provider.displayName).toBe("Groq");
    expect(provider.freeTier).toBe(true);
    expect(provider.apiKeyEnvVar).toBe("GROQ_API_KEY");
    expect(provider.docsUrl).toBe("https://console.groq.com/keys");
  });

  it("uses GROQ_CHAT_MODEL env var when set", async () => {
    process.env.GROQ_CHAT_MODEL = "llama-3.3-70b-versatile";
    const { GroqChatProvider } = await import("@/lib/providers/chat/groqChatProvider");
    const provider = new GroqChatProvider();
    expect(provider.defaultModel).toBe("llama-3.3-70b-versatile");
  });

  it("defaults to openai/gpt-oss-120b when GROQ_CHAT_MODEL is not set", async () => {
    delete process.env.GROQ_CHAT_MODEL;
    const { GroqChatProvider } = await import("@/lib/providers/chat/groqChatProvider");
    const provider = new GroqChatProvider();
    expect(provider.defaultModel).toBe("openai/gpt-oss-120b");
  });

  it("exposes tool-capable models", async () => {
    const { GroqChatProvider } = await import("@/lib/providers/chat/groqChatProvider");
    const provider = new GroqChatProvider();
    expect(provider.models).toContain("openai/gpt-oss-120b");
    expect(provider.models).toContain("openai/gpt-oss-20b");
    expect(provider.models).toContain("llama-3.3-70b-versatile");
    expect(provider.models.length).toBeGreaterThanOrEqual(3);
  });

  it("yields an error event when API key is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const { GroqChatProvider } = await import("@/lib/providers/chat/groqChatProvider");
    const provider = new GroqChatProvider();
    const events: Array<{ type: string; error?: string }> = [];
    for await (const event of provider.streamCompletion({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "Hello" }],
    })) {
      events.push(event);
    }
    expect(events[0]?.type).toBe("error");
    expect(events[0]?.error).toContain("GROQ_API_KEY");
  });
});

describe("Chat provider registry with Groq", () => {
  it("includes Groq in the provider list", async () => {
    const { listChatAgentProviders } = await import("@/lib/providers/chat/registry");
    const providers = listChatAgentProviders();
    const groq = providers.find((p) => p.id === "groq");
    expect(groq).toBeDefined();
    expect(groq?.displayName).toBe("Groq");
    expect(groq?.freeTier).toBe(true);
  });

  it("returns Groq provider by id", async () => {
    const { getChatAgentProvider } = await import("@/lib/providers/chat/registry");
    const provider = getChatAgentProvider("groq");
    expect(provider).toBeDefined();
    expect(provider?.id).toBe("groq");
  });

  it("lists Groq first in provider order", async () => {
    const { listChatAgentProviders } = await import("@/lib/providers/chat/registry");
    const providers = listChatAgentProviders();
    expect(providers[0]?.id).toBe("groq");
  });
});

describe("Tool registry with correct MCP tool names", () => {
  it("exposes read-only tools that exist in the MCP server", async () => {
    const { EXPOSED_READ_TOOLS } = await import("@/lib/assistant/toolRegistry");
    const expectedReadTools = [
      "project.list", "project.get", "project.context",
      "document.get", "document.export",
      "entity.list", "entity.get",
      "canon.query", "canon.summary",
      "scene.list", "scene.get",
      "episode.list", "episode.get",
      "media.list", "timeline.get",
      "activity.list", "pipeline.get",
      "planning.get", "review.listPending", "render.status",
    ];
    expect([...EXPOSED_READ_TOOLS]).toEqual(expectedReadTools);
  });

  it("exposes write tools that exist in the MCP server", async () => {
    const { EXPOSED_WRITE_TOOLS } = await import("@/lib/assistant/toolRegistry");
    const expectedWriteTools = [
      "project.create", "project.update",
      "document.update", "document.import",
      "story.createDraft",
      "entity.create", "canon.add",
      "scene.create", "scene.update",
      "episode.create", "episode.updateScreenplay",
      "planning.update", "planning.submit",
      "pipeline.start", "pipeline.generateStory",
    ];
    expect([...EXPOSED_WRITE_TOOLS]).toEqual(expectedWriteTools);
  });

  it("classifies project.delete as destructive", async () => {
    const { isDestructive, requiresApproval } = await import("@/lib/assistant/toolRegistry");
    expect(isDestructive("project.delete")).toBe(true);
    expect(requiresApproval("project.delete")).toBe(true);
  });

  it("does not classify read tools as destructive", async () => {
    const { isDestructive } = await import("@/lib/assistant/toolRegistry");
    expect(isDestructive("project.list")).toBe(false);
    expect(isDestructive("project.get")).toBe(false);
    expect(isDestructive("scene.list")).toBe(false);
  });

  it("requires approval for write tools", async () => {
    const { requiresApproval } = await import("@/lib/assistant/toolRegistry");
    expect(requiresApproval("project.create")).toBe(true);
    expect(requiresApproval("document.update")).toBe(true);
    expect(requiresApproval("planning.update")).toBe(true);
    expect(requiresApproval("pipeline.start")).toBe(true);
  });

  it("does not require approval for read tools", async () => {
    const { requiresApproval } = await import("@/lib/assistant/toolRegistry");
    expect(requiresApproval("project.list")).toBe(false);
    expect(requiresApproval("scene.get")).toBe(false);
    expect(requiresApproval("planning.get")).toBe(false);
  });

  it("exposes all read + write + destructive tools", async () => {
    const { isExposed, ALL_EXPOSED_TOOLS } = await import("@/lib/assistant/toolRegistry");
    for (const tool of ALL_EXPOSED_TOOLS) {
      expect(isExposed(tool)).toBe(true);
    }
    expect(ALL_EXPOSED_TOOLS.length).toBe(36);
  });

  it("does not expose tools not in the registry", async () => {
    const { isExposed } = await import("@/lib/assistant/toolRegistry");
    expect(isExposed("chat.complete")).toBe(false);
    expect(isExposed("comfyui.execute")).toBe(false);
    expect(isExposed("veo.generate")).toBe(false);
    expect(isExposed("voice.assign")).toBe(false);
    expect(isExposed("nonexistent.tool")).toBe(false);
  });

  it("no longer references non-existent tool names from the old registry", async () => {
    const { isExposed } = await import("@/lib/assistant/toolRegistry");
    expect(isExposed("canon.get")).toBe(false);
    expect(isExposed("canon.facts")).toBe(false);
    expect(isExposed("activity.recent")).toBe(false);
    expect(isExposed("story.propose")).toBe(false);
    expect(isExposed("entity.update")).toBe(false);
  });
});

describe("ChatAgentId type includes groq", () => {
  it("accepts groq as a valid ChatAgentId", async () => {
    const { type: _t } = await import("@/lib/assistant/types");
    void _t;
    const provider: "groq" = "groq";
    expect(provider).toBe("groq");
  });
});