"use client";

import styles from "@/app/(studio)/assistant/assistant.module.css";
import type { ChatAgentId, ChatAgentProviderInfo } from "@/lib/assistant/types";

type Props = {
  providers: ChatAgentProviderInfo[];
  selectedProvider: ChatAgentId;
  selectedModel: string;
  onProviderChange: (id: ChatAgentId) => void;
  onModelChange: (model: string) => void;
};

const DISPLAY_NAMES: Record<ChatAgentId, string> = {
  gemini: "Google Gemini",
  openai: "ChatGPT (OpenAI)",
  deepseek: "DeepSeek",
};

export function AgentSelector({ providers, selectedProvider, selectedModel, onProviderChange, onModelChange }: Props) {
  const provider = providers.find((p) => p.id === selectedProvider);
  const models = provider?.models ?? [];

  return (
    <div className={styles.agentSelector}>
      <span className={styles.agentLabel}>Agent:</span>
      <select
        className={styles.agentSelect}
        value={selectedProvider}
        onChange={(e) => onProviderChange(e.target.value as ChatAgentId)}
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {DISPLAY_NAMES[p.id]} {p.configured ? "✓" : "(not configured)"}
          </option>
        ))}
      </select>
      {provider ? (
        <span className={`${styles.providerStatus} ${provider.configured ? styles.providerOk : styles.providerFail}`}>
          {provider.configured ? "Ready" : "Needs API key"}
        </span>
      ) : null}
      {provider?.freeTier ? <span className={`${styles.providerStatus} ${styles.providerFree}`}>Free</span> : null}
      <span className={styles.agentLabel}>Model:</span>
      <select className={styles.modelSelect} value={selectedModel} onChange={(e) => onModelChange(e.target.value)}>
        {models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}