"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";
import styles from "./canon.module.css";

type CanonData = {
  canon: {
    facts: Array<{ id: string; type: string; statement: string; source: string; status: string }>;
    version: number;
  } | null;
  proposals: Array<{ id: string; type: string; statement: string; source: string }>;
  contradictions: Array<{ id: string; factA: string; factB: string; sourceA: string; sourceB: string }>;
};

const CATEGORIES = ["all", "character", "location", "event", "relationship", "rule", "object"] as const;
type Category = (typeof CATEGORIES)[number];

export default function CanonPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [data, setData] = useState<CanonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [rebuilding, setRebuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<CanonData>(`/api/projects/${projectId}/continuity`);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load canon");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function rebuild() {
    setRebuilding(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/continuity/rebuild`, { method: "POST", body: JSON.stringify({ force: true }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  }

  const facts = data?.canon?.facts ?? [];
  const filtered = facts.filter((f) => (category === "all" || f.type === category) && f.statement.toLowerCase().includes(search.toLowerCase()));

  return (
    <StageLayout projectId={projectId} stage="canon">
      {data?.canon ? <p className="text-sm text-[#a39b8f] mt-2">Canon version {data.canon.version}</p> : null}

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.loading}>Loading…</p> : null}

      <div className={styles.categories}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`${styles.category} ${category === cat ? styles.categoryActive : ""}`}
            onClick={() => setCategory(cat)}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      <input className={styles.search} placeholder="Search canon facts…" value={search} onChange={(e) => setSearch(e.target.value)} />

      {!loading && filtered.length === 0 ? (
        <p className={styles.empty}>No canon facts found. Canon is established when documents are approved.</p>
      ) : null}

      <div className={styles.factList}>
        {filtered.map((fact) => (
          <div key={fact.id} className={styles.fact}>
            <p className={styles.factText}>{fact.statement}</p>
            <p className={styles.factMeta}>
              <span className={styles.factSource}>{fact.source}</span> · {fact.type} · {fact.status}
            </p>
          </div>
        ))}
      </div>

      {data && data.contradictions.length > 0 ? (
        <div className={styles.contradictions}>
          <div className={styles.contradictionsHeader}>
            <h3 className="font-display text-lg text-[#dfc18a]">Contradictions ({data.contradictions.length})</h3>
            <Button variant="quiet" size="sm" disabled={rebuilding} onClick={rebuild}>
              {rebuilding ? "Rebuilding…" : "Rebuild from Approved Episodes"}
            </Button>
          </div>
          {data.contradictions.map((c) => (
            <div key={c.id} className={styles.contradiction}>
              <p className="text-sm text-[#f0c2b8]">⚠ {c.factA}</p>
              <p className="text-sm text-[#a39b8f]">vs. {c.factB}</p>
              <p className="text-xs text-[#a39b8f]">Sources: {c.sourceA} vs. {c.sourceB}</p>
            </div>
          ))}
        </div>
      ) : null}
    </StageLayout>
  );
}