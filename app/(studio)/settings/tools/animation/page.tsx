"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./animation.module.css";

type ToolConfig = {
  id: string;
  toolType: string;
  displayName: string;
  enabled: boolean;
  status: string;
  lastHealthCheckResult?: { status: string; message: string };
};

type ActionResult = {
  toolType?: string;
  filePath?: string;
  message?: string;
  format?: string;
  files?: string[];
  count?: number;
  status?: string;
  outputPaths?: string[];
  error?: { code: string; message: string };
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  synfig: "2D vector animation. Supports headless rendering via command line.",
  opentoonz: "Professional 2D animation. No API — use export/import workflow.",
  pencil2d: "Traditional 2D hand-drawn animation. No API — use export/import workflow.",
  blender: "3D + 2D (Grease Pencil). Supports headless rendering via Python scripts.",
};

export default function AnimationPage() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTool, setSelectedTool] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assetIds, setAssetIds] = useState("");
  const [filePath, setFilePath] = useState("");
  const [projectFile, setProjectFile] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    let active = true;
    api<ToolConfig[]>("/api/tools/animation")
      .then((data) => { if (active) setTools(data); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : "Failed to load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const runAction = useCallback(async (action: "export" | "import" | "render") => {
    if (!selectedTool) return;
    setActionLoading(true);
    setError("");
    setResult(null);
    try {
      const body: Record<string, unknown> = { action, toolType: selectedTool };
      if (action === "export") {
        body.projectId = projectId;
        body.assetIds = assetIds.split(",").map((s) => s.trim()).filter(Boolean);
        body.format = "png";
      } else if (action === "import") {
        body.filePath = filePath;
      } else if (action === "render") {
        body.projectFile = projectFile;
      }
      const res = await api<ActionResult>("/api/tools/animation", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(res);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Action failed.");
    } finally {
      setActionLoading(false);
    }
  }, [selectedTool, projectId, assetIds, filePath, projectFile]);

  if (loading) return <div className={styles.loading}>Loading animation tools…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>2D Animation</p>
        <h1 className={styles.title}>Animation Tools</h1>
        <p className={styles.subtitle}>
          Coordinate external 2D animation tools. Tools without APIs use export/import workflow —
          export assets, animate in the tool, import results back.
        </p>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.tools}>
        {tools.map((tool) => (
          <div key={tool.id} className={styles.toolCard}>
            <div className={styles.toolHeader}>
              <div>
                <div className={styles.toolName}>{tool.displayName}</div>
                <div className={styles.toolType}>{tool.toolType}</div>
              </div>
              <span className={`${styles.statusBadge} ${
                tool.status === "available" ? styles.statusOk :
                tool.status === "failed" || tool.status === "unhealthy" ? styles.statusFail :
                styles.statusUnknown
              }`}>
                {tool.enabled ? tool.status : "disabled"}
              </span>
            </div>
            <div className={styles.toolBody}>
              {TOOL_DESCRIPTIONS[tool.toolType] ?? "2D animation tool."}
              {tool.lastHealthCheckResult ? (
                <div style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
                  {tool.lastHealthCheckResult.message}
                </div>
              ) : null}
            </div>
            <div className={styles.toolActions}>
              <button
                className={`${styles.btn} ${selectedTool === tool.toolType ? styles.btnPrimary : styles.btn}`}
                onClick={() => setSelectedTool(tool.toolType)}
              >
                {selectedTool === tool.toolType ? "Selected" : "Select"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedTool ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Export / Import / Render — {selectedTool}</p>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Project ID (for export)</span>
            <input className={styles.fieldInput} value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="Project ID" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Asset IDs (comma-separated, for export)</span>
            <input className={styles.fieldInput} value={assetIds} onChange={(e) => setAssetIds(e.target.value)} placeholder="asset1,asset2,asset3" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Import file path (for import)</span>
            <input className={styles.fieldInput} value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="/path/to/exported/files" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Project file (for render)</span>
            <input className={styles.fieldInput} value={projectFile} onChange={(e) => setProjectFile(e.target.value)} placeholder="/path/to/project.sifz" />
          </div>

          <div className={styles.toolActions}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("export")} disabled={actionLoading || !projectId}>
              {actionLoading ? "Working…" : "Export to tool"}
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("import")} disabled={actionLoading || !filePath}>
              Import from tool
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("render")} disabled={actionLoading || !projectFile}>
              Render
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className={`${styles.result} ${result.error ? styles.resultFail : styles.resultOk}`}>
          <p className={styles.resultText}>
            {result.message ?? `Status: ${result.status ?? "done"}`}
            {result.filePath ? ` — File: ${result.filePath}` : ""}
            {result.count !== undefined ? ` — ${result.count} file(s)` : ""}
          </p>
          {result.files && result.files.length > 0 ? (
            <ul style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#a39b8f" }}>
              {result.files.slice(0, 10).map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          ) : null}
          {result.error ? (
            <p style={{ color: "#e7b2a8", marginTop: "0.5rem" }}>{result.error.code}: {result.error.message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}