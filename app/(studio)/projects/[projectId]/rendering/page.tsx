"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";

type RenderJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  presetId: string;
  outputAssetId: string | null;
  ffmpegVersion: string | null;
  renderDurationSeconds: number | null;
  error: { code: string; message: string } | null;
  startedAt: string | null;
  completedAt: string | null;
};

const PRESETS = [
  { id: "vertical_9_16", label: "Vertical 9:16 (1080×1920)" },
  { id: "landscape_16_9", label: "Landscape 16:9 (1920×1080)" },
  { id: "square_1_1", label: "Square 1:1 (1080×1080)" },
];

export default function RenderingPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [episodeId, setEpisodeId] = useState("");
  const [timelineId, setTimelineId] = useState("");
  const [presetId, setPresetId] = useState("landscape_16_9");
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!episodeId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ renderJobs: RenderJob[] }>(
        `/api/projects/${projectId}/episodes/${episodeId}/render`
      );
      setRenderJobs(data.renderJobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId, episodeId]);

  const triggerRender = useCallback(async () => {
    if (!timelineId) return;
    setTriggering(true);
    setError(null);
    try {
      await api(
        `/api/projects/${projectId}/episodes/${episodeId}/render`,
        {
          method: "POST",
          body: JSON.stringify({ timelineId, presetId }),
        }
      );
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render trigger failed");
    } finally {
      setTriggering(false);
    }
  }, [projectId, episodeId, timelineId, presetId, loadStatus]);

  const cancelRender = useCallback(async (renderJobId: string) => {
    setError(null);
    try {
      await api(
        `/api/projects/${projectId}/render/${renderJobId}/cancel`,
        { method: "POST" }
      );
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }, [projectId, loadStatus]);

  return (
    <StageLayout projectId={projectId} stage="rendering">
      <div className="grid gap-6">
        {error ? <p className="text-red-400">{error}</p> : null}
        {loading ? <p className="text-[#a39b8f]">Loading…</p> : null}

        <div className="grid gap-3">
          <input
            className="studio-field"
            placeholder="Episode ID"
            value={episodeId}
            onChange={(e) => setEpisodeId(e.target.value)}
          />
          <input
            className="studio-field"
            placeholder="Timeline ID (from approved assembly)"
            value={timelineId}
            onChange={(e) => setTimelineId(e.target.value)}
          />
          <select
            className="studio-field"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <Button onClick={loadStatus} disabled={!episodeId || loading}>
            Refresh status
          </Button>
          <Button
            onClick={triggerRender}
            disabled={!timelineId || !episodeId || triggering}
            variant="quiet"
          >
            {triggering ? "Starting..." : "Trigger render"}
          </Button>
        </div>

        {!loading && renderJobs.length === 0 && episodeId ? (
          <p className="text-[#a39b8f]">No render jobs yet for this episode.</p>
        ) : null}

        {renderJobs.length > 0 ? (
          <div className="grid gap-3">
            {renderJobs.map((job) => (
              <div key={job.id} className="rounded border border-[#2a2620] p-4">
                <div className="flex items-center justify-between">
                  <div className="grid gap-1">
                    <p className="font-medium">{job.presetId}</p>
                    <p className="text-sm text-[#a39b8f]">
                      Status:{" "}
                      <span className={
                        job.status === "completed" ? "text-green-400" :
                        job.status === "failed" ? "text-red-400" :
                        job.status === "cancelled" ? "text-yellow-400" :
                        job.status === "processing" ? "text-blue-400" :
                        "text-[#a39b8f]"
                      }>
                        {job.status}
                      </span>
                    </p>
                    {job.renderDurationSeconds ? (
                      <p className="text-sm text-[#a39b8f]">
                        Rendered in {job.renderDurationSeconds.toFixed(1)}s
                      </p>
                    ) : null}
                    {job.ffmpegVersion ? (
                      <p className="text-xs text-[#a39b8f]">{job.ffmpegVersion}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    {job.status === "queued" || job.status === "processing" ? (
                      <Button onClick={() => cancelRender(job.id)} variant="danger">
                        Cancel
                      </Button>
                    ) : null}
                    {job.status === "completed" && job.outputAssetId ? (
                      <a
                        href={`/api/projects/${projectId}/media/${job.outputAssetId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded border border-[#3a342c] px-3 py-1 text-sm text-[#cfc6b8] hover:border-[#4a453d]"
                      >
                        Download
                      </a>
                    ) : null}
                  </div>
                </div>
                {job.error ? (
                  <div className="mt-3 rounded border border-red-900/50 bg-red-950/20 p-3">
                    <p className="text-sm text-red-400">{job.error.code}: {job.error.message}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </StageLayout>
  );
}