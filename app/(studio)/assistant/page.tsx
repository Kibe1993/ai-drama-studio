"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import styles from "./assistant.module.css";
import { AssistantSidebar } from "@/components/assistant/AssistantSidebar";
import { AgentSelector } from "@/components/assistant/AgentSelector";
import { ChatMessages, type PendingToolCall } from "@/components/assistant/ChatMessages";
import { ChatInput } from "@/components/assistant/ChatInput";
import type { ChatAgentId, ChatAgentProviderInfo, ChatMessage, ToolCall, TokenUsage } from "@/lib/assistant/types";

type DisplayMessage = ChatMessage & { id: string };
type ProjectOption = { id: string; title: string };

export default function AssistantPage() {
  const [providers, setProviders] = useState<ChatAgentProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ChatAgentId>("groq");
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [providerFilter, setProviderFilter] = useState<ChatAgentId | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/assistant/providers")
      .then((res) => res.json())
      .then((data) => {
        const list = (data.data?.providers ?? []) as ChatAgentProviderInfo[];
        setProviders(list);
        const configured = list.find((p) => p.configured);
        const target = configured ?? list[0];
        if (target) {
          setSelectedProvider(target.id);
          setSelectedModel(target.defaultModel);
        }
      })
      .catch(() => setError("Failed to load providers."));
  }, []);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data.data?.projects) ? data.data.projects : [];
        setProjects(list);
      })
      .catch(() => { /* projects optional */ });
  }, []);

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
          conversationId: null,
          projectId: selectedProjectId,
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
                setPendingToolCalls((prev) => [...prev, { id: event.id, name: event.name, args: event.args, status: "awaiting_approval", result: "", conversationId: "" }]);
              } else if (event.type === "usage") {
                setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, usage: event.usage } : m));
              } else if (event.type === "conversation") {
                window.history.replaceState(null, "", `/assistant/${event.conversationId}`);
              } else if (event.type === "error") {
                setError(event.error);
              }
            } catch { /* skip malformed */ }
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
  }, [selectedProvider, selectedModel, selectedProjectId]);

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
    } catch { /* approval sent */ }
  }

  const currentProvider = providers.find((p) => p.id === selectedProvider);

  return (
    <div className={styles.page}>
      <AssistantSidebar
        currentConversationId={null}
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
          <div className={styles.projectSelector}>
            <span className={styles.agentLabel}>Project:</span>
            <select
              className={styles.modelSelect}
              value={selectedProjectId ?? ""}
              onChange={(e) => setSelectedProjectId(e.target.value || null)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        </div>
        {error ? <div className={styles.error} style={{ padding: "0 1.5rem" }}>{error}</div> : null}
        <ChatMessages messages={messages} pendingToolCalls={pendingToolCalls} onApprove={handleApprove} streaming={streaming} />
        <ChatInput onSend={handleSend} onCancel={handleCancel} disabled={streaming || !currentProvider?.configured} streaming={streaming} />
      </div>
    </div>
  );
}