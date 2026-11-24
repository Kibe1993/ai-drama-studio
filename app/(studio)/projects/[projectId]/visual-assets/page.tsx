"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";

type Entity = {
  id: string;
  entityType: "character" | "location" | "object";
  name: string;
  description: string;
  status: "pending_review" | "approved";
  defaultReferenceAssetId: string | null;
};

type ReferenceAsset = {
  id: string;
  type: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  reviewStatus: "pending" | "approved" | "rejected" | "archived";
  previousVersionId: string | null;
  replacedById: string | null;
  createdAt: string;
};

export default function VisualAssetsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [entities, setEntities] = useState<{ characters: Entity[]; environments: Entity[]; objects: Entity[] } | null>(null);
  const [references, setReferences] = useState<Record<string, ReferenceAsset[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntities = useCallback(async () => {
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

  const loadReferences = useCallback(async (entity: Entity) => {
    const endpoints: Record<Entity["entityType"], string> = {
      character: `/api/projects/${projectId}/visual-assets/characters/${entity.id}/reference`,
      location: `/api/projects/${projectId}/visual-assets/environments/${entity.id}/reference`,
      object: `/api/projects/${projectId}/visual-assets/objects/${entity.id}/reference`,
    };
    try {
      const data = await api<{ references: ReferenceAsset[] }>(endpoints[entity.entityType]);
      setReferences((prev) => ({ ...prev, [entity.id]: data.references }));
    } catch {
      setReferences((prev) => ({ ...prev, [entity.id]: [] }));
    }
  }, [projectId]);

  const reviewAsset = useCallback(async (assetId: string, action: "approve" | "reject") => {
    setError(null);
    try {
      await api(`/api/projects/${projectId}/media/${assetId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      await loadEntities();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    }
  }, [projectId, loadEntities]);

  useEffect(() => {
    if (!entities && !loading) {
      void loadEntities();
    }
  }, [entities, loading, loadEntities]);

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectHeader projectId={projectId} />
      <div className="mt-8 grid gap-6">
        <h1 className="font-display text-3xl">Visual Assets</h1>
        {error ? <p className="text-red-400">{error}</p> : null}
        {loading ? <p className="text-[#a39b8f]">Loading…</p> : null}

        {entities ? (
          <>
            <EntitySection
              title="Characters"
              entities={entities.characters}
              references={references}
              onLoadRefs={loadReferences}
              onReview={reviewAsset}
            />
            <EntitySection
              title="Environments"
              entities={entities.environments}
              references={references}
              onLoadRefs={loadReferences}
              onReview={reviewAsset}
            />
            <EntitySection
              title="Objects"
              entities={entities.objects}
              references={references}
              onLoadRefs={loadReferences}
              onReview={reviewAsset}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function EntitySection({
  title,
  entities,
  references,
  onLoadRefs,
  onReview,
}: {
  title: string;
  entities: Entity[];
  references: Record<string, ReferenceAsset[]>;
  onLoadRefs: (entity: Entity) => void;
  onReview: (assetId: string, action: "approve" | "reject") => void;
}) {
  if (entities.length === 0) return (
    <section className="rounded border border-[#39342d] p-6">
      <h2 className="font-display text-xl">{title}</h2>
      <p className="mt-3 text-sm text-[#a39b8f]">No {title.toLowerCase()} found.</p>
    </section>
  );
  return (
    <section className="rounded border border-[#39342d] p-6">
      <h2 className="font-display text-xl">{title}</h2>
      <div className="mt-4 grid gap-4">
        {entities.map((entity) => (
          <div key={entity.id} className="rounded border border-[#2a2620] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{entity.name}</p>
                <p className="text-sm text-[#a39b8f]">
                  {entity.status === "approved" ? "Approved" : "Pending review"}
                </p>
              </div>
              <Button variant="quiet" onClick={() => onLoadRefs(entity)}>
                Load references
              </Button>
            </div>
            {(references[entity.id] ?? []).map((asset) => (
              <div key={asset.id} className="mt-3 flex items-center justify-between rounded bg-[#1a1815] p-3">
                <div className="text-sm">
                  <span className="text-[#a39b8f]">{asset.mimeType}</span>
                  {" · "}
                  <span className={
                    asset.reviewStatus === "approved" ? "text-green-400" :
                    asset.reviewStatus === "rejected" ? "text-red-400" :
                    asset.reviewStatus === "archived" ? "text-[#a39b8f]" :
                    "text-yellow-400"
                  }>
                    {asset.reviewStatus}
                  </span>
                </div>
                <div className="flex gap-2">
                  {asset.reviewStatus === "pending" ? (
                    <>
                      <Button variant="quiet" onClick={() => onReview(asset.id, "approve")}>
                        Approve
                      </Button>
                      <Button variant="quiet" onClick={() => onReview(asset.id, "reject")}>
                        Reject
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}