"use client";

import { useCallback, useEffect, useState } from "react";
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

type Episode = {
  id: string;
  episodeNumber: number;
  title: string;
};

type Timeline = {
  id: string;
  status: string;
};

const PRESETS = [
  { id: "vertical_9_16", label: "Vertical 9:16 (1080×1920)" },
  { id: "landscape_16_9", label: "Landscape 16:9 (1920×1080)" },
  { id: "square_1_1", label: "Square 1:1 (1080×1080)" },
];

export default function RenderingPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeId, setEpisodeId] = useState("");
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [timelineId, setTimelineId] = useState("");
  const [presetId, setPresetId] = useState("landscape_16_9");
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [episodesLoading, setEpisodesLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api<{ episodes: Episode[] }>(`/api/projects/${projectId}/episodes`)
      .then((data) => { if (active) setEpisodes(data.episodes); })
      .catch(() => { if (active) setError("Failed to load episodes."); })
      .finally(() => { if (active) setEpisodesLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!episodeId) { setTimelines([]); setTimelineId(""); return; }
    let active = true;
    api<{ timelines: Timeline[] }>(`/api/projects/${projectId}/episodes/${episodeId}/timelines`)
      .then((data) => { if (active) setTimelines(data.timelines); })
      .catch(() => { if (active) setTimelines([]); });
    return () => { active = false; };
  }, [projectId, episodeId]);

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
        { method: "POST", body: JSON.stringify({ timelineId, presetId }) }
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
      await api(`/api/projects/${projectId}/render/${renderJobId}/cancel`, { method: "POST" });
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
          <select
            className="studio-field"
            value={episodeId}
            onChange={(e) => { setEpisodeId(e.target.value); setRenderJobs([]); setTimelineId(""); }}
            disabled={episodesLoading}
          >
            <option value="">{episodesLoading ? "Loading episodes…" : "Select an episode…"}</option>
            {episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>
                Episode {ep.episodeNumber}: {ep.title || "Untitled"}
              </option>
            ))}
          </select>
          <select
            className="studio-field"
            value={timelineId}
            onChange={(e) => setTimelineId(e.target.value)}
            disabled={!episodeId || timelines.length === 0}
          >
            <option value="">
              {!episodeId ? "Select an episode first…" : timelines.length === 0 ? "No timelines found…" : "Select a timeline…"}
            </option>
            {timelines.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id.slice(0, 12)}… ({t.status})
              </option>
            ))}
          </select>
          <select className="studio-field" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <Button onClick={loadStatus} disabled={!episodeId || loading}>Refresh status</Button>
          <Button onClick={triggerRender} disabled={!timelineId || !episodeId || triggering} variant="quiet">
            {triggering ? "Starting..." : "Trigger render"}
          </Button>
        </div>

        {!episodesLoading && episodes.length === 0 ? (
          <p className="text-[#a39b8f]">No episodes found. Generate episodes first.</p>
        ) : null}

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
                      }>{job.status}</span>
                    </p>
                    {job.renderDurationSeconds ? (
                      <p className="text-sm text-[#a39b8f]">Rendered in {job.renderDurationSeconds.toFixed(1)}s</p>
                    ) : null}
                    {job.ffmpegVersion ? (
                      <p className="text-xs text-[#a39b8f]">{job.ffmpegVersion}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    {job.status === "queued" || job.status === "processing" ? (
                      <Button onClick={() => cancelRender(job.id)} variant="danger">Cancel</Button>
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