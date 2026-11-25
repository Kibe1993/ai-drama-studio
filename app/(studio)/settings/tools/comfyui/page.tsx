"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/hooks/api";
import styles from "./comfyui.module.css";

type Workflow = {
  id: string;
  name: string;
  description?: string;
  category: string;
  graph: Record<string, unknown>;
  inputs?: Record<string, { type: string; required: boolean; default?: unknown }>;
};

type ModelInfo = {
  checkpoints: string[];
  loras: string[];
};

type ExecutionResult = {
  promptId: string;
  status: "processing" | "completed" | "failed";
  imageUrls?: string[];
  error?: { code: string; message: string };
};

export default function ComfyUIPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [models, setModels] = useState<ModelInfo>({ checkpoints: [], loras: [] });
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [executing, setExecuting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [inputs, setInputs] = useState("{}");

  useEffect(() => {
    let active = true;
    api<{ workflows: Workflow[]; models: ModelInfo }>("/api/tools/comfyui")
      .then((data) => {
        if (!active) return;
        setWorkflows(data.workflows);
        setModels(data.models);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof ApiError ? cause.message : "Failed to load ComfyUI config.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const execute = useCallback(async () => {
    if (!selectedWorkflow) return;
    setExecuting(true);
    setError("");
    setResult(null);
    try {
      const parsedInputs = JSON.parse(inputs);
      const res = await api<ExecutionResult>("/api/tools/comfyui/execute", {
        method: "POST",
        body: JSON.stringify({ workflowId: selectedWorkflow, inputs: parsedInputs }),
      });
      setResult(res);
      if (res.status === "processing") {
        setPolling(true);
        poll(res.promptId);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Execution failed.");
    } finally {
      setExecuting(false);
    }
  }, [selectedWorkflow, inputs]);

  const poll = useCallback(async (promptId: string) => {
    let attempts = 0;
    const maxAttempts = 120;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        setPolling(false);
        setError("Polling timed out after 2 minutes.");
        return;
      }
      try {
        const res = await api<ExecutionResult>(`/api/tools/comfyui/poll/${promptId}`);
        if (res.status !== "processing") {
          clearInterval(interval);
          setPolling(false);
          setResult(res);
        }
      } catch {
        clearInterval(interval);
        setPolling(false);
      }
    }, 2000);
  }, []);

  if (loading) return <div className={styles.loading}>Loading ComfyUI configuration…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Image Generation</p>
        <h1 className={styles.title}>ComfyUI</h1>
        <p className={styles.subtitle}>
          Generate images via ComfyUI workflows. Select a workflow, configure inputs, and execute.
          Status is evidence-based — ComfyUI must be connected and healthy.
        </p>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {models.checkpoints.length > 0 ? (
        <div className={styles.modelInfo}>
          <p>Available checkpoints:</p>
          {models.checkpoints.slice(0, 10).map((m) => (
            <span key={m} className={styles.modelBadge}>{m}</span>
          ))}
          {models.checkpoints.length > 10 ? <span className={styles.modelBadge}>+{models.checkpoints.length - 10} more</span> : null}
        </div>
      ) : null}

      <div className={styles.section}>
        <p className={styles.sectionTitle}>Workflows</p>
        {workflows.length === 0 ? (
          <p className={styles.empty}>No workflows saved. Add a workflow below.</p>
        ) : (
          <div className={styles.workflows}>
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className={`${styles.workflowItem} ${selectedWorkflow === wf.id ? styles.workflowItemSelected : ""}`}
                onClick={() => setSelectedWorkflow(wf.id)}
              >
                <div>
                  <div className={styles.workflowName}>{wf.name}</div>
                  <div className={styles.workflowCat}>{wf.category}</div>
                </div>
                {wf.description ? <div className={styles.workflowCat}>{wf.description}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedWorkflow ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Workflow Inputs (JSON)</p>
          <textarea
            className={styles.fieldInput}
            value={inputs}
            onChange={(e) => setInputs(e.target.value)}
            placeholder='{"positive_prompt": "a character in a forest", "seed": 42}'
          />
          <div className={styles.toolbar}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={execute} disabled={executing || polling}>
              {executing ? "Submitting…" : polling ? "Polling…" : "Execute workflow"}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Results</p>
          <div className={styles.statusRow}>
            <span className={
              result.status === "completed" ? styles.statusOk :
              result.status === "failed" ? styles.statusFail :
              styles.statusProcessing
            }>●</span>
            <span>{result.status}</span>
            {result.error ? <span className={styles.statusFail}>— {result.error.message}</span> : null}
          </div>
          {result.imageUrls && result.imageUrls.length > 0 ? (
            <div className={styles.results}>
              {result.imageUrls.map((url, i) => (
                <div key={i} className={styles.resultCard}>
                  <img className={styles.resultImg} src={url} alt={`Output ${i + 1}`} />
                  <div className={styles.resultMeta}>Output {i + 1}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}