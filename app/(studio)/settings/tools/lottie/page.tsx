"use client";

import { useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./lottie.module.css";

type LottieMeta = {
  version: string;
  frameRate: number;
  durationInFrames: number;
  durationSeconds: number;
  width: number;
  height: number;
  name: string;
  hasLayers: boolean;
  layerCount: number;
};

type SvgMeta = {
  width: number;
  height: number;
  viewBox: string;
  hasAnimation: boolean;
  elementCount: number;
};

type ActionResult = { filePath?: string; note?: string };

export default function LottiePage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lottieMeta, setLottieMeta] = useState<LottieMeta | null>(null);
  const [svgMeta, setSvgMeta] = useState<SvgMeta | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const [lottiePath, setLottiePath] = useState("");
  const [svgPath, setSvgPath] = useState("");

  const [tplLottiePath, setTplLottiePath] = useState("");
  const [tplOutputPath, setTplOutputPath] = useState("");
  const [tplCompId, setTplCompId] = useState("LottieComposition");
  const [tplWidth, setTplWidth] = useState("1920");
  const [tplHeight, setTplHeight] = useState("1080");

  const [convSvgPath, setConvSvgPath] = useState("");
  const [convOutputPath, setConvOutputPath] = useState("");

  const runAction = useCallback(async (action: string, params: Record<string, unknown>) => {
    setLoading(true);
    setError("");
    setResult(null);
    setLottieMeta(null);
    setSvgMeta(null);
    try {
      const res = await api<Record<string, unknown>>("/api/tools/lottie", {
        method: "POST",
        body: JSON.stringify({ action, params }),
      });
      if (action === "validate_lottie") setLottieMeta(res as unknown as LottieMeta);
      else if (action === "validate_svg") setSvgMeta(res as unknown as SvgMeta);
      else setResult(res as unknown as ActionResult);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Action failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Lottie &amp; SVG</p>
        <h1 className={styles.title}>Animation Codec Tools</h1>
        <p className={styles.subtitle}>
          Validate Lottie JSON and SVG files, generate Remotion composition templates for Lottie rendering,
          and convert static SVGs to Lottie format. Animated SVGs require manual conversion.
        </p>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Validate Lottie JSON</p>
        <p className={styles.sectionDesc}>Inspect a Lottie animation file&apos;s metadata (version, frame rate, duration, dimensions, layers).</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Lottie JSON file path</span>
          <input className={styles.fieldInput} value={lottiePath} onChange={(e) => setLottiePath(e.target.value)} placeholder="/path/to/animation.json" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("validate_lottie", { filePath: lottiePath })} disabled={loading || !lottiePath}>
            {loading ? "Validating…" : "Validate"}
          </button>
        </div>
        {lottieMeta ? (
          <div className={styles.info}>
            <strong>{lottieMeta.name}</strong> — v{lottieMeta.version} | {lottieMeta.width}×{lottieMeta.height} | {lottieMeta.frameRate}fps | {lottieMeta.durationInFrames} frames ({lottieMeta.durationSeconds.toFixed(2)}s) | {lottieMeta.layerCount} layers
          </div>
        ) : null}
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Validate SVG</p>
        <p className={styles.sectionDesc}>Inspect an SVG file&apos;s dimensions, animation presence, and element count.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>SVG file path</span>
          <input className={styles.fieldInput} value={svgPath} onChange={(e) => setSvgPath(e.target.value)} placeholder="/path/to/image.svg" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("validate_svg", { filePath: svgPath })} disabled={loading || !svgPath}>
            {loading ? "Validating…" : "Validate"}
          </button>
        </div>
        {svgMeta ? (
          <div className={styles.info}>
            {svgMeta.width}×{svgMeta.height} | viewBox: {svgMeta.viewBox || "none"} | {svgMeta.elementCount} elements | animation: {svgMeta.hasAnimation ? "yes (SMIL)" : "no"}
          </div>
        ) : null}
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Generate Remotion Template</p>
        <p className={styles.sectionDesc}>Generate a Remotion composition that renders a Lottie animation using @remotion/lottie.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Lottie JSON path (will be imported)</span>
          <input className={styles.fieldInput} value={tplLottiePath} onChange={(e) => setTplLottiePath(e.target.value)} placeholder="/path/to/animation.json" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output .tsx file path</span>
          <input className={styles.fieldInput} value={tplOutputPath} onChange={(e) => setTplOutputPath(e.target.value)} placeholder="src/remotion/LottieComposition.tsx" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Composition ID (React component name)</span>
          <input className={styles.fieldInput} value={tplCompId} onChange={(e) => setTplCompId(e.target.value)} placeholder="LottieComposition" />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Width</span>
            <input className={styles.fieldInput} value={tplWidth} onChange={(e) => setTplWidth(e.target.value)} placeholder="1920" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Height</span>
            <input className={styles.fieldInput} value={tplHeight} onChange={(e) => setTplHeight(e.target.value)} placeholder="1080" />
          </div>
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("generate_template", { lottiePath: tplLottiePath, outputPath: tplOutputPath, compositionId: tplCompId, width: Number(tplWidth), height: Number(tplHeight) })} disabled={loading || !tplLottiePath || !tplOutputPath}>
            {loading ? "Generating…" : "Generate template"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Convert SVG to Lottie</p>
        <p className={styles.sectionDesc}>Convert a static SVG to Lottie format (embedded as image layer). Animated SVGs cannot be auto-converted.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>SVG file path</span>
          <input className={styles.fieldInput} value={convSvgPath} onChange={(e) => setConvSvgPath(e.target.value)} placeholder="/path/to/image.svg" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output Lottie JSON path</span>
          <input className={styles.fieldInput} value={convOutputPath} onChange={(e) => setConvOutputPath(e.target.value)} placeholder="/path/to/output.json" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runAction("svg_to_lottie", { svgPath: convSvgPath, outputPath: convOutputPath })} disabled={loading || !convSvgPath || !convOutputPath}>
            {loading ? "Converting…" : "Convert"}
          </button>
        </div>
      </div>

      {result ? (
        <div className={`${styles.result} ${styles.resultOk}`}>
          <p className={styles.resultText}>
            {result.filePath ? `File: ${result.filePath}` : "Done"}
          </p>
          {result.note ? <p className={styles.info}>{result.note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}