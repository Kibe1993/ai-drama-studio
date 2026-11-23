import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  log: logMock,
}));

import { ollamaChat, OllamaLLMProvider } from "@/lib/providers/llm/ollama";
import type { StoryBibleTaskInput } from "@/lib/providers/llm/storyBibleTask";
import type { CharacterPrompt } from "@/lib/providers/llm/stageTasks";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ollamaChatResponse(
  content: string,
  timing: {
    promptTokens?: number;
    evalTokens?: number;
    loadDuration?: number;
    promptEvalDuration?: number;
    evalDuration?: number;
    totalDuration?: number;
    doneReason?: string;
  } = {}
): Response {
  return jsonResponse({
    model: "gemma3:4b",
    created_at: new Date().toISOString(),
    message: { role: "assistant", content },
    done: true,
    done_reason: timing.doneReason ?? "stop",
    prompt_eval_count: timing.promptTokens ?? 25,
    eval_count: timing.evalTokens ?? 150,
    load_duration: timing.loadDuration ?? 1_000_000_000,
    prompt_eval_duration: timing.promptEvalDuration ?? 5_000_000_000,
    eval_duration: timing.evalDuration ?? 20_000_000_000,
    total_duration: timing.totalDuration ?? 26_000_000_000,
  });
}

function findLog(
  calls: ReturnType<typeof vi.fn>["mock"]["calls"],
  message: string
): Record<string, unknown> | undefined {
  const call = calls.find((c) => c[1] === message);
  return call?.[2] as Record<string, unknown> | undefined;
}

describe("Ollama instrumentation logging", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("request log", () => {
    it("logs stage, model, numCtx, numPredict, formatMode, and stream on every request", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(ollamaChatResponse('{"ok":true}'));

      await ollamaChat({
        prompt: "test",
        stage: "story_bible:identity",
        model: "gemma3:4b",
        format: "json",
        stream: false,
        options: { num_ctx: 8192, num_predict: 1500 },
      });

      const fields = findLog(logMock.info.mock.calls, "request");
      expect(fields).toBeDefined();
      expect(fields!.stage).toBe("story_bible:identity");
      expect(fields!.model).toBe("gemma3:4b");
      expect(fields!.numCtx).toBe(8192);
      expect(fields!.numPredict).toBe(1500);
      expect(fields!.formatMode).toBe("json");
      expect(fields!.stream).toBe(false);
    });

    it("logs formatMode 'schema' when format is an object", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(ollamaChatResponse('{"ok":true}'));

      await ollamaChat({
        prompt: "test",
        stage: "story",
        format: { type: "object" },
        stream: true,
      });

      const fields = findLog(logMock.info.mock.calls, "request");
      expect(fields!.formatMode).toBe("schema");
      expect(fields!.stream).toBe(true);
    });

    it("logs formatMode 'none' when format is undefined", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(ollamaChatResponse("plain text"));

      await ollamaChat({ prompt: "test", stage: "complete" });

      const fields = findLog(logMock.info.mock.calls, "request");
      expect(fields!.formatMode).toBe("none");
    });

    it("defaults stage to 'unknown' when not provided", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(ollamaChatResponse("ok"));

      await ollamaChat({ prompt: "test" });

      const fields = findLog(logMock.info.mock.calls, "request");
      expect(fields!.stage).toBe("unknown");
    });
  });

  describe("non-streaming response log", () => {
    it("logs all timing fields including tokensPerSec and doneReason", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse('{"ok":true}', {
          promptTokens: 100,
          evalTokens: 200,
          loadDuration: 2_000_000_000,
          promptEvalDuration: 10_000_000_000,
          evalDuration: 30_000_000_000,
          totalDuration: 42_000_000_000,
          doneReason: "stop",
        })
      );

      await ollamaChat({ prompt: "test", stage: "story" });

      const fields = findLog(logMock.info.mock.calls, "response");
      expect(fields).toBeDefined();
      expect(fields!.stage).toBe("story");
      expect(fields!.stream).toBe(false);
      expect(fields!.loadDurationNs).toBe(2_000_000_000);
      expect(fields!.promptEvalDurationNs).toBe(10_000_000_000);
      expect(fields!.evalDurationNs).toBe(30_000_000_000);
      expect(fields!.totalDurationNs).toBe(42_000_000_000);
      expect(fields!.inputTokens).toBe(100);
      expect(fields!.outputTokens).toBe(200);
      expect(fields!.tokensPerSec).toBe(6.67);
      expect(fields!.doneReason).toBe("stop");
    });

    it("logs doneReason 'length' when output hit num_predict ceiling", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse('{"ok":true}', { doneReason: "length" })
      );

      const result = await ollamaChat({ prompt: "test", stage: "story" });

      const fields = findLog(logMock.info.mock.calls, "response");
      expect(fields!.doneReason).toBe("length");
      expect(result.truncated).toBe(true);
    });
  });

  describe("streaming response log", () => {
    it("logs ttftMs and all timing fields from the final chunk", async () => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ message: { content: '{"title":' } }) + "\n"
            )
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                message: { content: '"Test"}' },
                done: true,
                done_reason: "stop",
                prompt_eval_count: 50,
                eval_count: 100,
                load_duration: 3_000_000_000,
                prompt_eval_duration: 8_000_000_000,
                eval_duration: 15_000_000_000,
                total_duration: 26_000_000_000,
              })
            )
          );
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        })
      );

      await ollamaChat({
        prompt: "test",
        stage: "story_bible:characters",
        stream: true,
      });

      const fields = findLog(logMock.info.mock.calls, "response");
      expect(fields).toBeDefined();
      expect(fields!.stage).toBe("story_bible:characters");
      expect(fields!.stream).toBe(true);
      expect(fields!.ttftMs).not.toBe("");
      expect(fields!.ttftMs).not.toBe(undefined);
      expect(fields!.loadDurationNs).toBe(3_000_000_000);
      expect(fields!.promptEvalDurationNs).toBe(8_000_000_000);
      expect(fields!.evalDurationNs).toBe(15_000_000_000);
      expect(fields!.totalDurationNs).toBe(26_000_000_000);
      expect(fields!.inputTokens).toBe(50);
      expect(fields!.outputTokens).toBe(100);
      expect(fields!.tokensPerSec).toBe(6.67);
      expect(fields!.doneReason).toBe("stop");
    });
  });

  describe("timeout log", () => {
    it("logs stage, elapsedMs, partialTokens, and partialChars on non-streaming timeout", async () => {
      const timeoutError = new Error("The operation was aborted due to timeout");
      timeoutError.name = "TimeoutError";
      globalThis.fetch = vi.fn().mockRejectedValue(timeoutError);

      await expect(
        ollamaChat({
          prompt: "test",
          stage: "story_bible:characters",
          timeoutMs: 5000,
        })
      ).rejects.toMatchObject({ code: "timeout" });

      const fields = findLog(logMock.error.mock.calls, "timeout");
      expect(fields).toBeDefined();
      expect(fields!.stage).toBe("story_bible:characters");
      expect(fields!.configuredTimeoutMs).toBe(5000);
      expect(fields!.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(fields!.partialTokens).toBe(0);
      expect(fields!.partialChars).toBe(0);
      expect(fields!.signalSource).toBe("internal");
      expect(fields!.abortedBy).toBe("own_timeout");
    });

    it("logs partial token count when streaming is aborted mid-generation", async () => {
      let pulled = false;

      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!pulled) {
            pulled = true;
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  message: { content: '{"title":"Partial' },
                  eval_count: 42,
                }) + "\n"
              )
            );
          } else {
            const err = new Error("aborted") as Error & { name: string };
            err.name = "TimeoutError";
            throw err;
          }
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        })
      );

      await expect(
        ollamaChat({
          prompt: "test",
          stage: "story_bible:characters",
          stream: true,
          timeoutMs: 5000,
        })
      ).rejects.toMatchObject({ code: "timeout" });

      const fields = findLog(logMock.error.mock.calls, "timeout");
      expect(fields).toBeDefined();
      expect(fields!.stage).toBe("story_bible:characters");
      expect(fields!.partialTokens).toBe(42);
      expect(fields!.partialChars).toBeGreaterThan(0);
    });
  });

  describe("stage labels through provider methods", () => {
    it("passes stage='story' from generateStory", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(
          JSON.stringify({
            title: "T",
            synopsis: "S",
            structure: { act1: {}, act2: {}, act3: {} },
            screenplay: [],
          })
        )
      );

      const provider = new OllamaLLMProvider();
      try {
        await provider.generateStory({
          title: "T",
          idea: "I",
          genre: "drama",
          language: "en",
          visualStyle: "realistic",
          tone: "serious",
          targetDurationSeconds: 60,
          aspectRatio: "16:9",
        });
      } catch {
        // parsing may fail, that's fine
      }

      const fields = findLog(logMock.info.mock.calls, "request");
      expect(fields).toBeDefined();
      expect(fields!.stage).toBe("story");
    });

    it("passes stage='complete' from complete()", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(ollamaChatResponse("done"));

      const provider = new OllamaLLMProvider();
      await provider.complete({ prompt: "test" });

      const fields = findLog(logMock.info.mock.calls, "request");
      expect(fields!.stage).toBe("complete");
    });

    it("passes stage='story_bible:identity' for section transport", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(
          JSON.stringify({
            title: "T",
            genres: ["D"],
            subgenres: [],
            centralPremise: "P",
            narrativeConcept: "C",
            toneAndAtmosphere: "T",
            targetAudience: "A",
            centralConflict: "C",
          })
        )
      );

      const provider = new OllamaLLMProvider();
      const input: StoryBibleTaskInput = {
        mode: "section",
        section: "identity",
        idea: "test",
      };
      try {
        await provider.generateStoryBible(input);
      } catch {
        // may fail on validation, that's fine
      }

      const fields = findLog(logMock.info.mock.calls, "request");
      expect(fields).toBeDefined();
      expect(fields!.stage).toBe("story_bible:identity");
    });

    it("passes stage='stage' for stage transport (characters)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        ollamaChatResponse(
          JSON.stringify({
            characters: [{ name: "Ada", role: "protagonist" }],
          })
        )
      );

      const provider = new OllamaLLMProvider();
      const input: CharacterPrompt = {
        title: "T",
        screenplay: [
          {
            sceneNumber: 1,
            heading: "INT. ROOM - DAY",
            location: "Room",
            timeOfDay: "Day",
            charactersPresent: ["Ada"],
            visualDescription: "V",
            action: "A",
            dialogue: [],
          },
        ],
      };
      try {
        await provider.generateCharacters(input);
      } catch {
        // may fail on validation, that's fine
      }

      const fields = findLog(logMock.info.mock.calls, "request");
      expect(fields).toBeDefined();
      expect(fields!.stage).toBe("stage");
    });
  });
});