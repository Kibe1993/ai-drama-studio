import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { JobError } from "@/lib/pipeline/types";
import { buildSlots, createStoryProvider, providerSequence, LLM_PROVIDER_IDS } from "@/lib/providers/llm/registry";
import { LmStudioLLMProvider } from "@/lib/providers/llm/lmstudio";

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LLM_PROVIDER: "ollama",
  LLM_FALLBACK_PROVIDERS: "groq,openrouter,mistral",
  LLM_FREE_ONLY: "false",
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL: "test-model",
  LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  LMSTUDIO_MODEL: "qwen3-4b-instruct-2507",
  LMSTUDIO_API_KEY: "lm-studio",
  LMSTUDIO_ENABLED: "true",
};

describe("LLM_TEST_MODE=lmstudio exclusive mode", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...baseEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("buildSlots returns only LM Studio when LLM_TEST_MODE=lmstudio", () => {
    process.env.LLM_TEST_MODE = "lmstudio";
    const slots = buildSlots(process.env);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.id).toBe("lmstudio");
  });

  it("buildSlots returns multiple providers when LLM_TEST_MODE is unset", () => {
    delete process.env.LLM_TEST_MODE;
    const slots = buildSlots(process.env);
    expect(slots.length).toBeGreaterThan(1);
    expect(slots.some((s) => s.id === "lmstudio")).toBe(false);
  });

  it("buildSlots returns multiple providers when LLM_TEST_MODE is empty", () => {
    process.env.LLM_TEST_MODE = "";
    const slots = buildSlots(process.env);
    expect(slots.length).toBeGreaterThan(1);
  });

  it("buildSlots returns multiple providers when LLM_TEST_MODE is a different value", () => {
    process.env.LLM_TEST_MODE = "normal";
    const slots = buildSlots(process.env);
    expect(slots.length).toBeGreaterThan(1);
  });

  it("LM Studio slot is configured when LMSTUDIO_ENABLED=true", () => {
    process.env.LLM_TEST_MODE = "lmstudio";
    process.env.LMSTUDIO_ENABLED = "true";
    const slots = buildSlots(process.env);
    expect(slots[0]!.configured).toBe(true);
    expect(slots[0]!.supported).not.toBe(false);
  });

  it("LM Studio slot is not configured when LMSTUDIO_ENABLED=false", () => {
    process.env.LLM_TEST_MODE = "lmstudio";
    process.env.LMSTUDIO_ENABLED = "false";
    const slots = buildSlots(process.env);
    expect(slots[0]!.configured).toBe(false);
  });

  it("createStoryProvider returns a manager with a single LM Studio slot", () => {
    process.env.LLM_TEST_MODE = "lmstudio";
    const provider = createStoryProvider(process.env);
    expect(provider).toBeDefined();
    expect(provider.id).toBe("lmstudio");
  });

  it("LM Studio is in LLM_PROVIDER_IDS", () => {
    expect(LLM_PROVIDER_IDS).toContain("lmstudio");
  });

  it("providerSequence includes lmstudio as primary with no fallbacks in test mode", () => {
    const seq = providerSequence({ LLM_PROVIDER: "lmstudio", LLM_FALLBACK_PROVIDERS: "" });
    expect(seq).toEqual(["lmstudio"]);
  });

  it("exclusive mode is reversible by unsetting LLM_TEST_MODE", () => {
    process.env.LLM_TEST_MODE = "lmstudio";
    const exclusiveSlots = buildSlots(process.env);
    expect(exclusiveSlots).toHaveLength(1);
    expect(exclusiveSlots[0]!.id).toBe("lmstudio");

    delete process.env.LLM_TEST_MODE;
    const normalSlots = buildSlots(process.env);
    expect(normalSlots.length).toBeGreaterThan(1);
    expect(normalSlots[0]!.id).toBe("ollama");
  });

  it("exclusive mode is reversible by setting LLM_TEST_MODE to a different value", () => {
    process.env.LLM_TEST_MODE = "lmstudio";
    const exclusiveSlots = buildSlots(process.env);
    expect(exclusiveSlots).toHaveLength(1);

    process.env.LLM_TEST_MODE = "normal";
    const normalSlots = buildSlots(process.env);
    expect(normalSlots.length).toBeGreaterThan(1);
  });
});

describe("LM Studio provider in exclusive mode — failure reporting", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...baseEnv, LLM_TEST_MODE: "lmstudio" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports LM Studio failure without falling back to other providers", async () => {
    const slots = buildSlots(process.env);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.id).toBe("lmstudio");

    const error = new JobError("LM Studio failed.", "provider_failed", false);
    vi.spyOn(slots[0]!, "generate" as never).mockRejectedValueOnce(error as never);

    await expect(
      slots[0]!.generate(
        {
          title: "Test",
          idea: "Test idea",
          genre: "drama",
          language: "en",
          visualStyle: "realistic",
          tone: "serious",
          targetDurationSeconds: 300,
          aspectRatio: "16:9",
        },
        { signal: AbortSignal.timeout(5_000) },
      ),
    ).rejects.toThrow("LM Studio failed.");
  });

  it("does not include cloud providers in exclusive mode", () => {
    process.env.LLM_TEST_MODE = "lmstudio";
    const slots = buildSlots(process.env);
    const providerIds = slots.map((s) => s.id);
    expect(providerIds).not.toContain("groq");
    expect(providerIds).not.toContain("openrouter");
    expect(providerIds).not.toContain("mistral");
    expect(providerIds).not.toContain("gemini");
    expect(providerIds).not.toContain("openai");
    expect(providerIds).not.toContain("anthropic");
    expect(providerIds).not.toContain("deepseek");
    expect(providerIds).not.toContain("ollama");
  });
});

describe("LM Studio provider adapter", () => {
  it("creates an LmStudioLLMProvider instance through the adapter", () => {
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      LMSTUDIO_BASE_URL: "http://localhost:1234/v1",
      LMSTUDIO_MODEL: "test-model",
      LMSTUDIO_API_KEY: "test-key",
    };
    const slots = buildSlots({ ...env, LLM_TEST_MODE: "lmstudio" });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.id).toBe("lmstudio");
    expect(slots[0]!.model).toBe("test-model");
    expect(slots[0]!.configured).toBe(true);
  });

  it("LM Studio slot has timeout properties set", () => {
    const slots = buildSlots({ ...baseEnv, LLM_TEST_MODE: "lmstudio" });
    expect(slots[0]!.timeoutMs).toBeDefined();
    expect(slots[0]!.sectionTimeoutMs).toBeDefined();
    expect(slots[0]!.storyTimeoutMs).toBeDefined();
    expect(slots[0]!.timeoutMs).toBe(900_000);
    expect(slots[0]!.sectionTimeoutMs).toBe(600_000);
    expect(slots[0]!.storyTimeoutMs).toBe(900_000);
  });
});