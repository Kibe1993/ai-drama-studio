import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/connect", () => ({
  connectDB: vi.fn(),
}));

vi.mock("@/lib/mcp/server", () => ({
  createMcpServer: vi.fn(),
}));

vi.mock("@/lib/mcp/activityLog", () => ({
  logActivity: vi.fn(),
  getActivityLog: vi.fn(() => []),
}));

import { GeminiChatProvider } from "@/lib/providers/chat/geminiChatProvider";
import { OpenAIChatProvider } from "@/lib/providers/chat/openaiChatProvider";
import { DeepSeekChatProvider } from "@/lib/providers/chat/deepSeekChatProvider";
import { listChatAgentProviders, getChatAgentProvider } from "@/lib/providers/chat/registry";
import { isExposed, requiresApproval } from "@/lib/assistant/toolRegistry";

describe("Chat Agent Provider Registry", () => {
  it("lists all five providers", () => {
    const providers = listChatAgentProviders();
    expect(providers).toHaveLength(5);
    expect(providers.map((p) => p.id)).toEqual(["groq", "gemini", "openai", "deepseek", "ollama"]);
  });

  it("each provider has correct metadata", () => {
    const providers = listChatAgentProviders();
    const gemini = providers.find((p) => p.id === "gemini")!;
    expect(gemini.displayName).toBe("Google Gemini");
    expect(gemini.freeTier).toBe(true);
    expect(gemini.defaultModel).toBe("gemini-3.8-flash");

    const openai = providers.find((p) => p.id === "openai")!;
    expect(openai.displayName).toBe("ChatGPT (OpenAI)");
    expect(openai.freeTier).toBe(false);
    expect(openai.defaultModel).toBe("gpt-4o");

    const deepseek = providers.find((p) => p.id === "deepseek")!;
    expect(deepseek.displayName).toBe("DeepSeek");
    expect(deepseek.freeTier).toBe(false);
    expect(deepseek.defaultModel).toBe("deepseek-chat");
  });

  it("getChatAgentProvider returns provider by id", () => {
    const gemini = getChatAgentProvider("gemini");
    expect(gemini).toBeDefined();
    expect(gemini?.id).toBe("gemini");

    const unknown = getChatAgentProvider("unknown");
    expect(unknown).toBeUndefined();
  });
});

describe("GeminiChatProvider", () => {
  const provider = new GeminiChatProvider();

  it("has correct id and display name", () => {
    expect(provider.id).toBe("gemini");
    expect(provider.displayName).toBe("Google Gemini");
  });

  it("configured status depends on GEMINI_API_KEY", () => {
    expect(provider.configured).toBe(Boolean(process.env.GEMINI_API_KEY?.trim()));
    expect(provider.isAvailable()).toBe(provider.configured);
  });

  it("has free tier models", () => {
    expect(provider.models).toContain("gemini-3.8-flash");
    expect(provider.freeTier).toBe(true);
  });

  it("yields error when API key is missing", async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const events: unknown[] = [];
    for await (const event of provider.streamCompletion({
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: "test" }],
    })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({ type: "error" });
    process.env.GEMINI_API_KEY = original;
  });
});

describe("OpenAIChatProvider", () => {
  const provider = new OpenAIChatProvider();

  it("has correct id and display name", () => {
    expect(provider.id).toBe("openai");
    expect(provider.displayName).toBe("ChatGPT (OpenAI)");
  });

  it("configured status depends on OPENAI_API_KEY", () => {
    expect(provider.configured).toBe(Boolean(process.env.OPENAI_API_KEY?.trim()));
  });

  it("is not free tier", () => {
    expect(provider.freeTier).toBe(false);
  });

  it("yields error when API key is missing", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const events: unknown[] = [];
    for await (const event of provider.streamCompletion({
      model: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
    })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({ type: "error" });
    process.env.OPENAI_API_KEY = original;
  });
});

describe("DeepSeekChatProvider", () => {
  const provider = new DeepSeekChatProvider();

  it("has correct id and display name", () => {
    expect(provider.id).toBe("deepseek");
    expect(provider.displayName).toBe("DeepSeek");
  });

  it("configured status depends on DEEPSEEK_API_KEY", () => {
    expect(provider.configured).toBe(Boolean(process.env.DEEPSEEK_API_KEY?.trim()));
  });

  it("yields error when API key is missing", async () => {
    const original = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const events: unknown[] = [];
    for await (const event of provider.streamCompletion({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "test" }],
    })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({ type: "error" });
    process.env.DEEPSEEK_API_KEY = original;
  });
});

describe("Tool Registry", () => {
  it("exposes read tools", () => {
    expect(isExposed("project.list")).toBe(true);
    expect(isExposed("document.get")).toBe(true);
    expect(isExposed("canon.summary")).toBe(true);
  });

  it("exposes write tools", () => {
    expect(isExposed("document.update")).toBe(true);
    expect(isExposed("entity.create")).toBe(true);
  });

  it("does not expose infrastructure tools", () => {
    expect(isExposed("render.start")).toBe(false);
    expect(isExposed("comfyui.execute")).toBe(false);
    expect(isExposed("veo.generate")).toBe(false);
    expect(isExposed("chat.complete")).toBe(false);
  });

  it("requires approval for write tools", () => {
    expect(requiresApproval("document.update")).toBe(true);
    expect(requiresApproval("entity.create")).toBe(true);
    expect(requiresApproval("scene.update")).toBe(true);
    expect(requiresApproval("pipeline.start")).toBe(true);
  });

  it("does not require approval for read tools", () => {
    expect(requiresApproval("project.list")).toBe(false);
    expect(requiresApproval("document.get")).toBe(false);
    expect(requiresApproval("entity.get")).toBe(false);
  });
});