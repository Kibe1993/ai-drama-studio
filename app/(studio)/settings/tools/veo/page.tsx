"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./veo.module.css";

type Status = { configured: boolean; models: string[]; pricing: Record<string, string> };
type ActionResult = { operationId?: string; status?: string; estimatedCostCents?: number };

export default function VeoPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const [model, setModel] = useState("veo-3.0-generate-preview");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState("5");
  const [subject, setSubject] = useState("");
  const [environment, setEnvironment] = useState("");
  const [style, setStyle] = useState("");
  const [lighting, setLighting] = useState("");
  const [camera, setCamera] = useState("");
  const [composition, setComposition] = useState("");
  const [continuity, setContinuity] = useState("");
  const [motion, setMotion] = useState("");
  const [cameraMovement, setCameraMovement] = useState("");
  const [segmentNote, setSegmentNote] = useState("");

  const [pollId, setPollId] = useState("");

  useEffect(() => {
    api<Status>("/api/tools/veo")
      .then(setStatus)
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : "Failed to load."));
  }, []);

  const runAction = useCallback(async (action: "generate" | "poll" | "cancel", body: Record<string, unknown>) => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api<ActionResult>("/api/tools/veo", {
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

  function handleGenerate() {
    runAction("generate", {
      params: {
        prompt: {
          subject, environment, style, lighting, camera, composition,
          continuityNotes: continuity, motion, cameraMovement,
          durationSeconds: Number(duration), segmentNote,
        },
        aspectRatio,
        durationSeconds: Number(duration),
        model,
      },
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Google Veo</p>
        <h1 className={styles.title}>Cloud Video Generation</h1>
        <p className={styles.subtitle}>
          Generate video clips from text prompts using Google Veo. This is a paid cloud API —
          each second of generated video costs $0.25-$0.50 depending on the model.
        </p>
      </div>

      {status ? (
        <div className={`${styles.status} ${status.configured ? styles.statusOk : styles.statusFail}`}>
          {status.configured ? "VEO_API_KEY configured — Veo is ready." : "VEO_API_KEY not set — Veo is unavailable."}
        </div>
      ) : null}

      {status?.pricing ? (
        <div className={styles.pricing}>
          {Object.entries(status.pricing).map(([m, cost]) => (
            <div key={m} className={styles.priceCard}>
              <div className={styles.priceModel}>{m}</div>
              <div className={styles.priceCost}>{cost}</div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Generate Video</p>
        <p className={styles.sectionDesc}>Submit a text-to-video generation request to Google Veo.</p>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Model</span>
            <select className={styles.select} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="veo-3.0-generate-preview">Veo 3.0 (higher quality, $0.50/s)</option>
              <option value="veo-2.0-generate-001">Veo 2.0 (faster, $0.25/s)</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Aspect ratio</span>
            <select className={styles.select} value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
              <option value="16:9">16:9 (landscape)</option>
              <option value="9:16">9:16 (portrait)</option>
              <option value="1:1">1:1 (square)</option>
            </select>
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Duration (seconds, max 8)</span>
          <input className={styles.fieldInput} type="number" min="1" max="8" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Subject</span>
          <input className={styles.fieldInput} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A woman in a red dress" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Environment</span>
          <input className={styles.fieldInput} value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="A dimly lit alley with neon signs" />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Style</span>
            <input className={styles.fieldInput} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="cinematic, film noir" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Lighting</span>
            <input className={styles.fieldInput} value={lighting} onChange={(e) => setLighting(e.target.value)} placeholder="low key, moody" />
          </div>
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Camera</span>
            <input className={styles.fieldInput} value={camera} onChange={(e) => setCamera(e.target.value)} placeholder="medium shot" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Composition</span>
            <input className={styles.fieldInput} value={composition} onChange={(e) => setComposition(e.target.value)} placeholder="rule of thirds" />
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Motion</span>
          <input className={styles.fieldInput} value={motion} onChange={(e) => setMotion(e.target.value)} placeholder="walking towards camera" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Camera movement</span>
          <input className={styles.fieldInput} value={cameraMovement} onChange={(e) => setCameraMovement(e.target.value)} placeholder="slow dolly in" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Continuity notes</span>
          <input className={styles.fieldInput} value={continuity} onChange={(e) => setContinuity(e.target.value)} placeholder="red dress matches previous scene" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Segment note</span>
          <input className={styles.fieldInput} value={segmentNote} onChange={(e) => setSegmentNote(e.target.value)} placeholder="scene 3, shot 2" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleGenerate} disabled={loading || !subject}>
            {loading ? "Submitting…" : `Generate (${Number(duration)}s ≈ $${(Number(duration) * (model.includes("3.0") ? 0.5 : 0.25)).toFixed(2)})`}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Poll / Cancel</p>
        <p className={styles.sectionDesc}>Check the status of a Veo generation operation or cancel it.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Operation ID</span>
          <input className={styles.fieldInput} value={pollId} onChange={(e) => setPollId(e.target.value)} placeholder="operation ID from generate" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("poll", { operationId: pollId })} disabled={loading || !pollId}>
            {loading ? "Polling…" : "Poll status"}
          </button>
          <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => runAction("cancel", { operationId: pollId })} disabled={loading || !pollId}>
            Cancel
          </button>
        </div>
      </div>

      {result ? (
        <div className={`${styles.result} ${result.status === "failed" ? styles.resultFail : styles.resultOk}`}>
          <p className={styles.resultText}>
            {result.operationId ? `Operation: ${result.operationId} — ` : ""}
            Status: {result.status ?? "done"}
            {result.estimatedCostCents ? ` — Est. cost: $${(result.estimatedCostCents / 100).toFixed(2)}` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}