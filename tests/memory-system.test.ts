import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
  getModelContextWindow,
  getHistoryBudget,
  shouldSummarize,
  selectRecentWindow,
} from "@/lib/assistant/tokenEstimator";
import type { ChatMessage } from "@/lib/assistant/types";

function makeMessage(content: string, role: ChatMessage["role"] = "user"): ChatMessage {
  return { role, content };
}

function makeMessages(count: number, contentSize = 100): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => makeMessage(`Message ${i}: ${"x".repeat(contentSize)}`));
}

describe("Token estimator", () => {
  it("estimates tokens from text length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBe(2);
    expect(estimateTokens("hello world")).toBe(3);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("estimates message tokens including tool calls", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Let me check that.",
      toolCalls: [
        { id: "tc1", name: "project.get", args: { projectId: "p1" }, result: '{"title":"Test"}', status: "success" },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(20);
    expect(tokens).toBeGreaterThan(estimateTokens("Let me check that."));
  });

  it("estimates conversation tokens as sum of messages", () => {
    const messages = [
      makeMessage("Hello"),
      makeMessage("World", "assistant"),
    ];
    const total = estimateConversationTokens(messages);
    expect(total).toBe(estimateMessageTokens(messages[0]) + estimateMessageTokens(messages[1]));
  });
});

describe("Model context windows", () => {
  it("returns known context windows for Groq models", () => {
    const cw = getModelContextWindow("openai/gpt-oss-120b");
    expect(cw.contextWindow).toBe(131072);
    expect(cw.responseReserve).toBe(8192);
  });

  it("returns known context windows for Gemini models", () => {
    const cw = getModelContextWindow("gemini-3.8-flash");
    expect(cw.contextWindow).toBe(1048576);
  });

  it("returns default context window for unknown models", () => {
    const cw = getModelContextWindow("unknown-model");
    expect(cw.contextWindow).toBe(32768);
    expect(cw.responseReserve).toBe(4096);
  });

  it("calculates history budget as 65% of available context", () => {
    const budget = getHistoryBudget("openai/gpt-oss-120b");
    expect(budget).toBe(Math.floor((131072 - 8192) * 0.65));
  });
});

describe("shouldSummarize", () => {
  it("returns false for small conversations", () => {
    const messages = makeMessages(5, 100);
    expect(shouldSummarize(messages, "openai/gpt-oss-120b")).toBe(false);
  });

  it("returns true when conversation exceeds 60% of history budget", () => {
    const budget = getHistoryBudget("llama-3.1-8b-instant");
    const charsNeeded = budget * 0.6 * 4;
    const messages = makeMessages(1, Math.ceil(charsNeeded));
    expect(shouldSummarize(messages, "llama-3.1-8b-instant")).toBe(true);
  });
});

describe("selectRecentWindow", () => {
  it("returns all messages when under budget", () => {
    const messages = makeMessages(5, 50);
    const { recent, toSummarize } = selectRecentWindow(messages, "openai/gpt-oss-120b");
    expect(recent).toHaveLength(5);
    expect(toSummarize).toHaveLength(0);
  });

  it("splits messages when over budget", () => {
    const budget = getHistoryBudget("llama-3.1-8b-instant");
    const charsPerMsg = 500;
    const msgCount = Math.ceil((budget * 2) / (charsPerMsg / 4));
    const messages = makeMessages(msgCount, charsPerMsg);
    const { recent, toSummarize } = selectRecentWindow(messages, "llama-3.1-8b-instant");
    expect(recent.length).toBeLessThan(messages.length);
    expect(toSummarize.length).toBeGreaterThan(0);
    expect(recent.length + toSummarize.length).toBe(messages.length);
  });

  it("preserves message order in recent window", () => {
    const messages = makeMessages(10, 200);
    const { recent } = selectRecentWindow(messages, "llama-3.1-8b-instant");
    if (recent.length > 0) {
      expect(recent[recent.length - 1].content).toContain("Message 9");
    }
  });
});

describe("ChatRole type includes system", () => {
  it("accepts system as a valid role", () => {
    const msg: ChatMessage = { role: "system", content: "System instructions" };
    expect(msg.role).toBe("system");
  });
});

describe("Conversation summary type", () => {
  it("supports null summary on conversation record", () => {
    type Summary = import("@/lib/assistant/types").ConversationSummary | null;
    const s: Summary = null;
    expect(s).toBeNull();
  });

  it("supports populated summary", () => {
    const s: import("@/lib/assistant/types").ConversationSummary = {
      text: "We discussed the protagonist Maya.",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messageCountAtSummary: 20,
      tokenEstimate: 5000,
    };
    expect(s.text).toContain("Maya");
  });
});