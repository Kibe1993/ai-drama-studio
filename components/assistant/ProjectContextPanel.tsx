"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "@/app/(studio)/assistant/assistant.module.css";
import { api, ApiError } from "@/hooks/api";
import { Check, X, Brain } from "lucide-react";

type MemoryItem = {
  id: string;
  category: string;
  key: string;
  value: string;
  source: string;
  status: string;
  updatedAt: string;
};

type Props = {
  projectId: string | null;
};

export function ProjectContextPanel({ projectId }: Props) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const loadMemories = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api<{ memories: MemoryItem[] }>(`/api/assistant/memory?projectId=${projectId}`);
      setMemories(data.memories ?? []);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to load memory");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (expanded && projectId) loadMemories();
  }, [expanded, projectId, loadMemories]);

  async function handleAction(memoryId: string, action: "approve" | "reject") {
    try {
      await fetch("/api/assistant/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, projectId, memoryId }),
      });
      loadMemories();
    } catch { /* best effort */ }
  }

  if (!projectId) return null;

  const confirmed = memories.filter((m) => m.status === "confirmed");
  const proposed = memories.filter((m) => m.status === "proposed");
  const rejected = memories.filter((m) => m.status === "rejected");

  return (
    <div className={styles.contextPanel}>
      <button
        className={styles.contextPanelToggle}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <Brain size={14} />
        <span>Project Memory</span>
        <span className={styles.contextCount}>{confirmed.length}</span>
      </button>
      {expanded ? (
        <div className={styles.contextPanelBody}>
          {loading ? <p className={styles.contextEmpty}>Loading…</p> : null}
          {error ? <p className={styles.contextError}>{error}</p> : null}
          {!loading && memories.length === 0 ? (
            <p className={styles.contextEmpty}>No project memory yet.</p>
          ) : null}
          {confirmed.length > 0 ? (
            <div className={styles.contextGroup}>
              <h4 className={styles.contextGroupTitle}>Confirmed</h4>
              {confirmed.map((m) => (
                <div key={m.id} className={styles.contextItem}>
                  <span className={styles.contextKey}>[{m.category}] {m.key}</span>
                  <span className={styles.contextValue}>{m.value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {proposed.length > 0 ? (
            <div className={styles.contextGroup}>
              <h4 className={styles.contextGroupTitle}>Proposed</h4>
              {proposed.map((m) => (
                <div key={m.id} className={styles.contextItem}>
                  <span className={styles.contextKey}>[{m.category}] {m.key}</span>
                  <span className={styles.contextValue}>{m.value}</span>
                  <div className={styles.contextActions}>
                    <button onClick={() => handleAction(m.id, "approve")} type="button" className={styles.contextApprove} title="Approve">
                      <Check size={12} />
                    </button>
                    <button onClick={() => handleAction(m.id, "reject")} type="button" className={styles.contextReject} title="Reject">
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {rejected.length > 0 ? (
            <div className={styles.contextGroup}>
              <h4 className={styles.contextGroupTitle}>Rejected</h4>
              {rejected.map((m) => (
                <div key={m.id} className={`${styles.contextItem} ${styles.contextItemRejected}`}>
                  <span className={styles.contextKey}>[{m.category}] {m.key}</span>
                  <span className={styles.contextValue}>{m.value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}