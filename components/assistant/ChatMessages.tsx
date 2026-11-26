"use client";

import { useRef, useEffect } from "react";
import styles from "@/app/(studio)/assistant/assistant.module.css";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { ChatMessage, ToolCall } from "@/lib/assistant/types";

type DisplayMessage = ChatMessage & { id: string };

type Props = {
  messages: DisplayMessage[];
  pendingToolCalls: PendingToolCall[];
  onApprove: (id: string, approved: boolean) => void;
  streaming: boolean;
};

export type PendingToolCall = ToolCall & { conversationId: string };

export function ChatMessages({ messages, pendingToolCalls, onApprove, streaming }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingToolCalls]);

  if (messages.length === 0 && pendingToolCalls.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyTitle}>AI Assistant</div>
        <div className={styles.emptyHint}>Ask me about your projects, story bibles, characters, or scenes.</div>
        <div className={styles.emptyHint}>I can read project data through MCP tools and help you analyze it.</div>
      </div>
    );
  }

  return (
    <div className={styles.messages}>
      {messages.map((msg) => (
        <div key={msg.id} className={`${styles.msg} ${msg.role === "user" ? styles.msgUser : styles.msgAssistant}`}>
          <div className={styles.msgRole}>{msg.role}</div>
          {msg.role === "assistant" ? <MarkdownRenderer content={msg.content} /> : msg.content}
          {msg.toolCalls && msg.toolCalls.length > 0 ? (
            <div style={{ marginTop: "0.5rem" }}>
              {msg.toolCalls.map((tc) => (
                <div key={tc.id} className={styles.toolActivity}>
                  <div className={styles.toolHeader}>
                    <span className={styles.toolName}>{tc.name}</span>
                    <span className={styles.toolStatus}>{tc.status}</span>
                  </div>
                  {tc.result ? <div className={styles.toolBody}>{tc.result.slice(0, 500)}{tc.result.length > 500 ? "…" : ""}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
          {msg.usage ? (
            <div className={styles.msgUsage}>
              {msg.usage.totalTokens ?? "?"} tokens
              {msg.usage.promptTokens ? ` (${msg.usage.promptTokens} prompt + ${msg.usage.completionTokens ?? 0} completion)` : ""}
            </div>
          ) : null}
        </div>
      ))}
      {pendingToolCalls.map((tc) => (
        <div key={tc.id} className={styles.toolActivity}>
          <div className={styles.toolHeader}>
            <span className={styles.toolName}>{tc.name}</span>
            <span className={styles.toolStatus}>awaiting approval</span>
          </div>
          <div className={styles.toolBody}>{JSON.stringify(tc.args, null, 2)}</div>
          <div className={styles.toolApprove}>
            <button className={`${styles.toolBtn} ${styles.toolBtnApprove}`} onClick={() => onApprove(tc.id, true)}>Approve</button>
            <button className={`${styles.toolBtn} ${styles.toolBtnReject}`} onClick={() => onApprove(tc.id, false)}>Reject</button>
          </div>
        </div>
      ))}
      {streaming ? (
        <div className={styles.typingIndicator}>
          <span className={styles.typingDot} />
          <span className={styles.typingDot} />
          <span className={styles.typingDot} />
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}