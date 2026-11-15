"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/hooks/api";
import { useProduction } from "@/hooks/useProduction";

type AudioSegment = {
  id: string;
  sceneNumber: number;
  sequence: number;
  speakerType: "character" | "narrator";
  speakerName: string;
  text: string;
  kind: "dialogue" | "narration";
  voiceIdentifier: string;
  status: "pending" | "processing" | "completed" | "failed";
  mediaAssetId: string | null;
  durationSeconds: number | null;
  error: string | null;
  attempts: number;
};

type AudioProgress = {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
};

type VoiceProfile = {
  id: string;
  canonicalEntityId: string;
  voiceDescription: string;
  preferredProvider: string;
  voiceIdentifier: string;
  language: string;
  accent: string;
  speakingStyle: string;
  status: "draft" | "approved";
};

function StepIndicator({ step, current, label }: { step: number; current: number; label: string }) {
  const state = step < current ? "done" : step === current ? "active" : "pending";
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium " +
          (state === "done"
            ? "border-[#6f8f6a] bg-[#26301f] text-[#bcd8b1]"
            : state === "active"
            ? "border-[#c4a574] text-[#f3efe6]"
            : "border-[#4a453d] text-[#6f675d]")
        }
      >
        {state === "done" ? "✓" : step}
      </span>
      <span className={state === "pending" ? "text-[#6f675d]" : "text-[#cfc6b8]"}>{label}</span>
    </div>
  );
}

export default function AudioPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const production = useProduction(projectId);
  const [segments, setSegments] = useState<AudioSegment[]>([]);
  const [progress, setProgress] = useState<AudioProgress | null>(null);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);

  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const run = production.data?.run ?? null;
  const story = production.data?.story ?? null;
  const canGenerate = Boolean(run && story && story.status === "approved");

  const loadSegments = useCallback(async (runId: string) => {
    setError(null);
    try {
      const data = await api<{ segments: AudioSegment[]; progress: AudioProgress }>(
        `/api/projects/${projectId}/audio/segments?runId=${runId}`
      );
      setSegments(data.segments);
      setProgress(data.progress);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load segments");
    }
  }, [projectId]);

  const loadVoices = useCallback(async () => {
    try {
      const data = await api<{ profiles: VoiceProfile[] }>(
        `/api/projects/${projectId}/characters/000000000000000000000000/voice-profile`
      );
      setVoices(data.profiles);
    } catch {
      // Voice profiles are optional
    }
  }, [projectId]);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  useEffect(() => {
    if (run?.id) {
      void loadSegments(run.id);
    }
  }, [run?.id, loadSegments]);

  const hasOpenJobs = segments.some((s) => s.status === "pending" || s.status === "processing");
  useEffect(() => {
    if (!run?.id || !hasOpenJobs) return;
    const interval = setInterval(() => {
      void loadSegments(run.id);
    }, 3000);
    return () => clearInterval(interval);
  }, [run?.id, hasOpenJobs, loadSegments]);

  const handleGenerate = async () => {
    if (!run || !story) return;
    setGenerating(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/audio/generate`, {
        method: "POST",
        body: JSON.stringify({
          runId: run.id,
          storyId: story.id,
          episodeId: run.episode?.id ?? null,
        }),
      });
      await loadSegments(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start generation");
    } finally {
      setGenerating(false);
    }
  };

  const handleStop = async () => {
    if (!run) return;
    setCancelling(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/audio/cancel`, {
        method: "POST",
        body: JSON.stringify({ runId: run.id }),
      });
      await loadSegments(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop generation");
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async () => {
    if (!run) return;
    try {
      await api(`/api/projects/${projectId}/audio/retry`, {
        method: "POST",
        body: JSON.stringify({ runId: run.id }),
      });
      await loadSegments(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to retry");
    }
  };

  const playSegment = (segment: AudioSegment) => {
    if (!segment.mediaAssetId) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlayingId(segment.id);
    const audio = new Audio(`/api/projects/${projectId}/media/${segment.mediaAssetId}`);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    audioRef.current = audio;
    void audio.play();
  };

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const statusColor = (status: AudioSegment["status"]) => {
    switch (status) {
      case "completed": return "text-green-400";
      case "processing": return "text-blue-400";
      case "failed": return "text-red-400";
      default: return "text-[#a39b8f]";
    }
  };

  const progressPercent = progress && progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  const allCompleted = progress != null && progress.total > 0 && progress.completed === progress.total && progress.failed === 0;
  const currentStep = !canGenerate ? 1 : segments.length === 0 ? 1 : hasOpenJobs ? 2 : allCompleted ? 3 : 2;

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectHeader projectId={projectId} />
      <div className="mt-8 grid gap-6">
        <h1 className="font-display text-3xl">Audio Production</h1>
        {error ? <p className="text-red-400">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-6 rounded border border-[#39342d] px-6 py-4">
          <StepIndicator step={1} current={currentStep} label="Prerequisites" />
          <span className="text-[#4a453d]">→</span>
          <StepIndicator step={2} current={currentStep} label="Generate" />
          <span className="text-[#4a453d]">→</span>
          <StepIndicator step={3} current={currentStep} label="Review" />
        </div>

        <section className="rounded border border-[#39342d] p-6">
          <h2 className="font-display text-xl">Step 1 — Prerequisites</h2>
          <div className="mt-3 text-sm text-[#a39b8f]">
            {canGenerate ? (
              <p>
                Approved screenplay detected. Run <span className="text-[#cfc6b8]">{run?.id.slice(-8)}</span>,
                story <span className="text-[#cfc6b8]">{story?.id.slice(-8)}</span>.
                {story?.screenplay?.length ? ` ${story.screenplay.length} scenes extracted.` : ""}
              </p>
            ) : run ? (
              <p>The story must be approved before audio can be generated. Current story status: {story?.status ?? "none"}.</p>
            ) : (
              <p>Start a production run and approve the story first.</p>
            )}
          </div>
        </section>

        <section className="rounded border border-[#39342d] p-6">
          <h2 className="font-display text-xl">Step 2 — Generate Audio</h2>
          <p className="mt-2 text-sm text-[#a39b8f]">
            Generate dialogue and narration audio from the approved screenplay using Kokoro TTS.
          </p>
          {!canGenerate ? (
            <p className="mt-4 text-[#a39b8f]">Complete Step 1 first.</p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={handleGenerate} disabled={generating || hasOpenJobs}>
                {generating ? "Starting..." : hasOpenJobs ? "Generating..." : "Generate Audio"}
              </Button>
              {hasOpenJobs ? (
                <Button onClick={handleStop} variant="danger" disabled={cancelling}>
                  {cancelling ? "Stopping..." : "Stop"}
                </Button>
              ) : null}
              {progress && progress.failed > 0 ? (
                <Button onClick={handleRetry} variant="quiet">
                  Retry {progress.failed} failed
                </Button>
              ) : null}
            </div>
          )}

          {progress && progress.total > 0 ? (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#a39b8f]">
                  {progress.completed} / {progress.total} segments completed
                  {progress.processing > 0 ? ` · ${progress.processing} processing` : ""}
                  {progress.pending > 0 ? ` · ${progress.pending} pending` : ""}
                  {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
                </span>
                <span className="text-[#a39b8f]">{progressPercent}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[#2a2620]">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          ) : null}
        </section>

        {segments.length > 0 ? (
          <section className="rounded border border-[#39342d] p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl">Step 3 — Review Segments ({segments.length})</h2>
              {playingId ? (
                <Button onClick={stopPlayback} variant="quiet" size="sm">Stop playback</Button>
              ) : null}
            </div>
            <div className="mt-4 grid gap-2">
              {segments.map((segment) => (
                <div key={segment.id} className="rounded border border-[#2a2620] p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{segment.speakerName}</span>
                        <span className="text-[#a39b8f]">·</span>
                        <span className="text-[#a39b8f]">Scene {segment.sceneNumber}</span>
                        <span className="text-[#a39b8f]">·</span>
                        <span className="text-[#a39b8f]">{segment.voiceIdentifier}</span>
                      </div>
                      <p className="mt-1 truncate text-sm text-[#a39b8f]">{segment.text}</p>
                      {segment.status === "failed" && segment.error ? (
                        <p className="mt-1 text-xs text-red-400">{segment.error}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${statusColor(segment.status)}`}>
                        {segment.status}
                        {segment.durationSeconds ? ` (${segment.durationSeconds.toFixed(1)}s)` : ""}
                      </span>
                      {segment.status === "completed" && segment.mediaAssetId ? (
                        <button
                          onClick={() => playingId === segment.id ? stopPlayback() : playSegment(segment)}
                          className="rounded bg-[#2a2620] px-2 py-1 text-xs text-[#e8e2d8] hover:bg-[#39342d]"
                        >
                          {playingId === segment.id ? "Stop" : "Play"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded border border-[#39342d] p-6">
          <h2 className="font-display text-xl">Voice Profiles</h2>
          {voices.length === 0 ? (
            <p className="mt-4 text-[#a39b8f]">No voice profiles yet. Voices are assigned automatically during generation.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {voices.map((profile) => (
                <div key={profile.id} className="rounded border border-[#2a2620] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{profile.voiceDescription || profile.voiceIdentifier || "Voice profile"}</p>
                      <p className="text-sm text-[#a39b8f]">
                        {profile.preferredProvider} · {profile.language}
                        {profile.accent ? ` · ${profile.accent}` : ""}
                      </p>
                    </div>
                    <span className={profile.status === "approved" ? "text-green-400" : "text-yellow-400"}>
                      {profile.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}