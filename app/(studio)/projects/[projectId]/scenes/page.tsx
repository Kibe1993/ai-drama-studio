"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";
import styles from "./scenes.module.css";

type ShotPlan = {
  shotNumber: number;
  purpose: string;
  framing: string;
  cameraAngle: string;
  cameraDirection: string;
  action: string;
  environment: string;
  lighting: string;
  continuity: string;
  estimatedDurationSeconds: number | null;
};

type DialogueLine = { character: string; line: string; parenthetical?: string };

type Scene = {
  id: string;
  sceneNumber: number;
  title: string;
  location: string;
  interiorExterior: "interior" | "exterior" | "";
  timeOfDay: string;
  charactersPresent: string[];
  visualDescription: string;
  action: string;
  dialogue: DialogueLine[];
  cameraDirection: string;
  estimatedDurationSeconds: number | null;
  shotPlan: ShotPlan[];
  videoReady: boolean;
  videoStatus: string;
  failed: boolean;
  productionStatus: string;
  approvedAt: string | null;
};

type Run = {
  id: string;
  status: string;
  currentStage: string;
};

export default function ScenesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [selected, setSelected] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Scene> | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ run: Run | null; scenes: Scene[] }>(`/api/projects/${projectId}/scenes`);
      setScenes(data.scenes);
      setRun(data.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scenes");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const canEdit = run?.status === "waiting_for_approval" && run?.currentStage === "scenes";

  function startEdit(scene: Scene) {
    setEditing(true);
    setEditForm({
      title: scene.title,
      location: scene.location,
      interiorExterior: scene.interiorExterior,
      timeOfDay: scene.timeOfDay,
      charactersPresent: scene.charactersPresent,
      visualDescription: scene.visualDescription,
      action: scene.action,
      dialogue: scene.dialogue,
      cameraDirection: scene.cameraDirection,
      estimatedDurationSeconds: scene.estimatedDurationSeconds,
      shotPlan: scene.shotPlan,
    });
  }

  async function saveEdit() {
    if (!selected || !editForm) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/scenes?sceneNumber=${selected.sceneNumber}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editForm.title ?? "",
          location: editForm.location ?? "",
          interiorExterior: editForm.interiorExterior ?? "",
          timeOfDay: editForm.timeOfDay ?? "",
          charactersPresent: editForm.charactersPresent ?? [],
          visualDescription: editForm.visualDescription ?? "",
          action: editForm.action ?? "",
          dialogue: editForm.dialogue ?? [],
          cameraDirection: editForm.cameraDirection ?? "",
          estimatedDurationSeconds: editForm.estimatedDurationSeconds ?? null,
          shotPlan: editForm.shotPlan ?? [],
        }),
      });
      setEditing(false);
      setEditForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save scene");
    } finally {
      setSaving(false);
    }
  }

  async function approveScene() {
    if (!selected) return;
    setApproving(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/scenes/${selected.id}/approve`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve scene");
    } finally {
      setApproving(false);
    }
  }

  return (
    <StageLayout projectId={projectId} stage="scenes">

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.loading}>Loading…</p> : null}

      {!loading && scenes && scenes.length === 0 ? (
        <p className={styles.empty}>No scenes yet. Use an AI assistant via MCP to break down the screenplay into scenes.</p>
      ) : null}

      <div className={styles.list}>
        {scenes?.map((scene) => (
          <div
            key={scene.id}
            className={`${styles.sceneRow} ${selected?.id === scene.id ? styles.sceneRowActive : ""}`}
            onClick={() => { setSelected(scene); setEditing(false); setEditForm(null); }}
          >
            <span className={styles.sceneNumber}>Scene {scene.sceneNumber}</span>
            <p className={styles.sceneHeading}>{scene.title}</p>
            <p className={styles.sceneMeta}>
              {scene.location}{scene.interiorExterior ? ` (${scene.interiorExterior})` : ""} · {scene.timeOfDay} · {scene.charactersPresent.join(", ")}
              {scene.approvedAt ? " · Approved" : " · Draft"}
            </p>
          </div>
        ))}
      </div>

      {selected ? (
        <div className={styles.detail}>
          <h3 className="font-display text-xl">Scene {selected.sceneNumber}</h3>
          <div className={styles.field}>
            <label className={styles.label}>Title</label>
            <input
              className={styles.input}
              value={editing ? (editForm?.title ?? "") : selected.title}
              readOnly={!editing}
              onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Location</label>
            <input
              className={styles.input}
              value={editing ? (editForm?.location ?? "") : selected.location}
              readOnly={!editing}
              onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Time of Day</label>
            <input
              className={styles.input}
              value={editing ? (editForm?.timeOfDay ?? "") : selected.timeOfDay}
              readOnly={!editing}
              onChange={(e) => setEditForm((f) => ({ ...f, timeOfDay: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Characters Present</label>
            <input
              className={styles.input}
              value={(editing ? editForm?.charactersPresent : selected.charactersPresent)?.join(", ") ?? ""}
              readOnly={!editing}
              onChange={(e) => setEditForm((f) => ({ ...f, charactersPresent: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Visual Description</label>
            <textarea
              className={styles.textarea}
              value={editing ? (editForm?.visualDescription ?? "") : selected.visualDescription}
              readOnly={!editing}
              onChange={(e) => setEditForm((f) => ({ ...f, visualDescription: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Action</label>
            <textarea
              className={styles.textarea}
              value={editing ? (editForm?.action ?? "") : selected.action}
              readOnly={!editing}
              onChange={(e) => setEditForm((f) => ({ ...f, action: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Camera Direction</label>
            <textarea
              className={styles.textarea}
              value={editing ? (editForm?.cameraDirection ?? "") : selected.cameraDirection}
              readOnly={!editing}
              onChange={(e) => setEditForm((f) => ({ ...f, cameraDirection: e.target.value }))}
            />
          </div>
          {selected.shotPlan && selected.shotPlan.length > 0 ? (
            <div className={styles.field}>
              <label className={styles.label}>Shot Plan ({selected.shotPlan.length} shots)</label>
              {selected.shotPlan.map((shot) => (
                <div key={shot.shotNumber} className={styles.sceneRow}>
                  <span className={styles.sceneNumber}>Shot {shot.shotNumber}</span>
                  <p className={styles.sceneHeading}>{shot.purpose}</p>
                  <p className={styles.sceneMeta}>
                    {shot.framing} · {shot.cameraAngle} · {shot.estimatedDurationSeconds ? `${shot.estimatedDurationSeconds}s` : "—"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <div className={styles.actions}>
            {editing ? (
              <>
                <Button variant="primary" size="sm" onClick={saveEdit} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button variant="quiet" size="sm" onClick={() => { setEditing(false); setEditForm(null); }} disabled={saving}>Cancel</Button>
              </>
            ) : (
              <>
                {canEdit && !selected.approvedAt ? (
                  <Button variant="primary" size="sm" onClick={() => startEdit(selected)}>Edit</Button>
                ) : null}
                {!selected.approvedAt ? (
                  <Button variant="primary" size="sm" onClick={approveScene} disabled={approving}>
                    {approving ? "Approving…" : "Approve"}
                  </Button>
                ) : null}
                <Button variant="quiet" size="sm" onClick={() => setSelected(null)}>Close</Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </StageLayout>
  );
}