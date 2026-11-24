"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";
import styles from "./scenes.module.css";

type Scene = {
  id: string;
  sceneNumber: number;
  heading: string;
  location: string;
  timeOfDay: string;
  charactersPresent: string[];
  status: string;
  approvedAt: string | null;
};

export default function ScenesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [selected, setSelected] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ scenes: Scene[] }>(`/api/projects/${projectId}/scenes`);
      setScenes(data.scenes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scenes");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={styles.page}>
      <ProjectHeader projectId={projectId} />
      <h2 className="font-display text-3xl mt-8">Scene Breakdown</h2>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.loading}>Loading…</p> : null}

      {!loading && scenes && scenes.length === 0 ? (
        <p className={styles.empty}>No scenes yet. Generate a scene breakdown from the screenplay.</p>
      ) : null}

      <div className={styles.list}>
        {scenes?.map((scene) => (
          <div
            key={scene.id}
            className={`${styles.sceneRow} ${selected?.id === scene.id ? styles.sceneRowActive : ""}`}
            onClick={() => setSelected(scene)}
          >
            <span className={styles.sceneNumber}>Scene {scene.sceneNumber}</span>
            <p className={styles.sceneHeading}>{scene.heading}</p>
            <p className={styles.sceneMeta}>
              {scene.location} · {scene.timeOfDay} · {scene.charactersPresent.join(", ")}
              {scene.approvedAt ? " · Approved" : " · Draft"}
            </p>
          </div>
        ))}
      </div>

      {selected ? (
        <div className={styles.detail}>
          <h3 className="font-display text-xl">Scene {selected.sceneNumber}</h3>
          <div className={styles.field}>
            <label className={styles.label}>Heading</label>
            <input className={styles.input} value={selected.heading} readOnly />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Location</label>
            <input className={styles.input} value={selected.location} readOnly />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Time of Day</label>
            <input className={styles.input} value={selected.timeOfDay} readOnly />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Characters Present</label>
            <input className={styles.input} value={selected.charactersPresent.join(", ")} readOnly />
          </div>
          <div className={styles.actions}>
            <Button variant="quiet" size="sm" onClick={() => setSelected(null)}>Close</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}