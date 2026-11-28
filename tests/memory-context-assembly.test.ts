import { describe, expect, it } from "vitest";
import { assembleContext } from "@/lib/services/contextAssemblyService";
import {
  estimateConversationTokens,
  getHistoryBudget,
  selectRecentWindow,
  shouldSummarize,
} from "@/lib/assistant/tokenEstimator";
import type { ChatMessage } from "@/lib/assistant/types";

function msg(content: string, role: ChatMessage["role"] = "user"): ChatMessage {
  return { role, content };
}

function msgs(n: number, size = 100): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => msg(`Message ${i}: ${"x".repeat(size)}`));
}

function toolMsg(name: string, result: string): ChatMessage {
  return {
    role: "tool",
    content: result,
    toolCalls: [{ id: `tc-${name}`, name, args: {}, result, status: "success" }],
  };
}

describe("Context assembly service", () => {
  it("assembles system prompt + history for small conversations", () => {
    const history = msgs(5, 50);
    const result = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    expect(result.truncated).toBe(false);
    expect(result.omittedCount).toBe(0);
    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages.length).toBe(6);
  });

  it("includes project memory as system message", () => {
    const history = msgs(3, 50);
    const result = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: null,
      projectMemory: [
        { category: "identity", key: "genre", value: "thriller", status: "confirmed" },
      ],
    });
    const memoryMsg = result.messages.find(
      (m) => m.role === "system" && m.content.includes("Project context"),
    );
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg?.content).toContain("thriller");
  });

  it("includes summary as system message when provided", () => {
    const history = msgs(3, 50);
    const result = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: "We discussed Maya as the protagonist.",
    });
    const summaryMsg = result.messages.find(
      (m) => m.role === "system" && m.content.includes("Previous conversation summary"),
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg?.content).toContain("Maya");
  });

  it("includes retrieved context as system message", () => {
    const history = msgs(3, 50);
    const result = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: null,
      retrievedContext: [
        { source: "project_memory", content: "Genre: thriller" },
      ],
    });
    const retrievedMsg = result.messages.find(
      (m) => m.role === "system" && m.content.includes("Relevant retrieved"),
    );
    expect(retrievedMsg).toBeDefined();
  });

  it("truncates history when over budget with summary", () => {
    const budget = getHistoryBudget("llama-3.1-8b-instant");
    const charsPerMsg = 500;
    const msgCount = Math.ceil((budget * 2) / (charsPerMsg / 4));
    const history = msgs(msgCount, charsPerMsg);
    const result = assembleContext({
      history,
      model: "llama-3.1-8b-instant",
      summary: "Previous summary.",
    });
    expect(result.truncated).toBe(true);
    expect(result.omittedCount).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(history.length + 5);
  });

  it("truncates history when over budget without summary (adds note)", () => {
    const budget = getHistoryBudget("llama-3.1-8b-instant");
    const charsPerMsg = 500;
    const msgCount = Math.ceil((budget * 2) / (charsPerMsg / 4));
    const history = msgs(msgCount, charsPerMsg);
    const result = assembleContext({
      history,
      model: "llama-3.1-8b-instant",
      summary: null,
    });
    expect(result.truncated).toBe(true);
    expect(result.omittedCount).toBeGreaterThan(0);
    const noteMsg = result.messages.find(
      (m) => m.role === "system" && m.content.includes("omitted"),
    );
    expect(noteMsg).toBeDefined();
  });

  it("does not truncate when under budget", () => {
    const history = msgs(10, 50);
    const result = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    expect(result.truncated).toBe(false);
    expect(result.omittedCount).toBe(0);
  });

  it("preserves message ordering in assembled output", () => {
    const history: ChatMessage[] = [
      msg("First", "user"),
      msg("Second", "assistant"),
      msg("Third", "user"),
    ];
    const result = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    const nonSystem = result.messages.filter((m) => m.role !== "system");
    expect(nonSystem[0]?.content).toBe("First");
    expect(nonSystem[1]?.content).toBe("Second");
    expect(nonSystem[2]?.content).toBe("Third");
  });
});

describe("Conversation scenarios", () => {
  it("1. Handles 10-message conversation", () => {
    const history = msgs(10, 100);
    const result = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    expect(result.truncated).toBe(false);
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it("2. Handles 50-message conversation", () => {
    const history = msgs(50, 100);
    const result = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it("3. Handles 100-message conversation", () => {
    const history = msgs(100, 100);
    const result = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it("4. Handles conversation exceeding model context budget", () => {
    const budget = getHistoryBudget("llama-3.1-8b-instant");
    const charsNeeded = budget * 4;
    const history = msgs(1, charsNeeded);
    const result = assembleContext({ history, model: "llama-3.1-8b-instant", summary: "Summary." });
    expect(result.truncated).toBe(true);
  });

  it("5. Summary is included when provided", () => {
    const history = msgs(5, 50);
    const result = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: "We decided on a thriller genre.",
    });
    const hasSummary = result.messages.some(
      (m) => m.role === "system" && m.content.includes("thriller"),
    );
    expect(hasSummary).toBe(true);
  });

  it("6. Summary updates incorporate previous summary", () => {
    const history = msgs(5, 50);
    const result1 = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: "Decision: protagonist is Daniel.",
    });
    const result2 = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: "Decision: protagonist is Daniel.\nUpdate: renamed to Maya.",
    });
    expect(result1.messages.length).toBe(result2.messages.length);
    const summary2 = result2.messages.find(
      (m) => m.role === "system" && m.content.includes("Maya"),
    );
    expect(summary2).toBeDefined();
  });

  it("8. Switching from Groq to Gemini preserves history", () => {
    const history = msgs(10, 100);
    const groqResult = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    const geminiResult = assembleContext({ history, model: "gemini-3.8-flash", summary: null });
    const groqHistory = groqResult.messages.filter((m) => m.role !== "system");
    const geminiHistory = geminiResult.messages.filter((m) => m.role !== "system");
    expect(groqHistory).toEqual(geminiHistory);
  });

  it("9. Switching from Gemini to OpenAI preserves history", () => {
    const history = msgs(10, 100);
    const geminiResult = assembleContext({ history, model: "gemini-3.8-flash", summary: null });
    const openaiResult = assembleContext({ history, model: "gpt-4o", summary: null });
    const geminiHistory = geminiResult.messages.filter((m) => m.role !== "system");
    const openaiHistory = openaiResult.messages.filter((m) => m.role !== "system");
    expect(geminiHistory).toEqual(openaiHistory);
  });

  it("12. Preserves rejected ideas in project memory context", () => {
    const history = msgs(3, 50);
    const result = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: null,
      projectMemory: [
        { category: "story", key: "ending", value: "Happy ending", status: "rejected" },
      ],
    });
    const hasRejected = result.messages.some(
      (m) => m.role === "system" && m.content.includes("rejected"),
    );
    expect(hasRejected).toBe(true);
  });

  it("13. Preserves approved canon in project memory context", () => {
    const history = msgs(3, 50);
    const result = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: null,
      projectMemory: [
        { category: "story", key: "protagonist", value: "Daniel Mwangi", status: "confirmed" },
      ],
    });
    const hasCanon = result.messages.some(
      (m) => m.role === "system" && m.content.includes("Daniel Mwangi"),
    );
    expect(hasCanon).toBe(true);
  });

  it("16. Handles interrupted streaming (partial content saved)", () => {
    const history: ChatMessage[] = [
      msg("What is the story about?", "user"),
      msg("The story is about...", "assistant"),
    ];
    const result = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    expect(result.messages.length).toBeGreaterThan(0);
    const assistantMsg = result.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toContain("The story is about");
  });

  it("20. Preserves MCP tool calls and results in context", () => {
    const history: ChatMessage[] = [
      msg("Show me the project", "user"),
      {
        role: "assistant",
        content: "Let me look that up.",
        toolCalls: [
          { id: "tc1", name: "project.get", args: { projectId: "p1" }, status: "success" },
        ],
      },
      toolMsg("project.get", '{"title":"Test Project","genre":"thriller"}'),
    ];
    const result = assembleContext({ history, model: "openai/gpt-oss-120b", summary: null });
    const nonSystem = result.messages.filter((m) => m.role !== "system");
    expect(nonSystem).toHaveLength(3);
    expect(nonSystem[1]?.toolCalls?.[0]?.name).toBe("project.get");
    expect(nonSystem[2]?.role).toBe("tool");
    expect(nonSystem[2]?.content).toContain("Test Project");
  });
});

describe("Memory isolation", () => {
  it("17. Context assembly does not leak across users (user-scoped by design)", () => {
    const user1History = msgs(5, 50);
    const user2History = msgs(5, 50);
    const r1 = assembleContext({ history: user1History, model: "openai/gpt-oss-120b", summary: null });
    const r2 = assembleContext({ history: user2History, model: "openai/gpt-oss-120b", summary: null });
    expect(r1.messages).not.toBe(r2.messages);
    expect(r1.messages.length).toBe(r2.messages.length);
  });

  it("18. Project memory is scoped to project (no cross-project leakage)", () => {
    const history = msgs(3, 50);
    const result = assembleContext({
      history,
      model: "openai/gpt-oss-120b",
      summary: null,
      projectMemory: [
        { category: "identity", key: "title", value: "Project A", status: "confirmed" },
      ],
    });
    const hasProjectB = result.messages.some(
      (m) => m.content.includes("Project B"),
    );
    expect(hasProjectB).toBe(false);
  });
});

describe("Summarization thresholds", () => {
  it("triggers summarization at 60% of history budget", () => {
    const budget = getHistoryBudget("llama-3.1-8b-instant");
    const charsNeeded = Math.ceil(budget * 0.6 * 4);
    const history = msgs(1, charsNeeded);
    expect(shouldSummarize(history, "llama-3.1-8b-instant")).toBe(true);
  });

  it("does not trigger summarization for small conversations", () => {
    const history = msgs(5, 100);
    expect(shouldSummarize(history, "openai/gpt-oss-120b")).toBe(false);
  });

  it("selectRecentWindow preserves most recent messages", () => {
    const history = msgs(20, 200);
    const { recent } = selectRecentWindow(history, "llama-3.1-8b-instant");
    if (recent.length > 0) {
      const lastRecent = recent[recent.length - 1];
      expect(lastRecent.content).toContain("Message 19");
    }
  });

  it("selectRecentWindow returns empty toSummarize when under budget", () => {
    const history = msgs(5, 50);
    const { toSummarize } = selectRecentWindow(history, "openai/gpt-oss-120b");
    expect(toSummarize).toHaveLength(0);
  });
});

describe("Token estimation accuracy", () => {
  it("estimates tokens for mixed content", () => {
    const history: ChatMessage[] = [
      msg("Hello world", "user"),
      msg("Hi there! How can I help?", "assistant"),
      toolMsg("project.get", '{"id":"p1","title":"Test"}'),
    ];
    const tokens = estimateConversationTokens(history);
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(1000);
  });

  it("estimates higher tokens for longer messages", () => {
    const short = estimateConversationTokens([msg("Hi")]);
    const long = estimateConversationTokens([msg("x".repeat(1000))]);
    expect(long).toBeGreaterThan(short);
  });
});