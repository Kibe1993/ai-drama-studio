"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";
import styles from "./characters.module.css";

type Entity = {
  id: string;
  entityType: "character" | "location" | "object";
  name: string;
  description: string;
  status: "pending_review" | "approved";
  defaultReferenceAssetId: string | null;
};

type Tab = "characters" | "locations" | "objects";

export default function CharactersPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [tab, setTab] = useState<Tab>("characters");
  const [entities, setEntities] = useState<{ characters: Entity[]; environments: Entity[]; objects: Entity[] } | null>(null);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ characters: Entity[]; environments: Entity[]; objects: Entity[] }>(
        `/api/projects/${projectId}/visual-assets`
      );
      setEntities(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const list = entities ? (tab === "characters" ? entities.characters : tab === "locations" ? entities.environments : entities.objects) : [];
  const filtered = list.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));

  async function approveEntity(entityId: string) {
    try {
      await api(`/api/projects/${projectId}/visual-assets/entities/${entityId}/approve`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    }
  }

  return (
    <div className={styles.page}>
      <ProjectHeader projectId={projectId} />
      <h2 className="font-display text-3xl mt-8">Characters & Locations</h2>

      <div className={styles.tabs}>
        {(["characters", "locations", "objects"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
            onClick={() => { setTab(t); setSelected(null); }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.filter}>
        <input
          className={styles.input}
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.loading}>Loading…</p> : null}

      {!loading && filtered.length === 0 ? (
        <p className={styles.empty}>No {tab} yet. Generate characters from the Story Bible or create one manually.</p>
      ) : null}

      <div className={styles.grid}>
        {filtered.map((entity) => (
          <div key={entity.id} className={styles.card} onClick={() => setSelected(entity)}>
            <p className={styles.cardTitle}>{entity.name}</p>
            <p className={`${styles.cardStatus} ${entity.status === "approved" ? styles.statusApproved : styles.statusPending}`}>
              {entity.status === "approved" ? "Approved" : "Pending review"}
            </p>
            <p className={styles.cardStatus}>{entity.description.slice(0, 100)}</p>
          </div>
        ))}
      </div>

      {selected ? (
        <div className={styles.detail}>
          <h3 className="font-display text-xl">{selected.name}</h3>
          <div className={styles.field}>
            <label className={styles.label}>Description</label>
            <textarea className={styles.textarea} value={selected.description} readOnly />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Status</label>
            <p className={selected.status === "approved" ? styles.statusApproved : styles.statusPending}>
              {selected.status === "approved" ? "Approved" : "Pending review"}
            </p>
          </div>
          <div className={styles.actions}>
            {selected.status !== "approved" ? (
              <Button variant="primary" size="sm" onClick={() => approveEntity(selected.id)}>Approve</Button>
            ) : null}
            <Button variant="quiet" size="sm" onClick={() => setSelected(null)}>Close</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}