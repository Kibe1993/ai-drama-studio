import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

import { OllamaChatProvider, fetchOllamaModels, isOllamaReachable } from "@/lib/providers/chat/ollamaChatProvider";
import { getChatAgentProvider, listChatAgentProviders } from "@/lib/providers/chat/registry";
import type { ChatStreamEvent } from "@/lib/assistant/types";

function makeNDJSONStream(lines: string[]): ReadableStream<Uint8Array> {
  const content = lines.join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content));
      controller.close();
    },
  });
}

function makeChunkedNDJSONStream(chunks: string[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const lines of chunks) {
        controller.enqueue(encoder.encode(lines.join("\n") + "\n"));
      }
      controller.close();
    },
  });
}

async function collectEvents(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

const originalFetch = globalThis.fetch;

describe("OllamaChatProvider — metadata", () => {
  const provider = new OllamaChatProvider();

  it("has correct id and displayName", () => {
    expect(provider.id).toBe("ollama");
    expect(provider.displayName).toBe("Ollama");
  });

  it("has qwen3:8b as suggested default model", () => {
    expect(provider.defaultModel).toBe("qwen3:8b");
  });

  it("supports OLLAMA_CHAT_MODEL env override", () => {
    const original = process.env.OLLAMA_CHAT_MODEL;
    process.env.OLLAMA_CHAT_MODEL = "llama3.2:3b";
    expect(provider.defaultModel).toBe("llama3.2:3b");
    if (original === undefined) {
      delete process.env.OLLAMA_CHAT_MODEL;
    } else {
      process.env.OLLAMA_CHAT_MODEL = original;
    }
  });

  it("is free tier with no API key", () => {
    expect(provider.freeTier).toBe(true);
    expect(provider.apiKeyEnvVar).toBe("");
  });

  it("is configured by default (no API key needed)", () => {
    const originalDisabled = process.env.OLLAMA_DISABLED;
    const originalEnabled = process.env.OLLAMA_ENABLED;
    delete process.env.OLLAMA_DISABLED;
    delete process.env.OLLAMA_ENABLED;
    expect(provider.configured).toBe(true);
    expect(provider.isAvailable()).toBe(true);
    process.env.OLLAMA_DISABLED = originalDisabled;
    process.env.OLLAMA_ENABLED = originalEnabled;
  });

  it("is not configured when OLLAMA_DISABLED=true", () => {
    const original = process.env.OLLAMA_DISABLED;
    process.env.OLLAMA_DISABLED = "true";
    expect(provider.configured).toBe(false);
    expect(provider.isAvailable()).toBe(false);
    process.env.OLLAMA_DISABLED = original;
  });

  it("is not configured when OLLAMA_ENABLED=false", () => {
    const original = process.env.OLLAMA_ENABLED;
    process.env.OLLAMA_ENABLED = "false";
    expect(provider.configured).toBe(false);
    process.env.OLLAMA_ENABLED = original;
  });

  it("includes suggested model in models list", () => {
    expect(provider.models).toContain("qwen3:8b");
  });
});

describe("fetchOllamaModels", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns model names from /api/tags", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        models: [
          { name: "qwen3:8b", model: "qwen3:8b", size: 8200000000 },
          { name: "gemma3:4b", model: "gemma3:4b", size: 3300000000 },
          { name: "llama3.2:3b", model: "llama3.2:3b", size: 2000000000 },
        ],
      }), { status: 200 }),
    );

    const models = await fetchOllamaModels("http://127.0.0.1:11434");
    expect(models).toEqual(["qwen3:8b", "gemma3:4b", "llama3.2:3b"]);
  });

  it("returns empty array when no models installed", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );
    const models = await fetchOllamaModels("http://127.0.0.1:11434");
    expect(models).toEqual([]);
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );
    await expect(fetchOllamaModels("http://127.0.0.1:11434")).rejects.toThrow();
  });

  it("throws on connection refused", async () => {
    const connError = new Error("fetch failed");
    (connError as NodeJS.ErrnoException).cause = new Error("ECONNREFUSED");
    globalThis.fetch = vi.fn().mockRejectedValue(connError);
    await expect(fetchOllamaModels("http://127.0.0.1:11434")).rejects.toThrow();
  });
});

describe("isOllamaReachable", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns true when daemon is running", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), { status: 200 }),
    );
    expect(await isOllamaReachable("http://127.0.0.1:11434")).toBe(true);
  });

  it("returns false when daemon is offline", async () => {
    const connError = new Error("fetch failed");
    (connError as NodeJS.ErrnoException).cause = new Error("ECONNREFUSED");
    globalThis.fetch = vi.fn().mockRejectedValue(connError);
    expect(await isOllamaReachable("http://127.0.0.1:11434")).toBe(false);
  });
});

describe("OllamaChatProvider — streamCompletion", () => {
  const provider = new OllamaChatProvider();

  beforeEach(() => {
    const originalDisabled = process.env.OLLAMA_DISABLED;
    const originalEnabled = process.env.OLLAMA_ENABLED;
    delete process.env.OLLAMA_DISABLED;
    delete process.env.OLLAMA_ENABLED;
    return () => {
      process.env.OLLAMA_DISABLED = originalDisabled;
      process.env.OLLAMA_ENABLED = originalEnabled;
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("streams text content as text events", async () => {
    const lines = [
      JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "Hello" }, done: false }),
      JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: " world" }, done: false }),
      JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "!" }, done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 3 }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeNDJSONStream(lines), { status: 200 }),
    );

    const events = await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "Say hello" }],
    }));

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(3);
    expect(textEvents.map((e) => (e as { delta: string }).delta).join("")).toBe("Hello world!");

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect((doneEvent as { finishReason: string }).finishReason).toBe("stop");
  });

  it("emits usage event with token counts", async () => {
    const lines = [
      JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "Hi" }, done: true, done_reason: "stop", prompt_eval_count: 42, eval_count: 7 }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeNDJSONStream(lines), { status: 200 }),
    );

    const events = await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "Hi" }],
    }));

    const usageEvent = events.find((e) => e.type === "usage") as { usage: { promptTokens: number; completionTokens: number; totalTokens: number } };
    expect(usageEvent).toBeDefined();
    expect(usageEvent.usage.promptTokens).toBe(42);
    expect(usageEvent.usage.completionTokens).toBe(7);
    expect(usageEvent.usage.totalTokens).toBe(49);
  });

  it("streams tool calls as tool_call events", async () => {
    const lines = [
      JSON.stringify({
        model: "qwen3:8b",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "project.list", arguments: JSON.stringify({ limit: 5 }) } },
          ],
        },
        done: false,
      }),
      JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 20, eval_count: 5 }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeNDJSONStream(lines), { status: 200 }),
    );

    const events = await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "List projects" }],
      tools: [{ name: "project.list", description: "List projects", inputSchema: { type: "object" } }],
    }));

    const toolCallEvent = events.find((e) => e.type === "tool_call") as { id: string; name: string; args: Record<string, unknown> };
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent.name).toBe("project.list");
    expect(toolCallEvent.args).toEqual({ limit: 5 });
  });

  it("handles chunked NDJSON stream correctly", async () => {
    const chunks = [
      [
        JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "Part1" }, done: false }),
      ],
      [
        JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "Part2" }, done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 2 }),
      ],
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeChunkedNDJSONStream(chunks), { status: 200 }),
    );

    const events = await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "test" }],
    }));

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.map((e) => (e as { delta: string }).delta).join("")).toBe("Part1Part2");
  });

  it("yields clear error when Ollama is offline (ECONNREFUSED)", async () => {
    const connError = new Error("fetch failed");
    (connError as NodeJS.ErrnoException).cause = new Error("ECONNREFUSED");
    globalThis.fetch = vi.fn().mockRejectedValue(connError);

    const events = await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "test" }],
    }));

    const errorEvent = events.find((e) => e.type === "error") as { error: string };
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toContain("offline");
    expect(errorEvent.error).toContain("ollama serve");
  });

  it("yields clear error when model is not found (404)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"error":"model \'nonexistent:latest\' not found"}', { status: 404 }),
    );

    const events = await collectEvents(provider.streamCompletion({
      model: "nonexistent:latest",
      messages: [{ role: "user", content: "test" }],
    }));

    const errorEvent = events.find((e) => e.type === "error") as { error: string };
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toContain("not installed");
    expect(errorEvent.error).toContain("ollama pull");
  });

  it("yields error on HTTP 500", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const events = await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "test" }],
    }));

    const errorEvent = events.find((e) => e.type === "error") as { error: string };
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toContain("500");
  });

  it("yields error when OLLAMA_DISABLED=true", async () => {
    const original = process.env.OLLAMA_DISABLED;
    process.env.OLLAMA_DISABLED = "true";

    const events = await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "test" }],
    }));

    const errorEvent = events.find((e) => e.type === "error") as { error: string };
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toContain("disabled");

    process.env.OLLAMA_DISABLED = original;
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );

    const events = await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "test" }],
      signal: controller.signal,
    }));

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect((doneEvent as { finishReason: string }).finishReason).toBe("stopped");
  });

  it("sends tools in request body when provided", async () => {
    const lines = [
      JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "ok" }, done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 1 }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeNDJSONStream(lines), { status: 200 }),
    );

    await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "project.list", description: "List", inputSchema: { type: "object", properties: {} } }],
    }));

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.tools).toBeDefined();
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe("project.list");
  });

  it("sends temperature and maxTokens in options", async () => {
    const lines = [
      JSON.stringify({ model: "qwen3:8b", message: { role: "assistant", content: "ok" }, done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 1 }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeNDJSONStream(lines), { status: 200 }),
    );

    await collectEvents(provider.streamCompletion({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.3,
      maxTokens: 2048,
    }));

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.options.temperature).toBe(0.3);
    expect(body.options.num_predict).toBe(2048);
  });
});

describe("Ollama provider switching", () => {
  it("registry returns Ollama provider by id", () => {
    const provider = getChatAgentProvider("ollama");
    expect(provider).toBeDefined();
    expect(provider?.id).toBe("ollama");
  });

  it("listChatAgentProviders includes Ollama last", () => {
    const providers = listChatAgentProviders();
    const ids = providers.map((p) => p.id);
    expect(ids).toContain("ollama");
    expect(ids[ids.length - 1]).toBe("ollama");
  });

  it("can switch from Groq to Ollama and back", () => {
    const groq = getChatAgentProvider("groq");
    const ollama = getChatAgentProvider("ollama");
    expect(groq?.id).toBe("groq");
    expect(ollama?.id).toBe("ollama");
    expect(groq).not.toBe(ollama);
  });

  it("Ollama provider info has correct shape", () => {
    const providers = listChatAgentProviders();
    const ollamaInfo = providers.find((p) => p.id === "ollama");
    expect(ollamaInfo).toBeDefined();
    expect(ollamaInfo?.displayName).toBe("Ollama");
    expect(ollamaInfo?.freeTier).toBe(true);
    expect(ollamaInfo?.apiKeyEnvVar).toBe("");
    expect(ollamaInfo?.docsUrl).toBe("https://ollama.com");
    expect(ollamaInfo?.defaultModel).toBe("qwen3:8b");
  });

  it("cloud providers remain unchanged after adding Ollama", () => {
    const providers = listChatAgentProviders();
    const groq = providers.find((p) => p.id === "groq");
    const gemini = providers.find((p) => p.id === "gemini");
    const openai = providers.find((p) => p.id === "openai");
    const deepseek = providers.find((p) => p.id === "deepseek");

    expect(groq?.models).toContain("openai/gpt-oss-120b");
    expect(gemini?.models).toContain("gemini-3.8-flash");
    expect(openai?.models).toContain("gpt-4o");
    expect(deepseek?.models).toContain("deepseek-chat");
  });
});