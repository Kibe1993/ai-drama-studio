"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./audio-lipsync.module.css";

type ToolConfig = {
  id: string;
  toolType: string;
  displayName: string;
  enabled: boolean;
  status: string;
  lastHealthCheckResult?: { status: string; message: string };
};

type ActionResult = {
  operationId?: string;
  status?: string;
  outputPaths?: string[];
  error?: { code: string; message: string };
};

type AudioOperation = {
  type: "normalize" | "amplify" | "noise_reduction" | "fade_in" | "fade_out" | "trim" | "compress";
  params?: string;
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  audacity: "Audio editing. Supports headless batch processing for normalize, amplify, noise reduction, fade, trim, compress.",
  wav2lip: "Lip sync from audio + face video. No API — uses command-line inference.py.",
  sadtalker: "Talking-head animation from audio + portrait image. No API — uses command-line inference.py.",
  kokoro: "Text-to-speech narration (built-in). Pairs with lip sync tools.",
};

export default function AudioLipsyncPage() {
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const [lipSyncTool, setLipSyncTool] = useState<"wav2lip" | "sadtalker">("wav2lip");
  const [faceImage, setFaceImage] = useState("");
  const [audioFile, setAudioFile] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [resizeFactor, setResizeFactor] = useState("1");
  const [stillMode, setStillMode] = useState(false);
  const [enhancer, setEnhancer] = useState<"gfpgan" | "none">("none");

  const [audioInput, setAudioInput] = useState("");
  const [audioOutput, setAudioOutput] = useState("");
  const [operations, setOperations] = useState<AudioOperation[]>([{ type: "normalize" }]);

  const [pollTool, setPollTool] = useState<"audacity" | "wav2lip" | "sadtalker" | "kokoro">("wav2lip");
  const [operationId, setOperationId] = useState("");

  useEffect(() => {
    let active = true;
    api<ToolConfig[]>("/api/tools/audio-lipsync")
      .then((data) => { if (active) setTools(data); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : "Failed to load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const runAction = useCallback(async (action: "lipsync" | "edit_audio" | "poll", body: Record<string, unknown>) => {
    setActionLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api<ActionResult>("/api/tools/audio-lipsync", {
        method: "POST",
        body: JSON.stringify({ action, ...body }),
      });
      setResult(res);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Action failed.");
    } finally {
      setActionLoading(false);
    }
  }, []);

  function handleLipSync() {
    const params = {
      faceImage,
      audioFile,
      outputPath,
      tool: lipSyncTool,
      options: {
        resizeFactor: Number(resizeFactor) || 1,
        stillMode,
        enhancer,
      },
    };
    runAction("lipsync", { params });
  }

  function handleEditAudio() {
    const parsedOps = operations.map((op) => {
      if (!op.params) return { type: op.type };
      try { return { type: op.type, params: JSON.parse(op.params) }; }
      catch { return { type: op.type }; }
    });
    runAction("edit_audio", {
      params: { inputFile: audioInput, outputFile: audioOutput, operations: parsedOps },
    });
  }

  function handlePoll() {
    runAction("poll", { toolType: pollTool, operationId });
  }

  function addOperation() {
    setOperations((prev) => [...prev, { type: "normalize" }]);
  }

  function removeOperation(idx: number) {
    setOperations((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateOperation(idx: number, field: "type" | "params", value: string) {
    setOperations((prev) => prev.map((op, i) => {
      if (i !== idx) return op;
      if (field === "type") return { ...op, type: value as AudioOperation["type"] };
      return { ...op, params: value };
    }));
  }

  if (loading) return <div className={styles.loading}>Loading audio &amp; lip sync tools…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Audio &amp; Lip Sync</p>
        <h1 className={styles.title}>Audio Editing &amp; Lip Sync</h1>
        <p className={styles.subtitle}>
          Edit narration audio with Audacity, then generate lip-synced talking-head video with Wav2Lip or SadTalker.
          Tools without APIs use file-based export/render workflow.
        </p>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.tools}>
        {tools.length === 0 ? (
          <p className={styles.loading}>No audio tools configured. Enable them in the External Tools page.</p>
        ) : null}
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
              {TOOL_DESCRIPTIONS[tool.toolType] ?? "Audio / lip sync tool."}
              {tool.lastHealthCheckResult ? (
                <div style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
                  {tool.lastHealthCheckResult.message}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Audacity — Audio Editing</p>
        <p className={styles.sectionDesc}>
          Apply sequential operations to an audio file: normalize, amplify, noise reduction, fade in/out, trim, compress.
        </p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Input audio file path</span>
          <input className={styles.fieldInput} value={audioInput} onChange={(e) => setAudioInput(e.target.value)} placeholder="/path/to/input.wav" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output audio file path</span>
          <input className={styles.fieldInput} value={audioOutput} onChange={(e) => setAudioOutput(e.target.value)} placeholder="/path/to/output.wav" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Operations (applied in order)</span>
          <div className={styles.operations}>
            {operations.map((op, idx) => (
              <div key={idx} className={styles.operationRow}>
                <select
                  className={styles.opSelect}
                  value={op.type}
                  onChange={(e) => updateOperation(idx, "type", e.target.value)}
                >
                  <option value="normalize">normalize</option>
                  <option value="amplify">amplify</option>
                  <option value="noise_reduction">noise_reduction</option>
                  <option value="fade_in">fade_in</option>
                  <option value="fade_out">fade_out</option>
                  <option value="trim">trim</option>
                  <option value="compress">compress</option>
                </select>
                <input
                  className={styles.opInput}
                  value={op.params ?? ""}
                  onChange={(e) => updateOperation(idx, "params", e.target.value)}
                  placeholder='JSON params e.g. {"db":3} — leave empty for defaults'
                />
                <button className={styles.opBtn} onClick={() => removeOperation(idx)} type="button">Remove</button>
              </div>
            ))}
          </div>
          <button className={styles.btn} onClick={addOperation} type="button">Add operation</button>
        </div>
        <div className={styles.btnRow}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleEditAudio}
            disabled={actionLoading || !audioInput || !audioOutput || operations.length === 0}
          >
            {actionLoading ? "Working…" : "Edit audio"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Lip Sync — Wav2Lip / SadTalker</p>
        <p className={styles.sectionDesc}>
          Generate a lip-synced video from a face image (or video) and an audio file.
        </p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Tool</span>
          <select className={styles.select} value={lipSyncTool} onChange={(e) => setLipSyncTool(e.target.value as "wav2lip" | "sadtalker")}>
            <option value="wav2lip">Wav2Lip (face video + audio → lip sync video)</option>
            <option value="sadtalker">SadTalker (portrait image + audio → talking head)</option>
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Face image/video path</span>
          <input className={styles.fieldInput} value={faceImage} onChange={(e) => setFaceImage(e.target.value)} placeholder="/path/to/face.mp4 or /path/to/portrait.png" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Audio file path</span>
          <input className={styles.fieldInput} value={audioFile} onChange={(e) => setAudioFile(e.target.value)} placeholder="/path/to/audio.wav" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output directory</span>
          <input className={styles.fieldInput} value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder="/path/to/output/" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Resize factor (1 = original size)</span>
          <input className={styles.fieldInput} value={resizeFactor} onChange={(e) => setResizeFactor(e.target.value)} placeholder="1" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Enhancer</span>
          <select className={styles.select} value={enhancer} onChange={(e) => setEnhancer(e.target.value as "gfpgan" | "none")}>
            <option value="none">none (faster)</option>
            <option value="gfpgan">GFPGAN (face restoration, slower)</option>
          </select>
        </div>
        <div className={styles.field}>
          <label>
            <input type="checkbox" checked={stillMode} onChange={(e) => setStillMode(e.target.checked)} />
            <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#a39b8f" }}>Still mode (less motion, more stable)</span>
          </label>
        </div>
        <div className={styles.btnRow}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleLipSync}
            disabled={actionLoading || !faceImage || !audioFile || !outputPath}
          >
            {actionLoading ? "Working…" : "Generate lip sync"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Poll Render Status</p>
        <p className={styles.sectionDesc}>Check the status of a running audio edit or lip sync operation.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Tool</span>
          <select className={styles.select} value={pollTool} onChange={(e) => setPollTool(e.target.value as "audacity" | "wav2lip" | "sadtalker" | "kokoro")}>
            <option value="audacity">audacity</option>
            <option value="wav2lip">wav2lip</option>
            <option value="sadtalker">sadtalker</option>
            <option value="kokoro">kokoro</option>
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Operation ID</span>
          <input className={styles.fieldInput} value={operationId} onChange={(e) => setOperationId(e.target.value)} placeholder="operation ID from previous action" />
        </div>
        <div className={styles.btnRow}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handlePoll}
            disabled={actionLoading || !operationId}
          >
            {actionLoading ? "Polling…" : "Poll status"}
          </button>
        </div>
      </div>

      {result ? (
        <div className={`${styles.result} ${result.error ? styles.resultFail : styles.resultOk}`}>
          <p className={styles.resultText}>
            {result.operationId ? `Operation: ${result.operationId} — ` : ""}
            Status: {result.status ?? "done"}
          </p>
          {result.outputPaths && result.outputPaths.length > 0 ? (
            <ul style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#a39b8f" }}>
              {result.outputPaths.map((p, i) => <li key={i}>{p}</li>)}
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