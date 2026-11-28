"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import { useRouter } from "next/navigation";
import styles from "@/app/(studio)/assistant/assistant.module.css";
import type { ChatAgentId, ConversationRecord } from "@/lib/assistant/types";

type Props = {
  currentConversationId: string | null;
  providerFilter: ChatAgentId | null;
  onFilterChange: (provider: ChatAgentId | null) => void;
  onNewChat?: () => void;
};

export function AssistantSidebar({ currentConversationId, providerFilter, onFilterChange, onNewChat }: Props) {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();

  const loadConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (providerFilter) params.set("provider", providerFilter);
      const data = await api<ConversationRecord[]>(`/api/assistant/conversations?${params}`);
      setConversations(data);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to load conversations.");
    } finally {
      setLoading(false);
    }
  }, [providerFilter]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  async function handleNewChat() {
    if (onNewChat) {
      onNewChat();
    } else {
      router.push("/assistant");
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      await api(`/api/assistant/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversationId === id) router.push("/assistant");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to delete.");
    }
  }

  const filters: { label: string; value: ChatAgentId | null }[] = [
    { label: "All", value: null },
    { label: "Groq", value: "groq" },
    { label: "Gemini", value: "gemini" },
    { label: "ChatGPT", value: "openai" },
    { label: "DeepSeek", value: "deepseek" },
  ];

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <button className={styles.newChatBtn} onClick={handleNewChat}>+ New Chat</button>
      </div>
      <div className={styles.agentFilter}>
        {filters.map((f) => (
          <button
            key={f.label}
            className={`${styles.filterBtn} ${providerFilter === f.value ? styles.filterBtnActive : ""}`}
            onClick={() => onFilterChange(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error ? <div className={styles.error} style={{ padding: "0.5rem 1.25rem" }}>{error}</div> : null}
      <div className={styles.convList}>
        {loading ? (
          <div className={styles.sidebarEmpty}>Loading…</div>
        ) : conversations.length === 0 ? (
          <div className={styles.sidebarEmpty}>No conversations yet.</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`${styles.convItem} ${currentConversationId === conv.id ? styles.convItemActive : ""}`}
              onClick={() => router.push(`/assistant/${conv.id}`)}
            >
              <span className={styles.convDelete} onClick={(e) => handleDelete(conv.id, e)}>×</span>
              <div className={styles.convTitle}>{conv.title}</div>
              <div className={styles.convMeta}>
                <span>{conv.provider}</span>
                <span>{new Date(conv.updatedAt).toLocaleDateString()}</span>
                <span>{conv.messageCount} msgs</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}