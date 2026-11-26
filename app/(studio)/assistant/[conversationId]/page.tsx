"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/hooks/api";
import styles from "../assistant.module.css";
import { AssistantSidebar } from "@/components/assistant/AssistantSidebar";
import { AgentSelector } from "@/components/assistant/AgentSelector";
import { ChatMessages, type PendingToolCall } from "@/components/assistant/ChatMessages";
import { ChatInput } from "@/components/assistant/ChatInput";
import type { ChatAgentId, ChatAgentProviderInfo, ChatMessage, ToolCall, ConversationRecord, MessageRecord } from "@/lib/assistant/types";

type DisplayMessage = ChatMessage & { id: string };

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.conversationId as string;

  const [providers, setProviders] = useState<ChatAgentProviderInfo[]>([]);
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ChatAgentId>("gemini");
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [providerFilter, setProviderFilter] = useState<ChatAgentId | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/assistant/providers")
      .then((res) => res.json())
      .then((data) => setProviders(data.data as ChatAgentProviderInfo[]))
      .catch(() => setError("Failed to load providers."));
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await api<{ conversation: ConversationRecord; messages: MessageRecord[] }>(
          `/api/assistant/conversations/${conversationId}`
        );
        setConversation(data.conversation);
        setSelectedProvider(data.conversation.provider);
        setSelectedModel(data.conversation.model);
        setMessages(data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          usage: m.usage,
        })));
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Failed to load conversation.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [conversationId]);

  useEffect(() => {
    const p = providers.find((x) => x.id === selectedProvider);
    if (p && !p.models.includes(selectedModel)) {
      setSelectedModel(p.defaultModel);
    }
  }, [selectedProvider, providers, selectedModel]);

  const handleSend = useCallback(async (message: string) => {
    const userMsg: DisplayMessage = { id: `u-${Date.now()}`, role: "user", content: message };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: DisplayMessage = { id: assistantId, role: "assistant", content: "", toolCalls: [] };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
          message,
          conversationId,
          projectId: conversation?.projectId ?? null,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream.");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const json = line.slice(6).trim();
            if (!json) continue;
            try {
              const event = JSON.parse(json);
              if (event.type === "text") {
                setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + event.delta } : m));
              } else if (event.type === "tool_call") {
                const tc: ToolCall = { id: event.id, name: event.name, args: event.args, status: "pending" };
                setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, toolCalls: [...(m.toolCalls ?? []), tc] } : m));
              } else if (event.type === "tool_result") {
                setMessages((prev) => prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  return {
                    ...m,
                    toolCalls: (m.toolCalls ?? []).map((tc) => tc.id === event.id ? { ...tc, result: event.result, status: event.status } : tc),
                  };
                }));
              } else if (event.type === "approval_required") {
                setPendingToolCalls((prev) => [...prev, { id: event.id, name: event.name, args: event.args, status: "awaiting_approval", result: "", conversationId }]);
              } else if (event.type === "usage") {
                setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, usage: event.usage } : m));
              } else if (event.type === "error") {
                setError(event.error);
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Chat failed.");
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [selectedProvider, selectedModel, conversationId, conversation]);

  function handleCancel() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  async function handleApprove(toolCallId: string, approved: boolean) {
    setPendingToolCalls((prev) => prev.filter((tc) => tc.id !== toolCallId));
    try {
      await fetch("/api/assistant/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolCallId, approved }),
      });
    } catch { /* */ }
  }

  if (loading) return <div className={styles.loading} style={{ padding: "2rem" }}>Loading conversation…</div>;
  if (error && !conversation) return <div className={styles.error} style={{ padding: "2rem" }}>{error}</div>;

  const currentProvider = providers.find((p) => p.id === selectedProvider);

  return (
    <div className={styles.page}>
      <AssistantSidebar
        currentConversationId={conversationId}
        providerFilter={providerFilter}
        onFilterChange={setProviderFilter}
      />
      <div className={styles.main}>
        <div className={styles.mainHeader}>
          <AgentSelector
            providers={providers}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            onProviderChange={setSelectedProvider}
            onModelChange={setSelectedModel}
          />
        </div>
        {error ? <div className={styles.error} style={{ padding: "0 1.5rem" }}>{error}</div> : null}
        <ChatMessages messages={messages} pendingToolCalls={pendingToolCalls} onApprove={handleApprove} />
        <ChatInput onSend={handleSend} onCancel={handleCancel} disabled={streaming || !currentProvider?.configured} streaming={streaming} />
      </div>
    </div>
  );
}