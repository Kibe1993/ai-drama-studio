"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./tools.module.css";

type ToolStatus =
  | "not_installed" | "installed" | "configured" | "connected"
  | "available" | "processing" | "failed" | "unavailable";

type HealthCheckResult = {
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  message: string;
  checkedAt: string;
  responseTimeMs?: number;
};

type ToolConfig = {
  id: string;
  toolType: string;
  displayName: string;
  category: string;
  enabled: boolean;
  endpoint?: string;
  executablePath?: string;
  workingDirectory?: string;
  apiKey?: string;
  config: Record<string, unknown>;
  status: ToolStatus;
  lastHealthCheck?: string;
  lastHealthCheckResult?: HealthCheckResult;
};

const CATEGORY_LABELS: Record<string, string> = {
  image_generation: "Image Generation",
  video_generation: "Video Generation",
  animation_2d: "2D Animation",
  animation_3d: "3D Animation",
  character_creation: "Character Creation",
  audio_tts: "Text-to-Speech",
  audio_editing: "Audio Editing",
  lip_sync: "Lip Sync",
  rendering: "Rendering",
  animation_codec: "Animation Codec",
  cloud_generation: "Cloud Generation",
};

const STATUS_CLASS: Record<ToolStatus, string> = {
  not_installed: styles.statusNotInstalled,
  installed: styles.statusInstalled,
  configured: styles.statusConfigured,
  connected: styles.statusConnected,
  available: styles.statusAvailable,
  processing: styles.statusProcessing,
  failed: styles.statusFailed,
  unavailable: styles.statusUnavailable,
};

const STATUS_LABEL: Record<ToolStatus, string> = {
  not_installed: "Not Installed",
  installed: "Installed",
  configured: "Configured",
  connected: "Connected",
  available: "Available",
  processing: "Processing",
  failed: "Failed",
  unavailable: "Unavailable",
};

export default function ToolsSettingsPage() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkingAll, setCheckingAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ToolConfig>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const loadTools = useCallback(async () => {
    try {
      const data = await api<ToolConfig[]>("/api/tools");
      setTools(data);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to load tools.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const grouped = tools.reduce<Record<string, ToolConfig[]>>((acc, tool) => {
    (acc[tool.category] ??= []).push(tool);
    return acc;
  }, {});

  const sortedCategories = Object.keys(grouped).sort();

  async function handleToggle(tool: ToolConfig) {
    try {
      const updated = await api<ToolConfig>(`/api/tools/${tool.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !tool.enabled }),
      });
      setTools((prev) => prev.map((t) => (t.id === tool.id ? updated : t)));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to toggle tool.");
    }
  }

  async function handleHealthCheck(toolId: string) {
    setTools((prev) => prev.map((t) => (t.id === toolId ? { ...t, status: "processing" } : t)));
    try {
      const result = await api<{ config: ToolConfig; result: HealthCheckResult }>(
        `/api/tools/${toolId}/health-check`,
        { method: "POST" }
      );
      setTools((prev) => prev.map((t) => (t.id === toolId ? result.config : t)));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Health check failed.");
      setTools((prev) => prev.map((t) => (t.id === toolId ? { ...t, status: "failed" } : t)));
    }
  }

  async function handleCheckAll() {
    setCheckingAll(true);
    try {
      const results = await api<{ config: ToolConfig; result: HealthCheckResult }[]>(
        "/api/tools/health-check-all",
        { method: "POST" }
      );
      setTools((prev) =>
        prev.map((t) => {
          const match = results.find((r) => r.config.id === t.id);
          return match ? match.config : t;
        })
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Health check failed.");
    } finally {
      setCheckingAll(false);
    }
  }

  function openEdit(tool: ToolConfig) {
    setEditingId(tool.id);
    setEditForm({
      endpoint: tool.endpoint ?? "",
      executablePath: tool.executablePath ?? "",
      workingDirectory: tool.workingDirectory ?? "",
      apiKey: tool.apiKey ?? "",
    });
    setEditError("");
  }

  async function saveEdit() {
    if (!editingId) return;
    setEditSaving(true);
    setEditError("");
    try {
      const updated = await api<ToolConfig>(`/api/tools/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      });
      setTools((prev) => prev.map((t) => (t.id === editingId ? updated : t)));
      setEditingId(null);
    } catch (cause) {
      setEditError(cause instanceof ApiError ? cause.message : "Failed to save.");
    } finally {
      setEditSaving(false);
    }
  }

  if (loading) return <div className={styles.loading}>Loading tool configurations…</div>;
  if (error && tools.length === 0) return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Integration</p>
        <h1 className={styles.title}>External Tools</h1>
        <p className={styles.subtitle}>
          Configure and monitor external creative tools. Status is evidence-based — a tool is only
          &ldquo;available&rdquo; after a successful health check, not merely because it is configured.
        </p>
      </div>

      <div className={styles.toolbar}>
        <button className={styles.btnCheckAll} onClick={handleCheckAll} disabled={checkingAll}>
          {checkingAll ? "Checking all…" : "Run all health checks"}
        </button>
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>

      <div className={styles.navLinks}>
        <a className={styles.navLink} href="/settings/tools/comfyui">ComfyUI (Image Gen)</a>
        <a className={styles.navLink} href="/settings/tools/animation">2D Animation</a>
        <a className={styles.navLink} href="/settings/tools/animation3d">3D Animation</a>
        <a className={styles.navLink} href="/settings/tools/audio-lipsync">Audio &amp; Lip Sync</a>
        <a className={styles.navLink} href="/settings/tools/ffmpeg">FFmpeg Ops</a>
        <a className={styles.navLink} href="/settings/tools/remotion">Remotion</a>
        <a className={styles.navLink} href="/settings/tools/lottie">Lottie &amp; SVG</a>
        <a className={styles.navLink} href="/settings/tools/veo">Google Veo</a>
        <a className={styles.navLink} href="/settings/tools/chat">Chat Agents</a>
      </div>

      {sortedCategories.map((category) => (
        <div key={category}>
          <p className={styles.groupLabel}>{CATEGORY_LABELS[category] ?? category}</p>
          <div className={styles.grid}>
            {grouped[category].map((tool) => (
              <div key={tool.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    <div className={styles.toolIcon}>{tool.displayName.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div className={styles.toolName}>{tool.displayName}</div>
                      <div className={styles.toolCategory}>{tool.toolType}</div>
                    </div>
                  </div>
                  <span className={`${styles.statusBadge} ${STATUS_CLASS[tool.status]}`}>
                    {STATUS_LABEL[tool.status]}
                  </span>
                </div>

                {tool.lastHealthCheckResult ? (
                  <div className={styles.healthRow}>
                    <span
                      className={
                        tool.lastHealthCheckResult.status === "healthy"
                          ? styles.healthOk
                          : tool.lastHealthCheckResult.status === "degraded"
                            ? styles.healthDegraded
                            : tool.lastHealthCheckResult.status === "unhealthy"
                              ? styles.healthFail
                              : styles.healthUnknown
                      }
                    >
                      ●
                    </span>
                    <span>{tool.lastHealthCheckResult.message}</span>
                    {tool.lastHealthCheckResult.responseTimeMs ? (
                      <span className={styles.configKey}>
                        ({tool.lastHealthCheckResult.responseTimeMs}ms)
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.cardBody}>No health check run yet.</div>
                )}

                <div className={styles.cardActions}>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      className={styles.toggleInput}
                      checked={tool.enabled}
                      onChange={() => handleToggle(tool)}
                    />
                    Enabled
                  </label>
                  <button className={styles.btn} onClick={() => openEdit(tool)}>Configure</button>
                  <button
                    className={`${styles.btn} ${styles.btnCheck}`}
                    onClick={() => handleHealthCheck(tool.id)}
                    disabled={tool.status === "processing"}
                  >
                    {tool.status === "processing" ? "Checking…" : "Health check"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {editingId ? (
        <div className={styles.modal} onClick={() => !editSaving && setEditingId(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setEditingId(null)} disabled={editSaving}>
              ×
            </button>
            <h2 className={styles.modalTitle}>
              Configure {tools.find((t) => t.id === editingId)?.displayName}
            </h2>
            <div className={styles.editForm}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>API Endpoint (URL)</span>
                <input
                  className={styles.fieldInput}
                  type="url"
                  placeholder="http://127.0.0.1:8188"
                  value={editForm.endpoint ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, endpoint: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Executable Path</span>
                <input
                  className={styles.fieldInput}
                  type="text"
                  placeholder="C:\Program Files\Blender\blender.exe"
                  value={editForm.executablePath ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, executablePath: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Working Directory</span>
                <input
                  className={styles.fieldInput}
                  type="text"
                  placeholder="/path/to/working/dir"
                  value={editForm.workingDirectory ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, workingDirectory: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>API Key (if required)</span>
                <input
                  className={styles.fieldInput}
                  type="password"
                  placeholder="••••••••"
                  value={editForm.apiKey ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, apiKey: e.target.value }))}
                />
              </label>
              {editError ? <span className={styles.error}>{editError}</span> : null}
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={saveEdit}
                  disabled={editSaving}
                >
                  {editSaving ? "Saving…" : "Save"}
                </button>
                <button className={styles.btn} onClick={() => setEditingId(null)} disabled={editSaving}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}