"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";
import styles from "./productionDesign.module.css";

type Scene = { id: string; sceneNumber: number; heading: string };
type Shot = {
  shotNumber: number;
  type: string;
  cameraDirection: string;
  cameraMovement: string;
  lens: string;
  framing: string;
  duration: number;
  lightingSetup: string;
  lightingNotes: string;
  storyboardDescription: string;
  visualContinuityNotes: string;
};
type Design = {
  id: string;
  version: number;
  status: string;
  shotList: Shot[];
  locationDesign: { dressing: string; props: string; atmosphere: string };
} | null;

export default function ProductionDesignPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedScene, setSelectedScene] = useState<string>("");
  const [design, setDesign] = useState<Design>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ scenes: Scene[] }>(`/api/projects/${projectId}/scenes`);
        setScenes(data.scenes);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load scenes");
      }
    })();
  }, [projectId]);

  const loadDesign = useCallback(async (sceneId: string) => {
    if (!sceneId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ design: Design }>(`/api/projects/${projectId}/production-design/${sceneId}`);
      setDesign(data.design);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load design");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { if (selectedScene) void loadDesign(selectedScene); }, [selectedScene, loadDesign]);

  async function save() {
    if (!design || !selectedScene) return;
    setSaving(true);
    setError(null);
    try {
      const { id, version, status, ...data } = design;
      void id; void version; void status;
      const res = await api<{ design: Design }>(`/api/projects/${projectId}/production-design/${selectedScene}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      setDesign(res.design);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!design || !selectedScene) return;
    setSaving(true);
    try {
      const res = await api<{ design: Design }>(`/api/projects/${projectId}/production-design/${selectedScene}/approve`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: design.version }),
      });
      setDesign(res.design);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setSaving(false);
    }
  }

  function updateShot(index: number, field: keyof Shot, value: unknown) {
    if (!design) return;
    const shotList = [...design.shotList];
    shotList[index] = { ...shotList[index], [field]: value };
    setDesign({ ...design, shotList });
  }

  function addShot() {
    if (!design) return;
    setDesign({ ...design, shotList: [...design.shotList, { shotNumber: design.shotList.length + 1, type: "medium", cameraDirection: "", cameraMovement: "", lens: "", framing: "", duration: 0, lightingSetup: "", lightingNotes: "", storyboardDescription: "", visualContinuityNotes: "" }] });
  }

  return (
    <div className={styles.page}>
      <ProjectHeader projectId={projectId} />
      <h2 className="font-display text-3xl mt-8">Production Design</h2>

      <div className={styles.sceneSelect}>
        <select className={styles.select} value={selectedScene} onChange={(e) => setSelectedScene(e.target.value)}>
          <option value="">Select a scene…</option>
          {scenes.map((s) => <option key={s.id} value={s.id}>Scene {s.sceneNumber}: {s.heading}</option>)}
        </select>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.loading}>Loading…</p> : null}

      {!selectedScene ? <p className={styles.empty}>Select a scene to view or edit its production design.</p> : null}

      {design && selectedScene ? (
        <>
          <table className={styles.shotTable}>
            <thead>
              <tr>
                <th>#</th><th>Type</th><th>Camera</th><th>Movement</th><th>Lens</th><th>Duration</th><th>Lighting</th>
              </tr>
            </thead>
            <tbody>
              {design.shotList.map((shot, i) => (
                <tr key={i}>
                  <td>{shot.shotNumber}</td>
                  <td><input className={styles.shotInput} value={shot.type} onChange={(e) => updateShot(i, "type", e.target.value)} /></td>
                  <td><input className={styles.shotInput} value={shot.cameraDirection} onChange={(e) => updateShot(i, "cameraDirection", e.target.value)} /></td>
                  <td><input className={styles.shotInput} value={shot.cameraMovement} onChange={(e) => updateShot(i, "cameraMovement", e.target.value)} /></td>
                  <td><input className={styles.shotInput} value={shot.lens} onChange={(e) => updateShot(i, "lens", e.target.value)} /></td>
                  <td><input className={styles.shotInput} type="number" value={shot.duration} onChange={(e) => updateShot(i, "duration", Number(e.target.value))} /></td>
                  <td><input className={styles.shotInput} value={shot.lightingSetup} onChange={(e) => updateShot(i, "lightingSetup", e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.addShot}><Button variant="quiet" size="sm" onClick={addShot}>Add Shot</Button></div>

          <div className={styles.section}>
            <h3 className="font-display text-lg">Location Design</h3>
            <div className={styles.field}>
              <label className={styles.label}>Dressing</label>
              <textarea className={styles.textarea} value={design.locationDesign.dressing} onChange={(e) => setDesign({ ...design, locationDesign: { ...design.locationDesign, dressing: e.target.value } })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Props</label>
              <textarea className={styles.textarea} value={design.locationDesign.props} onChange={(e) => setDesign({ ...design, locationDesign: { ...design.locationDesign, props: e.target.value } })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Atmosphere</label>
              <textarea className={styles.textarea} value={design.locationDesign.atmosphere} onChange={(e) => setDesign({ ...design, locationDesign: { ...design.locationDesign, atmosphere: e.target.value } })} />
            </div>
          </div>

          <div className={styles.actions}>
            <Button variant="primary" size="sm" disabled={saving} onClick={save}>Save</Button>
            {design.status === "draft" ? <Button variant="quiet" size="sm" disabled={saving} onClick={approve}>Approve</Button> : null}
          </div>
        </>
      ) : null}

      {selectedScene && !design ? (
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={() => setDesign({ id: "", version: 1, status: "draft", shotList: [], locationDesign: { dressing: "", props: "", atmosphere: "" } })}>Create Production Design</Button>
        </div>
      ) : null}
    </div>
  );
}