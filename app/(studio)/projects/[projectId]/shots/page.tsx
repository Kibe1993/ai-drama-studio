"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";

type ShotRecord = {
  id: string;
  shotNumber: number;
  productionStatus: "pending" | "in_progress" | "completed" | "failed";
  resultingAssetIds: string[];
  adjustedDurationSeconds: number | null;
  segments: { segmentNumber: number; durationSeconds: number; assetId?: string | null }[];
};

export default function ShotProductionPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [sceneId, setSceneId] = useState("");
  const [shots, setShots] = useState<ShotRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadShots = useCallback(async () => {
    if (!sceneId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ shots: ShotRecord[] }>(
        `/api/projects/${projectId}/scenes/${sceneId}/shots`
      );
      setShots(data.shots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId, sceneId]);

  const generateAll = useCallback(async () => {
    if (!sceneId) return;
    setError(null);
    try {
      await api(`/api/projects/${projectId}/scenes/${sceneId}/shots/generate`, { method: "POST" });
      await loadShots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    }
  }, [projectId, sceneId, loadShots]);

  const retry = useCallback(async () => {
    if (!sceneId) return;
    setError(null);
    try {
      await api(`/api/projects/${projectId}/scenes/${sceneId}/retry`, { method: "POST" });
      await loadShots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    }
  }, [projectId, sceneId, loadShots]);

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectHeader projectId={projectId} />
      <div className="mt-8 grid gap-6">
        <h1 className="font-display text-3xl">Shot Production</h1>
        {error ? <p className="text-red-400">{error}</p> : null}
        {loading ? <p className="text-[#a39b8f]">Loading…</p> : null}

        <div className="flex gap-3">
          <input
            className="studio-field flex-1"
            placeholder="Scene ID"
            value={sceneId}
            onChange={(e) => setSceneId(e.target.value)}
          />
          <Button onClick={loadShots} disabled={!sceneId || loading}>
            Load shots
          </Button>
          <Button variant="quiet" onClick={generateAll} disabled={!sceneId}>
            Generate all
          </Button>
          <Button variant="quiet" onClick={retry} disabled={!sceneId}>
            Retry failed
          </Button>
        </div>

        {!loading && shots.length === 0 && sceneId ? (
          <p className="text-[#a39b8f]">No shots found for this scene.</p>
        ) : null}

        {shots.length > 0 ? (
          <div className="rounded border border-[#39342d] p-6">
            <div className="grid gap-3">
              {shots.map((shot) => (
                <div key={shot.id} className="rounded border border-[#2a2620] p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Shot {shot.shotNumber}</p>
                    <span className={
                      shot.productionStatus === "completed" ? "text-green-400" :
                      shot.productionStatus === "failed" ? "text-red-400" :
                      shot.productionStatus === "in_progress" ? "text-yellow-400" :
                      "text-[#a39b8f]"
                    }>
                      {shot.productionStatus}
                    </span>
                  </div>
                  {shot.segments.length > 1 ? (
                    <p className="mt-2 text-sm text-[#a39b8f]">
                      Split into {shot.segments.length} segments
                      {shot.adjustedDurationSeconds ? ` (adjusted: ${shot.adjustedDurationSeconds.toFixed(1)}s)` : ""}
                    </p>
                  ) : null}
                  {shot.resultingAssetIds.length > 0 ? (
                    <p className="mt-2 text-sm text-[#a39b8f]">
                      {shot.resultingAssetIds.length} asset(s) generated
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}