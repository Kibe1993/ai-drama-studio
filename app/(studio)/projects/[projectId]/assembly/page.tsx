"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";

type TimelineClip = {
  assetId: string;
  startSeconds: number;
  durationSeconds: number;
  audioOffsetSeconds: number;
  transition: string;
  optional: boolean;
};

type TimelineTrack = {
  kind: "video" | "dialogue" | "narration" | "music" | "sfx" | "subtitle";
  clips: TimelineClip[];
};

type ValidationResult = {
  missingAssets: string[];
  overlaps: Record<string, unknown>[];
  brokenReferences: string[];
  durationMismatch: boolean;
  warnings: string[];
};

type Timeline = {
  id: string;
  status: "draft" | "under_review" | "approved" | "stale";
  tracks: TimelineTrack[];
  aspectRatio: string;
  outputResolution: string;
  frameRate: number;
  episodeTargetDurationSeconds: number | null;
  validation: ValidationResult;
} | null;

export default function AssemblyPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [episodeId, setEpisodeId] = useState("");
  const [timeline, setTimeline] = useState<Timeline>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!episodeId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ timeline: Timeline }>(
        `/api/projects/${projectId}/episodes/${episodeId}/assembly`
      );
      setTimeline(data.timeline);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setTimeline(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, episodeId]);

  const approve = useCallback(async () => {
    if (!episodeId) return;
    setApproving(true);
    setError(null);
    try {
      const data = await api<{ timeline: Timeline }>(
        `/api/projects/${projectId}/episodes/${episodeId}/assembly/approve`,
        { method: "POST" }
      );
      setTimeline(data.timeline);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setApproving(false);
    }
  }, [projectId, episodeId]);

  const hasBlockingErrors = timeline
    ? timeline.validation.missingAssets.length > 0 || timeline.validation.brokenReferences.length > 0
    : true;

  const totalDuration = (track?: TimelineTrack) =>
    track ? track.clips.reduce((sum, c) => sum + c.durationSeconds, 0) : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectHeader projectId={projectId} />
      <div className="mt-8 grid gap-6">
        <h1 className="font-display text-3xl">Timeline Assembly</h1>
        {error ? <p className="text-red-400">{error}</p> : null}
        {loading ? <p className="text-[#a39b8f]">Loading…</p> : null}

        <div className="flex gap-3">
          <input
            className="studio-field flex-1"
            placeholder="Episode ID"
            value={episodeId}
            onChange={(e) => setEpisodeId(e.target.value)}
          />
          <Button onClick={loadPreview} disabled={!episodeId || loading}>
            Preview timeline
          </Button>
        </div>

        {!loading && !timeline && episodeId ? (
          <p className="text-[#a39b8f]">No assembly found for this episode.</p>
        ) : null}

        {timeline ? (
          <div className="grid gap-4">
            <div className="rounded border border-[#39342d] p-6">
              <div className="flex items-center justify-between">
                <div className="grid gap-1">
                  <p className="font-medium">
                    {timeline.outputResolution} @ {timeline.frameRate}fps ({timeline.aspectRatio})
                  </p>
                  <p className="text-sm text-[#a39b8f]">
                    Status: <span className={
                      timeline.status === "approved" ? "text-green-400" :
                      timeline.status === "stale" ? "text-yellow-400" :
                      "text-[#a39b8f]"
                    }>{timeline.status}</span>
                  </p>
                </div>
                <Button
                  onClick={approve}
                  disabled={hasBlockingErrors || approving || timeline.status === "approved"}
                  variant="quiet"
                >
                  {approving ? "Approving..." : timeline.status === "approved" ? "Approved" : "Approve timeline"}
                </Button>
              </div>
            </div>

            {timeline.tracks.map((track, i) => (
              <div key={i} className="rounded border border-[#2a2620] p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium capitalize">{track.kind} track</p>
                  <p className="text-sm text-[#a39b8f]">
                    {track.clips.length} clip(s) — {totalDuration(track).toFixed(1)}s
                  </p>
                </div>
                <div className="mt-3 grid gap-2">
                  {track.clips.map((clip, j) => (
                    <div key={j} className="flex items-center gap-3 text-sm">
                      <span className="text-[#a39b8f]">#{j + 1}</span>
                      <span className="font-mono text-xs text-[#a39b8f]">{clip.assetId.slice(0, 12)}…</span>
                      <span>{clip.startSeconds.toFixed(1)}s → {(clip.startSeconds + clip.durationSeconds).toFixed(1)}s</span>
                      <span className="text-[#a39b8f]">({clip.durationSeconds.toFixed(1)}s)</span>
                      {clip.optional ? <span className="text-yellow-400">optional</span> : null}
                      {clip.transition ? <span className="text-[#a39b8f]">→ {clip.transition}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {(timeline.validation.missingAssets.length > 0 ||
              timeline.validation.brokenReferences.length > 0 ||
              timeline.validation.overlaps.length > 0 ||
              timeline.validation.durationMismatch ||
              timeline.validation.warnings.length > 0) ? (
              <div className="rounded border border-red-900/50 bg-red-950/20 p-4">
                <p className="font-medium text-red-400">Validation findings</p>
                <ul className="mt-2 grid gap-1 text-sm text-red-300">
                  {timeline.validation.missingAssets.map((id) => (
                    <li key={`missing-${id}`}>Missing asset: {id}</li>
                  ))}
                  {timeline.validation.brokenReferences.map((id) => (
                    <li key={`broken-${id}`}>Broken reference: {id}</li>
                  ))}
                  {timeline.validation.overlaps.map((o, k) => (
                    <li key={`overlap-${k}`}>Overlap in {String(o.track ?? "unknown")} track</li>
                  ))}
                  {timeline.validation.durationMismatch ? (
                    <li>Duration mismatch: video total differs from target by more than 10%</li>
                  ) : null}
                  {timeline.validation.warnings.map((w, k) => (
                    <li key={`warn-${k}`} className="text-yellow-400">{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded border border-green-900/50 bg-green-950/20 p-4">
                <p className="text-green-400">No validation issues — timeline is ready for approval.</p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}