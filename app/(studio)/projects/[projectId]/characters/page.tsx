"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
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
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "" });
  const [creating, setCreating] = useState(false);

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

  async function createObject() {
    if (!createForm.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/visual-assets/objects`, {
        method: "POST",
        body: JSON.stringify({ name: createForm.name.trim(), description: createForm.description.trim() || undefined }),
      });
      setShowCreate(false);
      setCreateForm({ name: "", description: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create object");
    } finally {
      setCreating(false);
    }
  }

  const emptyMessage = tab === "objects"
    ? "No objects yet. Create one manually or use an AI assistant via MCP."
    : `No ${tab} yet. Use an AI assistant via MCP to extract ${tab} from the Story Bible.`;

  return (
    <StageLayout projectId={projectId} stage="characters">

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
        {tab === "objects" ? (
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>+ Create Object</Button>
        ) : null}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.loading}>Loading…</p> : null}

      {!loading && filtered.length === 0 ? (
        <p className={styles.empty}>{emptyMessage}</p>
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

      {showCreate ? (
        <div className={styles.detail}>
          <h3 className="font-display text-xl">Create Object</h3>
          <div className={styles.field}>
            <label className={styles.label}>Name</label>
            <input
              className={styles.input}
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Object name"
              maxLength={160}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Description</label>
            <textarea
              className={styles.textarea}
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
              maxLength={1200}
            />
          </div>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={createObject} disabled={creating || !createForm.name.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </StageLayout>
  );
}