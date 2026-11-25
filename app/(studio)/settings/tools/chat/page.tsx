"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./chat.module.css";

type ProviderInfo = {
  id: string;
  displayName: string;
  defaultModel: string;
  freeTier: boolean;
  freeTierDescription: string;
  models: string[];
  docsUrl: string;
  configured: boolean;
  openAICompatible: boolean;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ChatResult = {
  provider: string;
  model: string;
  content: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: string;
};

export default function ChatPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [lastResult, setLastResult] = useState<ChatResult | null>(null);

  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userInput, setUserInput] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("4096");

  const chatLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ providers: ProviderInfo[] }>("/api/tools/chat")
      .then((res) => {
        setProviders(res.providers);
        const first = res.providers.find((p) => p.configured) ?? res.providers[0];
        if (first) {
          setProviderId(first.id);
          setModel(first.defaultModel);
        }
      })
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : "Failed to load providers."));
  }, []);

  useEffect(() => {
    const p = providers.find((x) => x.id === providerId);
    if (p && !p.models.includes(model)) {
      setModel(p.defaultModel);
    }
  }, [providerId, providers, model]);

  useEffect(() => {
    chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight, behavior: "smooth" });
  }, [chatLog]);

  const selectedProvider = providers.find((p) => p.id === providerId);
  const configuredCount = providers.filter((p) => p.configured).length;

  const handleSend = useCallback(async () => {
    if (!providerId || !userInput.trim()) return;
    const messages: ChatMessage[] = [];
    if (systemPrompt.trim()) {
      messages.push({ role: "system", content: systemPrompt.trim() });
    }
    for (const msg of chatLog) {
      messages.push(msg);
    }
    messages.push({ role: "user", content: userInput.trim() });

    setLoading(true);
    setError("");
    setLastResult(null);
    const currentInput = userInput.trim();
    setUserInput("");

    try {
      const res = await api<ChatResult>("/api/tools/chat", {
        method: "POST",
        body: JSON.stringify({
          action: "complete",
          provider: providerId,
          model: model || undefined,
          messages,
          temperature: Number(temperature),
          maxTokens: Number(maxTokens),
        }),
      });
      setLastResult(res);
      setChatLog((prev) => [
        ...prev,
        { role: "user", content: currentInput },
        { role: "assistant", content: res.content },
      ]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Chat completion failed.");
      setChatLog((prev) => [...prev, { role: "user", content: currentInput }]);
    } finally {
      setLoading(false);
    }
  }, [providerId, userInput, systemPrompt, chatLog, model, temperature, maxTokens]);

  function handleClearChat() {
    setChatLog([]);
    setLastResult(null);
    setError("");
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Chat Agents</p>
        <h1 className={styles.title}>Free-Tier LLM Chat</h1>
        <p className={styles.subtitle}>
          Send chat completions to free-tier LLM providers via the MCP server. All providers are
          OpenAI-compatible. GitHub Copilot requires a Copilot subscription token.
        </p>
      </div>

      {providers.length > 0 ? (
        <div className={`${styles.status} ${configuredCount > 0 ? styles.statusOk : styles.statusFail}`}>
          {configuredCount > 0
            ? `${configuredCount} of ${providers.length} providers configured and ready.`
            : "No providers configured. Set the API key environment variables to enable chat."}
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Available Providers</p>
        <p className={styles.sectionDesc}>Free-tier LLM providers supported by the chat service.</p>
        <div className={styles.providerGrid}>
          {providers.map((p) => (
            <div key={p.id} className={styles.providerCard}>
              <div className={styles.providerName}>{p.displayName}</div>
              <div className={`${styles.providerStatus} ${p.configured ? styles.providerStatusOk : styles.providerStatusFail}`}>
                {p.configured ? "Configured" : "Not configured"}
              </div>
              <div className={styles.providerTier}>{p.freeTierDescription}</div>
              <a className={styles.providerLink} href={p.docsUrl} target="_blank" rel="noopener noreferrer">Docs →</a>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Chat</p>
        <p className={styles.sectionDesc}>Select a provider and model, then send messages.</p>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Provider</span>
            <select className={styles.select} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {providers.length === 0 ? <option value="">Loading…</option> : null}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} {p.configured ? "✓" : "(not configured)"}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Model</span>
            <select className={styles.select} value={model} onChange={(e) => setModel(e.target.value)}>
              {selectedProvider?.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              )) ?? null}
            </select>
          </div>
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Temperature (0-2)</span>
            <input className={styles.fieldInput} type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Max tokens</span>
            <input className={styles.fieldInput} type="number" min="1" max="32768" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>System prompt (optional)</span>
          <textarea className={styles.textarea} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="You are a helpful screenwriting assistant." />
        </div>

        {chatLog.length > 0 ? (
          <div className={styles.chatLog} ref={chatLogRef}>
            {chatLog.map((msg, i) => (
              <div key={i} className={`${styles.msg} ${msg.role === "user" ? styles.msgUser : styles.msgAssistant}`}>
                <div className={styles.msgRole}>{msg.role}</div>
                {msg.content}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>No messages yet. Send a message below to start.</div>
        )}

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Message</span>
          <textarea className={styles.textarea} value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="Type your message…" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSend} disabled={loading || !providerId || !userInput.trim()}>
            {loading ? "Sending…" : "Send"}
          </button>
          <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleClearChat} disabled={chatLog.length === 0}>
            Clear chat
          </button>
        </div>
      </div>

      {lastResult ? (
        <div className={`${styles.result} ${styles.resultOk}`}>
          <p className={styles.resultText}>{lastResult.content}</p>
          {lastResult.usage ? (
            <p className={styles.usage}>
              Model: {lastResult.model} — Tokens: {lastResult.usage.promptTokens ?? "?"} prompt + {lastResult.usage.completionTokens ?? "?"} completion = {lastResult.usage.totalTokens ?? "?"} total — Finish: {lastResult.finishReason ?? "n/a"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}