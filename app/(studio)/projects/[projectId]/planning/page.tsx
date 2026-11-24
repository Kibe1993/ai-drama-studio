"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";
import styles from "./planning.module.css";

type Planning = {
  id: string;
  version: number;
  status: "draft" | "submitted" | "approved" | "rejected";
  rejectionReason: string | null;
  concept: { logline: string; synopsis: string; elevatorPitch: string };
  themes: string[];
  centralQuestion: string;
  mainConflict: string;
  audience: { demographic: string; tone: string; contentRating: string };
  narrativeDirection: { structure: string; pov: string; pacing: string };
} | null;

export default function PlanningPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [planning, setPlanning] = useState<Planning>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newTheme, setNewTheme] = useState("");
  const [versions, setVersions] = useState<NonNullable<Planning>[]>([]);
  const [showVersions, setShowVersions] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ planning: Planning }>(`/api/projects/${projectId}/planning`);
      setPlanning(data.planning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const loadVersions = useCallback(async () => {
    try {
      const data = await api<{ versions: NonNullable<Planning>[] }>(`/api/projects/${projectId}/planning/versions`);
      setVersions(data.versions);
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);

  function update(field: string, value: unknown) {
    setPlanning((prev) => prev ? { ...prev, [field]: value } : prev);
  }

  async function save() {
    if (!planning) return;
    setSaving(true);
    setError(null);
    try {
      const { id, version, status, rejectionReason, ...data } = planning;
      void id; void version; void status; void rejectionReason;
      const res = await api<{ planning: Planning }>(`/api/projects/${projectId}/planning`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      setPlanning(res.planning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function createPlanning() {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ planning: Planning }>(`/api/projects/${projectId}/planning`, {
        method: "POST",
        body: JSON.stringify({
          concept: { logline: "", synopsis: "", elevatorPitch: "" },
          themes: [],
          centralQuestion: "",
          mainConflict: "",
          audience: { demographic: "", tone: "", contentRating: "" },
          narrativeDirection: { structure: "", pov: "", pacing: "" },
        }),
      });
      setPlanning(res.planning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ planning: Planning }>(`/api/projects/${projectId}/planning/submit`, { method: "POST" });
      setPlanning(res.planning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!planning) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ planning: Planning }>(`/api/projects/${projectId}/planning/approve`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: planning.version }),
      });
      setPlanning(res.planning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <StageLayout projectId={projectId} stage="planning"><p className={styles.loading}>Loading…</p></StageLayout>;

  return (
    <StageLayout projectId={projectId} stage="planning">
      {planning ? (
        <p className={styles.version}>Version {planning.version} · <span className={`${styles.status} ${planning.status === "approved" ? styles.statusApproved : planning.status === "submitted" ? styles.statusSubmitted : planning.status === "rejected" ? styles.statusRejected : styles.statusDraft}`}>{planning.status}</span></p>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      {!planning ? (
        <p className={styles.empty}>No planning document yet. Start by creating one below.</p>
      ) : (
        <>
          <div className={styles.section}>
            <h3 className="font-display text-lg">Concept</h3>
            <div className={styles.field}>
              <label className={styles.label}>Logline</label>
              <input className={styles.input} value={planning.concept.logline} onChange={(e) => update("concept", { ...planning.concept, logline: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Synopsis</label>
              <textarea className={styles.textarea} value={planning.concept.synopsis} onChange={(e) => update("concept", { ...planning.concept, synopsis: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Elevator Pitch</label>
              <input className={styles.input} value={planning.concept.elevatorPitch} onChange={(e) => update("concept", { ...planning.concept, elevatorPitch: e.target.value })} />
            </div>
          </div>

          <div className={styles.section}>
            <h3 className="font-display text-lg">Themes & Conflict</h3>
            <div className={styles.field}>
              <label className={styles.label}>Themes</label>
              <div className={styles.tags}>
                {planning.themes.map((theme, i) => (
                  <span key={i} className={styles.tag}>
                    {theme}
                    <span className={styles.tagRemove} onClick={() => update("themes", planning.themes.filter((_, j) => j !== i))}>×</span>
                  </span>
                ))}
              </div>
              <input className={styles.input} placeholder="Add theme…" value={newTheme} onChange={(e) => setNewTheme(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newTheme.trim()) { update("themes", [...planning.themes, newTheme.trim()]); setNewTheme(""); } }} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Central Question</label>
              <input className={styles.input} value={planning.centralQuestion} onChange={(e) => update("centralQuestion", e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Main Conflict</label>
              <textarea className={styles.textarea} value={planning.mainConflict} onChange={(e) => update("mainConflict", e.target.value)} />
            </div>
          </div>

          <div className={styles.section}>
            <h3 className="font-display text-lg">Audience</h3>
            <div className={styles.field}>
              <label className={styles.label}>Demographic</label>
              <input className={styles.input} value={planning.audience.demographic} onChange={(e) => update("audience", { ...planning.audience, demographic: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Tone</label>
              <input className={styles.input} value={planning.audience.tone} onChange={(e) => update("audience", { ...planning.audience, tone: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Content Rating</label>
              <input className={styles.input} value={planning.audience.contentRating} onChange={(e) => update("audience", { ...planning.audience, contentRating: e.target.value })} />
            </div>
          </div>

          <div className={styles.section}>
            <h3 className="font-display text-lg">Narrative Direction</h3>
            <div className={styles.field}>
              <label className={styles.label}>Structure</label>
              <input className={styles.input} value={planning.narrativeDirection.structure} onChange={(e) => update("narrativeDirection", { ...planning.narrativeDirection, structure: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Point of View</label>
              <input className={styles.input} value={planning.narrativeDirection.pov} onChange={(e) => update("narrativeDirection", { ...planning.narrativeDirection, pov: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Pacing</label>
              <input className={styles.input} value={planning.narrativeDirection.pacing} onChange={(e) => update("narrativeDirection", { ...planning.narrativeDirection, pacing: e.target.value })} />
            </div>
          </div>

          <div className={styles.actions}>
            <Button variant="primary" size="sm" disabled={saving} onClick={save}>Save</Button>
            {planning.status === "draft" || planning.status === "rejected" ? (
              <Button variant="quiet" size="sm" disabled={saving} onClick={submit}>Submit for Review</Button>
            ) : null}
            {planning.status === "submitted" ? (
              <Button variant="primary" size="sm" disabled={saving} onClick={approve}>Approve</Button>
            ) : null}
          </div>

          {planning.status === "rejected" && planning.rejectionReason ? (
            <p className={styles.error}>Rejection reason: {planning.rejectionReason}</p>
          ) : null}
        </>
      )}

      {!planning ? (
        <Button variant="primary" disabled={saving} onClick={createPlanning}>{saving ? "Creating…" : "Create Planning Document"}</Button>
      ) : null}

      {versions.length > 1 ? (
        <div className={styles.versionsSection}>
          <button type="button" className={styles.versionsToggle} onClick={() => setShowVersions(!showVersions)}>
            {showVersions ? "Hide" : "Show"} Version History ({versions.length})
          </button>
          {showVersions ? (
            <div className={styles.versionList}>
              {versions.map((v) => (
                <div key={v.id} className={styles.versionItem}>
                  <span className={styles.versionNum}>v{v.version}</span>
                  <span className={`${styles.status} ${v.status === "approved" ? styles.statusApproved : v.status === "submitted" ? styles.statusSubmitted : v.status === "rejected" ? styles.statusRejected : styles.statusDraft}`}>{v.status}</span>
                  {v.id === planning?.id ? <span className={styles.currentTag}>current</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </StageLayout>
  );
}