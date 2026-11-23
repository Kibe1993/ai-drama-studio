import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DEFAULT_LMSTUDIO_BASE_URL,
  DEFAULT_LMSTUDIO_MODEL,
  DEFAULT_LMSTUDIO_API_KEY,
  DEFAULT_LMSTUDIO_TIMEOUT_MS,
  DEFAULT_LMSTUDIO_SECTION_TIMEOUT_MS,
  DEFAULT_LMSTUDIO_STORY_TIMEOUT_MS,
  LmStudioLLMProvider,
  checkLmStudioHealth,
  lmstudioBaseUrl,
  lmstudioModel,
  lmstudioApiKey,
  lmstudioTimeoutMs,
  lmstudioSectionTimeoutMs,
  lmstudioStoryTimeoutMs,
  lmstudioEnabled,
  createLmStudioProvider,
} from "@/lib/providers/llm/lmstudio";

describe("LM Studio environment readers", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns default base URL when env is unset", () => {
    delete process.env.LMSTUDIO_BASE_URL;
    expect(lmstudioBaseUrl()).toBe(DEFAULT_LMSTUDIO_BASE_URL);
  });

  it("returns configured base URL and strips trailing slashes", () => {
    process.env.LMSTUDIO_BASE_URL = "http://localhost:1234/v1///";
    expect(lmstudioBaseUrl()).toBe("http://localhost:1234/v1");
  });

  it("returns default model when env is unset", () => {
    delete process.env.LMSTUDIO_MODEL;
    expect(lmstudioModel()).toBe(DEFAULT_LMSTUDIO_MODEL);
  });

  it("returns configured model", () => {
    process.env.LMSTUDIO_MODEL = "custom-model";
    expect(lmstudioModel()).toBe("custom-model");
  });

  it("returns default API key when env is unset", () => {
    delete process.env.LMSTUDIO_API_KEY;
    expect(lmstudioApiKey()).toBe(DEFAULT_LMSTUDIO_API_KEY);
  });

  it("returns configured API key", () => {
    process.env.LMSTUDIO_API_KEY = "my-key";
    expect(lmstudioApiKey()).toBe("my-key");
  });

  it("returns default timeout when env is unset", () => {
    delete process.env.LMSTUDIO_TIMEOUT_MS;
    expect(lmstudioTimeoutMs()).toBe(DEFAULT_LMSTUDIO_TIMEOUT_MS);
  });

  it("clamps timeout to minimum 10s", () => {
    process.env.LMSTUDIO_TIMEOUT_MS = "5000";
    expect(lmstudioTimeoutMs()).toBe(10_000);
  });

  it("clamps timeout to maximum 1h", () => {
    process.env.LMSTUDIO_TIMEOUT_MS = "999999999";
    expect(lmstudioTimeoutMs()).toBe(3_600_000);
  });

  it("returns configured section timeout", () => {
    process.env.LMSTUDIO_SECTION_TIMEOUT_MS = "300000";
    expect(lmstudioSectionTimeoutMs()).toBe(300_000);
  });

  it("returns default section timeout when env is unset", () => {
    delete process.env.LMSTUDIO_SECTION_TIMEOUT_MS;
    expect(lmstudioSectionTimeoutMs()).toBe(DEFAULT_LMSTUDIO_SECTION_TIMEOUT_MS);
  });

  it("returns configured story timeout", () => {
    process.env.LMSTUDIO_STORY_TIMEOUT_MS = "600000";
    expect(lmstudioStoryTimeoutMs()).toBe(600_000);
  });

  it("returns default story timeout when env is unset", () => {
    delete process.env.LMSTUDIO_STORY_TIMEOUT_MS;
    expect(lmstudioStoryTimeoutMs()).toBe(DEFAULT_LMSTUDIO_STORY_TIMEOUT_MS);
  });

  it("returns true when LMSTUDIO_ENABLED is unset", () => {
    delete process.env.LMSTUDIO_ENABLED;
    expect(lmstudioEnabled()).toBe(true);
  });

  it("returns false when LMSTUDIO_ENABLED is false", () => {
    process.env.LMSTUDIO_ENABLED = "false";
    expect(lmstudioEnabled()).toBe(false);
  });

  it("returns false when LMSTUDIO_ENABLED is 0", () => {
    process.env.LMSTUDIO_ENABLED = "0";
    expect(lmstudioEnabled()).toBe(false);
  });

  it("returns false when LMSTUDIO_ENABLED is off", () => {
    process.env.LMSTUDIO_ENABLED = "off";
    expect(lmstudioEnabled()).toBe(false);
  });

  it("returns true when LMSTUDIO_ENABLED is true", () => {
    process.env.LMSTUDIO_ENABLED = "true";
    expect(lmstudioEnabled()).toBe(true);
  });
});

describe("LmStudioLLMProvider", () => {
  it("uses defaults when no options provided", () => {
    const provider = new LmStudioLLMProvider();
    expect(provider.id).toBe("lmstudio");
    expect(provider.model).toBe(DEFAULT_LMSTUDIO_MODEL);
    expect(provider.baseURL).toBe(DEFAULT_LMSTUDIO_BASE_URL);
    expect(provider.apiKey).toBe(DEFAULT_LMSTUDIO_API_KEY);
    expect(provider.timeoutMs).toBe(DEFAULT_LMSTUDIO_TIMEOUT_MS);
    expect(provider.sectionTimeoutMs).toBe(DEFAULT_LMSTUDIO_SECTION_TIMEOUT_MS);
    expect(provider.storyTimeoutMs).toBe(DEFAULT_LMSTUDIO_STORY_TIMEOUT_MS);
  });

  it("uses provided options", () => {
    const provider = new LmStudioLLMProvider({
      model: "test-model",
      baseURL: "http://localhost:9999/v1",
      apiKey: "test-key",
      timeoutMs: 120_000,
      sectionTimeoutMs: 300_000,
      storyTimeoutMs: 600_000,
    });
    expect(provider.model).toBe("test-model");
    expect(provider.baseURL).toBe("http://localhost:9999/v1");
    expect(provider.apiKey).toBe("test-key");
    expect(provider.timeoutMs).toBe(120_000);
    expect(provider.sectionTimeoutMs).toBe(300_000);
    expect(provider.storyTimeoutMs).toBe(600_000);
  });

  it("strips trailing slashes from baseURL", () => {
    const provider = new LmStudioLLMProvider({
      baseURL: "http://localhost:1234/v1///",
    });
    expect(provider.baseURL).toBe("http://localhost:1234/v1");
  });

  it("exposes all required LLMProvider capabilities", () => {
    const provider = new LmStudioLLMProvider();
    expect(typeof provider.generateStory).toBe("function");
    expect(typeof provider.generateCharacters).toBe("function");
    expect(typeof provider.generateScenes).toBe("function");
    expect(typeof provider.generateStoryBible).toBe("function");
    expect(typeof provider.generateEpisodeSuggestion).toBe("function");
    expect(typeof provider.continueStory).toBe("function");
    expect(typeof provider.generateSeasonPlan).toBe("function");
    expect(typeof provider.generateSeasonArchitecture).toBe("function");
    expect(typeof provider.generateEpisodeDetails).toBe("function");
    expect(typeof provider.repairScenes).toBe("function");
    expect(typeof provider.reviseEpisode).toBe("function");
    expect(typeof provider.critiqueStory).toBe("function");
    expect(typeof provider.generateCanonSuggestions).toBe("function");
    expect(typeof provider.generateCanonFacts).toBe("function");
  });

  it("createLmStudioProvider returns a provider with the right id", () => {
    const provider = createLmStudioProvider("custom", "http://localhost:1234/v1", "key");
    expect(provider.id).toBe("lmstudio");
    expect(provider.model).toBe("custom");
  });
});

describe("checkLmStudioHealth", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns unavailable when fetch throws ECONNREFUSED", async () => {
    globalThis.fetch = vi.fn(async () => {
      const error = new Error("fetch failed");
      (error as Error & { cause: { code: string } }).cause = { code: "ECONNREFUSED" };
      throw error;
    }) as typeof fetch;

    const result = await checkLmStudioHealth("http://127.0.0.1:1234/v1", "test-model");
    expect(result.status).toBe("unavailable");
    expect(result.serverRunning).toBe(false);
    expect(result.modelLoaded).toBe(false);
    expect(result.detail).toContain("not running");
  });

  it("returns server_running when API responds but model not in list", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ id: "other-model" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as typeof fetch;

    const result = await checkLmStudioHealth("http://127.0.0.1:1234/v1", "target-model");
    expect(result.status).toBe("server_running");
    expect(result.serverRunning).toBe(true);
    expect(result.modelLoaded).toBe(false);
    expect(result.detail).toContain("not loaded");
    expect(result.models).toEqual(["other-model"]);
  });

  it("returns model_loaded when model is in the list", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ id: "qwen3-4b-instruct-2507" }, { id: "other-model" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as typeof fetch;

    const result = await checkLmStudioHealth("http://127.0.0.1:1234/v1", "qwen3-4b-instruct-2507");
    expect(result.status).toBe("model_loaded");
    expect(result.serverRunning).toBe(true);
    expect(result.modelLoaded).toBe(true);
    expect(result.detail).toContain("loaded and available");
  });

  it("returns model_loaded when model id contains the target", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ id: "qwen3-4b-instruct-2507-Q4_K_M" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ) as typeof fetch;

    const result = await checkLmStudioHealth("http://127.0.0.1:1234/v1", "qwen3-4b-instruct-2507");
    expect(result.status).toBe("model_loaded");
    expect(result.modelLoaded).toBe(true);
  });

  it("returns server_running when API responds with non-200 status", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("Internal Server Error", { status: 500 })
    ) as typeof fetch;

    const result = await checkLmStudioHealth("http://127.0.0.1:1234/v1", "test-model");
    expect(result.status).toBe("server_running");
    expect(result.serverRunning).toBe(true);
    expect(result.modelLoaded).toBe(false);
    expect(result.detail).toContain("500");
  });

  it("returns unavailable on generic fetch error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network error");
    }) as typeof fetch;

    const result = await checkLmStudioHealth("http://127.0.0.1:1234/v1", "test-model");
    expect(result.status).toBe("unavailable");
    expect(result.serverRunning).toBe(false);
    expect(result.detail).toContain("Network error");
  });
});