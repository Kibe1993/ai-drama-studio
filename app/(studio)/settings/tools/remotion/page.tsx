"use client";

import { useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./remotion.module.css";

type Composition = {
  id: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
};

type ActionResult = {
  operationId?: string;
  status?: string;
  outputPaths?: string[];
};

export default function RemotionPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [compositions, setCompositions] = useState<Composition[]>([]);

  const [entryPoint, setEntryPoint] = useState("src/remotion/index.ts");
  const [compositionId, setCompositionId] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [codec, setCodec] = useState<"h264" | "h265" | "vp8" | "vp9">("h264");
  const [imageFormat, setImageFormat] = useState<"jpeg" | "png">("jpeg");
  const [crf, setCrf] = useState("18");
  const [propsJson, setPropsJson] = useState("");

  const [pollId, setPollId] = useState("");

  const listCompositions = useCallback(async () => {
    setLoading(true);
    setError("");
    setCompositions([]);
    try {
      const data = await api<{ compositions: Composition[] }>(`/api/tools/remotion?entry=${encodeURIComponent(entryPoint)}`);
      setCompositions(data.compositions);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to list compositions.");
    } finally {
      setLoading(false);
    }
  }, [entryPoint]);

  const runAction = useCallback(async (action: "render" | "poll", body: Record<string, unknown>) => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api<ActionResult>("/api/tools/remotion", {
        method: "POST",
        body: JSON.stringify({ action, ...body }),
      });
      setResult(res);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Action failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  function handleRender() {
    const params: Record<string, unknown> = {
      entryPoint,
      compositionId,
      outputPath,
      codec,
      imageFormat,
      crf: Number(crf),
    };
    if (propsJson.trim()) {
      try { params.props = JSON.parse(propsJson); } catch { /* ignore invalid JSON */ }
    }
    runAction("render", { params });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Remotion</p>
        <h1 className={styles.title}>Remotion Rendering</h1>
        <p className={styles.subtitle}>
          Render React-based video compositions with Remotion. Compositions are TypeScript/React files
          that define video content programmatically. Requires Remotion installed in the working directory.
        </p>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.section}>
        <p className={styles.sectionTitle}>List Compositions</p>
        <p className={styles.sectionDesc}>Scan a Remotion entry point to list available compositions.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Entry point (relative to working directory)</span>
          <input className={styles.fieldInput} value={entryPoint} onChange={(e) => setEntryPoint(e.target.value)} placeholder="src/remotion/index.ts" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={listCompositions} disabled={loading || !entryPoint}>
            {loading ? "Scanning…" : "List compositions"}
          </button>
        </div>
        {compositions.length > 0 ? (
          <div className={styles.compositions}>
            {compositions.map((comp) => (
              <div key={comp.id} className={styles.compCard}>
                <div className={styles.compId}>{comp.id}</div>
                <div className={styles.compMeta}>
                  {comp.width}×{comp.height} | {comp.fps}fps | {comp.durationInFrames} frames ({(comp.durationInFrames / comp.fps).toFixed(1)}s)
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Render Composition</p>
        <p className={styles.sectionDesc}>Render a Remotion composition to a video file.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Entry point</span>
          <input className={styles.fieldInput} value={entryPoint} onChange={(e) => setEntryPoint(e.target.value)} placeholder="src/remotion/index.ts" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Composition ID</span>
          <input className={styles.fieldInput} value={compositionId} onChange={(e) => setCompositionId(e.target.value)} placeholder="MyComposition" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output path</span>
          <input className={styles.fieldInput} value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder="/path/to/output.mp4" />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Codec</span>
            <select className={styles.select} value={codec} onChange={(e) => setCodec(e.target.value as "h264" | "h265" | "vp8" | "vp9")}>
              <option value="h264">H.264 (MP4, most compatible)</option>
              <option value="h265">H.265 (MP4, better compression)</option>
              <option value="vp8">VP8 (WebM)</option>
              <option value="vp9">VP9 (WebM, better compression)</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Image format</span>
            <select className={styles.select} value={imageFormat} onChange={(e) => setImageFormat(e.target.value as "jpeg" | "png")}>
              <option value="jpeg">JPEG (faster, smaller)</option>
              <option value="png">PNG (lossless, slower)</option>
            </select>
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>CRF (0-51, lower = better quality)</span>
          <input className={styles.fieldInput} value={crf} onChange={(e) => setCrf(e.target.value)} placeholder="18" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Props (JSON, optional)</span>
          <input className={styles.fieldInput} value={propsJson} onChange={(e) => setPropsJson(e.target.value)} placeholder='{"title":"My Video"}' />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleRender} disabled={loading || !compositionId || !outputPath}>
            {loading ? "Rendering…" : "Render"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Poll Render Status</p>
        <p className={styles.sectionDesc}>Check the status of a running Remotion render.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Operation ID</span>
          <input className={styles.fieldInput} value={pollId} onChange={(e) => setPollId(e.target.value)} placeholder="operation ID" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("poll", { operationId: pollId })} disabled={loading || !pollId}>
            {loading ? "Polling…" : "Poll status"}
          </button>
        </div>
      </div>

      {result ? (
        <div className={`${styles.result} ${result.status === "failed" ? styles.resultFail : styles.resultOk}`}>
          <p className={styles.resultText}>
            {result.operationId ? `Operation: ${result.operationId} — ` : ""}
            Status: {result.status ?? "done"}
          </p>
          {result.outputPaths && result.outputPaths.length > 0 ? (
            <ul style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#a39b8f" }}>
              {result.outputPaths.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}