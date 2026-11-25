"use client";

import { useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./ffmpeg.module.css";

type OperationResult = {
  outputPaths: string[];
  durationSeconds: number;
};

type MediaInfo = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  codec: string;
};

export default function FFmpegPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);

  const [tcInput, setTcInput] = useState("");
  const [tcOutput, setTcOutput] = useState("");
  const [tcResolution, setTcResolution] = useState("");
  const [tcCrf, setTcCrf] = useState("23");
  const [tcPreset, setTcPreset] = useState("fast");

  const [trimInput, setTrimInput] = useState("");
  const [trimOutput, setTrimOutput] = useState("");
  const [trimStart, setTrimStart] = useState("0");
  const [trimDuration, setTrimDuration] = useState("10");

  const [framesInput, setFramesInput] = useState("");
  const [framesOutput, setFramesOutput] = useState("");
  const [framesFps, setFramesFps] = useState("10");
  const [framesFormat, setFramesFormat] = useState<"png" | "jpg">("png");

  const [audioInput, setAudioInput] = useState("");
  const [audioOutput, setAudioOutput] = useState("");
  const [audioFormat, setAudioFormat] = useState<"wav" | "mp3" | "aac" | "flac">("wav");

  const [replaceVideo, setReplaceVideo] = useState("");
  const [replaceAudio, setReplaceAudio] = useState("");
  const [replaceOutput, setReplaceOutput] = useState("");

  const [overlayBase, setOverlayBase] = useState("");
  const [overlayPath, setOverlayPath] = useState("");
  const [overlayOutput, setOverlayOutput] = useState("");
  const [overlayX, setOverlayX] = useState("0");
  const [overlayY, setOverlayY] = useState("0");
  const [overlayOpacity, setOverlayOpacity] = useState("1");

  const [infoPath, setInfoPath] = useState("");

  const runOperation = useCallback(async (operation: string, params: Record<string, unknown>) => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api<OperationResult>("/api/tools/ffmpeg", {
        method: "POST",
        body: JSON.stringify({ operation, params }),
      });
      setResult(res);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Operation failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleGetInfo() {
    setLoading(true);
    setError("");
    setMediaInfo(null);
    try {
      const res = await api<MediaInfo>(`/api/tools/ffmpeg?path=${encodeURIComponent(infoPath)}`);
      setMediaInfo(res);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to get media info.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>FFmpeg Operations</p>
        <h1 className={styles.title}>Standalone FFmpeg Tools</h1>
        <p className={styles.subtitle}>
          Common FFmpeg operations for media processing: transcode, trim, extract frames,
          extract audio, replace audio, and overlay video. Requires FFMPEG_PATH and FFPROBE_PATH env vars.
        </p>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Media Info (FFprobe)</p>
        <p className={styles.sectionDesc}>Inspect a media file&apos;s duration, resolution, codec, and audio presence.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Input file path</span>
          <input className={styles.fieldInput} value={infoPath} onChange={(e) => setInfoPath(e.target.value)} placeholder="/path/to/video.mp4" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleGetInfo} disabled={loading || !infoPath}>
            {loading ? "Checking…" : "Get info"}
          </button>
        </div>
        {mediaInfo ? (
          <div className={styles.info}>
            Duration: {mediaInfo.durationSeconds.toFixed(2)}s | Resolution: {mediaInfo.width}×{mediaInfo.height} | Codec: {mediaInfo.codec} | Audio: {mediaInfo.hasAudio ? "yes" : "no"}
          </div>
        ) : null}
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Transcode</p>
        <p className={styles.sectionDesc}>Convert media to a different codec, resolution, or quality.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Input path</span>
          <input className={styles.fieldInput} value={tcInput} onChange={(e) => setTcInput(e.target.value)} placeholder="/path/to/input.avi" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output path</span>
          <input className={styles.fieldInput} value={tcOutput} onChange={(e) => setTcOutput(e.target.value)} placeholder="/path/to/output.mp4" />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Resolution (e.g. 1920:1080)</span>
            <input className={styles.fieldInput} value={tcResolution} onChange={(e) => setTcResolution(e.target.value)} placeholder="leave empty for original" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>CRF (0-51, lower = better)</span>
            <input className={styles.fieldInput} value={tcCrf} onChange={(e) => setTcCrf(e.target.value)} placeholder="23" />
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Preset</span>
          <select className={styles.select} value={tcPreset} onChange={(e) => setTcPreset(e.target.value)}>
            <option value="ultrafast">ultrafast</option>
            <option value="superfast">superfast</option>
            <option value="veryfast">veryfast</option>
            <option value="faster">faster</option>
            <option value="fast">fast</option>
            <option value="medium">medium</option>
            <option value="slow">slow</option>
            <option value="slower">slower</option>
          </select>
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runOperation("transcode", { inputPath: tcInput, outputPath: tcOutput, resolution: tcResolution || undefined, crf: Number(tcCrf), preset: tcPreset })} disabled={loading || !tcInput || !tcOutput}>
            {loading ? "Working…" : "Transcode"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Trim</p>
        <p className={styles.sectionDesc}>Extract a segment from a media file (lossless copy).</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Input path</span>
          <input className={styles.fieldInput} value={trimInput} onChange={(e) => setTrimInput(e.target.value)} placeholder="/path/to/input.mp4" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output path</span>
          <input className={styles.fieldInput} value={trimOutput} onChange={(e) => setTrimOutput(e.target.value)} placeholder="/path/to/trimmed.mp4" />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Start (seconds)</span>
            <input className={styles.fieldInput} value={trimStart} onChange={(e) => setTrimStart(e.target.value)} placeholder="0" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Duration (seconds)</span>
            <input className={styles.fieldInput} value={trimDuration} onChange={(e) => setTrimDuration(e.target.value)} placeholder="10" />
          </div>
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runOperation("trim", { inputPath: trimInput, outputPath: trimOutput, startSeconds: Number(trimStart), durationSeconds: Number(trimDuration) })} disabled={loading || !trimInput || !trimOutput}>
            {loading ? "Working…" : "Trim"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Extract Frames</p>
        <p className={styles.sectionDesc}>Extract a sequence of frames from a video as images.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Input video path</span>
          <input className={styles.fieldInput} value={framesInput} onChange={(e) => setFramesInput(e.target.value)} placeholder="/path/to/video.mp4" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output directory</span>
          <input className={styles.fieldInput} value={framesOutput} onChange={(e) => setFramesOutput(e.target.value)} placeholder="/path/to/frames/" />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Frame rate (fps)</span>
            <input className={styles.fieldInput} value={framesFps} onChange={(e) => setFramesFps(e.target.value)} placeholder="10" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Format</span>
            <select className={styles.select} value={framesFormat} onChange={(e) => setFramesFormat(e.target.value as "png" | "jpg")}>
              <option value="png">PNG (lossless)</option>
              <option value="jpg">JPG (compressed)</option>
            </select>
          </div>
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runOperation("extract_frames", { inputPath: framesInput, outputDir: framesOutput, frameRate: Number(framesFps), format: framesFormat })} disabled={loading || !framesInput || !framesOutput}>
            {loading ? "Working…" : "Extract frames"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Extract Audio</p>
        <p className={styles.sectionDesc}>Extract the audio track from a video file.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Input video path</span>
          <input className={styles.fieldInput} value={audioInput} onChange={(e) => setAudioInput(e.target.value)} placeholder="/path/to/video.mp4" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output audio path</span>
          <input className={styles.fieldInput} value={audioOutput} onChange={(e) => setAudioOutput(e.target.value)} placeholder="/path/to/audio.wav" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Format</span>
          <select className={styles.select} value={audioFormat} onChange={(e) => setAudioFormat(e.target.value as "wav" | "mp3" | "aac" | "flac")}>
            <option value="wav">WAV (PCM 16-bit, lossless)</option>
            <option value="mp3">MP3 (compressed)</option>
            <option value="aac">AAC (compressed)</option>
            <option value="flac">FLAC (lossless)</option>
          </select>
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runOperation("extract_audio", { inputPath: audioInput, outputPath: audioOutput, format: audioFormat })} disabled={loading || !audioInput || !audioOutput}>
            {loading ? "Working…" : "Extract audio"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Replace Audio</p>
        <p className={styles.sectionDesc}>Replace the audio track of a video with a new audio file.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Video path</span>
          <input className={styles.fieldInput} value={replaceVideo} onChange={(e) => setReplaceVideo(e.target.value)} placeholder="/path/to/video.mp4" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>New audio path</span>
          <input className={styles.fieldInput} value={replaceAudio} onChange={(e) => setReplaceAudio(e.target.value)} placeholder="/path/to/new_audio.wav" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output path</span>
          <input className={styles.fieldInput} value={replaceOutput} onChange={(e) => setReplaceOutput(e.target.value)} placeholder="/path/to/output.mp4" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runOperation("replace_audio", { videoPath: replaceVideo, audioPath: replaceAudio, outputPath: replaceOutput })} disabled={loading || !replaceVideo || !replaceAudio || !replaceOutput}>
            {loading ? "Working…" : "Replace audio"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Overlay Video</p>
        <p className={styles.sectionDesc}>Overlay one video on top of another at a specified position.</p>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Base video path</span>
          <input className={styles.fieldInput} value={overlayBase} onChange={(e) => setOverlayBase(e.target.value)} placeholder="/path/to/base.mp4" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Overlay video path</span>
          <input className={styles.fieldInput} value={overlayPath} onChange={(e) => setOverlayPath(e.target.value)} placeholder="/path/to/overlay.mp4" />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Output path</span>
          <input className={styles.fieldInput} value={overlayOutput} onChange={(e) => setOverlayOutput(e.target.value)} placeholder="/path/to/output.mp4" />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>X position</span>
            <input className={styles.fieldInput} value={overlayX} onChange={(e) => setOverlayX(e.target.value)} placeholder="0" />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Y position</span>
            <input className={styles.fieldInput} value={overlayY} onChange={(e) => setOverlayY(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Opacity (0-1)</span>
          <input className={styles.fieldInput} value={overlayOpacity} onChange={(e) => setOverlayOpacity(e.target.value)} placeholder="1" />
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => runOperation("overlay", { baseVideoPath: overlayBase, overlayPath, outputPath: overlayOutput, position: { x: Number(overlayX), y: Number(overlayY) }, opacity: Number(overlayOpacity) })} disabled={loading || !overlayBase || !overlayPath || !overlayOutput}>
            {loading ? "Working…" : "Overlay"}
          </button>
        </div>
      </div>

      {result ? (
        <div className={`${styles.result} ${styles.resultOk}`}>
          <p className={styles.resultText}>
            Completed in {result.durationSeconds.toFixed(2)}s — {result.outputPaths.length} output file(s)
          </p>
          <ul style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#a39b8f" }}>
            {result.outputPaths.slice(0, 20).map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}