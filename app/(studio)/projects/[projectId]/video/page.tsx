"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useApproveStory, useProduction, useProductionAction } from "@/hooks/useProduction";
import { StoryReview } from "@/components/production/StoryReview";
import { ScreenplayEditor } from "@/components/production/ScreenplayEditor";
import { ScenePlanner } from "@/components/production/ScenePlanner";
import type { JobRecord, RunRecord } from "@/lib/pipeline/types";
import type { StoryRecord } from "@/lib/validation/story";

function providerName(id: string): string {
  if (id === "openai") return "OpenAI";
  if (id === "anthropic") return "Anthropic";
  if (id === "deepseek") return "DeepSeek";
  if (id === "gemini") return "Gemini";
  if (id === "groq") return "Groq";
  if (id === "openrouter") return "OpenRouter";
  if (id === "mistral") return "Mistral";
  return id.slice(0, 1).toUpperCase() + id.slice(1);
}

function storyJobFailed(jobs: JobRecord[]): string | null {
  const storyJob = [...jobs].reverse().find((job) => job.jobType === "story.generate");
  if (storyJob?.status !== "failed") return null;
  return storyJob.error?.message ?? "Story generation failed";
}

function videoStatusLabel(scene: { videoStatus?: string; videoReady: boolean; videoAssetId?: string; failed: boolean }) {
  if (scene.videoStatus) return scene.videoStatus.toUpperCase();
  if (scene.failed) return "FAILED";
  if (scene.videoReady && !scene.videoAssetId) return "MOCK";
  return "PENDING";
}

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

export default function VideoPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const production = useProduction(projectId);
  const action = useProductionAction(projectId);
  const approveStory = useApproveStory(projectId);
  const [error, setError] = useState<string | null>(null);

  const run = production.data?.run ?? null;
  const story = production.data?.story ?? null;
  const jobs = production.data?.jobs ?? [];
  const scenes = production.data?.scenes ?? [];
  const open = jobs.some((job) => job.status === "queued" || job.status === "processing");
  const activeJob = [...jobs].reverse().find((job) => job.status === "queued" || job.status === "processing");
  const busy = action.isPending || approveStory.isPending;

  const storyJob = [...jobs].reverse().find((job) => job.jobType === "story.generate");
  const storyGenerating = storyJob != null && (storyJob.status === "queued" || storyJob.status === "processing");
  const storyWaiting = story?.status === "awaiting_approval" ||
    (run?.status === "waiting_for_approval" && run.currentStage === "story");
  const storyApproved = story?.status === "approved" || Boolean(run?.stageResults.story?.approved);
  const scenesReady = Boolean(run?.stageResults.scenes);
  const sceneWaiting = run?.status === "waiting_for_approval" && run.currentStage === "scenes";
  const failedScenes = run?.stageResults.scenes?.items.filter((scene) => scene.failed) ?? [];

  const currentStep = !run ? 1 : storyGenerating ? 1 : storyWaiting ? 1 : !storyApproved ? 1 : sceneWaiting ? 2 : !scenesReady ? 2 : 3;

  const handleStop = async () => {
    setError(null);
    try {
      await action.mutateAsync({ action: "cancel" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to stop");
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectHeader projectId={projectId} />
      <div className="mt-8 grid gap-6">
        <h1 className="font-display text-3xl">Video Production</h1>
        {error ? <p className="text-red-400">{error}</p> : null}
        {production.isLoading ? <p className="text-[#a39b8f]">Loading production state...</p> : null}

        <div className="flex flex-wrap items-center gap-4 rounded border border-[#39342d] px-6 py-4">
          <StepIndicator step={1} current={currentStep} label="Story" />
          <span className="text-[#4a453d]">→</span>
          <StepIndicator step={2} current={currentStep} label="Scenes" />
          <span className="text-[#4a453d]">→</span>
          <StepIndicator step={3} current={currentStep} label="Render" />
        </div>

        <section className="rounded border border-[#39342d] p-6">
          <h2 className="font-display text-xl">Step 1 — Story Generation</h2>
          <div className="mt-3 text-sm text-[#a39b8f]">
            {run ? (
              <p>
                {activeJob?.progress.message ||
                  (run.status === "waiting_for_approval"
                    ? "Waiting for your approval"
                    : run.status === "completed"
                    ? "Production complete"
                    : run.status === "unavailable"
                    ? "Video unavailable — no real video was generated"
                    : "Production is idle")}
              </p>
            ) : (
              <p>No production run yet. Start one from the production page.</p>
            )}
          </div>

          {story ? <StoryReview story={story} /> : null}

          {story?.status === "awaiting_approval" ? (
            <ScreenplayEditor
              key={`${story.id}:${story.updatedAt}`}
              projectId={projectId}
              story={story}
            />
          ) : null}

          {story && story.provider ? (
            <p className="mt-3 text-sm text-[#a39b8f]">
              Screenplay from {providerName(story.provider)}
              {story.model ? ` (${story.model})` : ""}
              {story.fallbackFrom ? ` — fallback from ${providerName(story.fallbackFrom)}` : ""}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {run && !open && !run.stageResults.story ? (
              <Button disabled={busy} onClick={() => action.mutate({ action: "story" })}>
                Develop story
              </Button>
            ) : null}
            {storyWaiting && story ? (
              story.validationFindings && !story.validationFindings.passed ? (
                <p className="text-sm text-[#dfc18a]">
                  This screenplay failed canon validation. Regenerate before approving.
                </p>
              ) : (
                <Button disabled={busy} onClick={() => approveStory.mutate(story.id)}>
                  {approveStory.isPending ? "Approving..." : "Approve story"}
                </Button>
              )
            ) : null}
            {run?.status === "waiting_for_approval" && !open && !storyWaiting ? (
              <Button disabled={busy} onClick={() => action.mutate({ action: "approve" })}>
                Approve and continue
              </Button>
            ) : null}
            {storyGenerating ? (
              <Button onClick={handleStop} variant="danger" disabled={busy}>
                Stop
              </Button>
            ) : null}
          </div>
        </section>

        <section className="rounded border border-[#39342d] p-6">
          <h2 className="font-display text-xl">Step 2 — Scene Breakdown</h2>
          {!storyApproved ? (
            <p className="mt-3 text-sm text-[#a39b8f]">Approve the story first to unlock scene breakdown.</p>
          ) : scenesReady ? (
            <div className="mt-3 text-sm text-[#cfc6b8]">
              <ul>
                {run!.stageResults.scenes!.items.map((scene) => (
                  <li key={scene.sceneNumber}>
                    Scene {scene.sceneNumber}: {scene.title}
                    {scene.location ? ` · ${scene.location}` : ""}
                    {scene.timeOfDay ? ` · ${scene.timeOfDay}` : ""}
                    {` · video ${videoStatusLabel(scene)}`}
                  </li>
                ))}
              </ul>
              {run!.stageResults.scenes!.provider ? (
                <p className="mt-1 text-[#a39b8f]">
                  Scenes from {providerName(run!.stageResults.scenes!.provider!)}
                  {run!.stageResults.scenes!.model ? ` (${run!.stageResults.scenes!.model})` : ""}.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#a39b8f]">Scenes will be generated after story approval.</p>
          )}

          {sceneWaiting ? (
            <ScenePlanner projectId={projectId} scenes={scenes} />
          ) : null}

          {run?.stageResults.characters ? (
            <div className="mt-3 text-sm text-[#a39b8f]">
              <p className="font-medium text-[#cfc6b8]">Characters:</p>
              {run.stageResults.characters.profiles && run.stageResults.characters.profiles.length > 0 ? (
                <ul>
                  {run.stageResults.characters.profiles.map((character) => (
                    <li key={character.name}>
                      {character.name}
                      {character.role ? ` · ${character.role}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{run.stageResults.characters.names.join(", ")}</p>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {failedScenes.map((scene) => (
              <Button
                key={scene.sceneNumber}
                variant="quiet"
                disabled={busy}
                onClick={() => action.mutate({ action: "retryScene", sceneNumber: scene.sceneNumber })}
              >
                Retry scene {scene.sceneNumber}
              </Button>
            ))}
            {open && !storyGenerating ? (
              <Button onClick={handleStop} variant="danger" disabled={busy}>
                Stop
              </Button>
            ) : null}
          </div>
        </section>

        <section className="rounded border border-[#39342d] p-6">
          <h2 className="font-display text-xl">Step 3 — Final Render</h2>
          {!scenesReady ? (
            <p className="mt-3 text-sm text-[#a39b8f]">Complete scene breakdown first.</p>
          ) : run?.stageResults.render?.ready ? (
            <div className="mt-3">
              <p className="text-sm text-green-400">Render completed.</p>
              {run.stageResults.render.mediaAssetId ? (
                <Button variant="quiet" size="sm" className="mt-2">
                  <a href={`/api/projects/${projectId}/media/${run.stageResults.render.mediaAssetId}`} target="_blank" rel="noopener noreferrer">
                    Download video
                  </a>
                </Button>
              ) : null}
            </div>
          ) : run?.stageResults.render ? (
            <p className="mt-3 text-sm text-yellow-400">
              Render {run.stageResults.render.status === "mock" ? "is MOCK — no real video was generated" : "unavailable"}.
            </p>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-[#a39b8f]">
                When all scenes have video, the final render can be triggered from the{" "}
                <a href={`/projects/${projectId}/rendering`} className="text-[#c4a574] underline">rendering page</a>.
              </p>
            </div>
          )}
        </section>

        {action.error instanceof ApiError ? (
          <p className="text-sm text-[#e7b2a8]">{action.error.message}</p>
        ) : null}
        {approveStory.error instanceof ApiError ? (
          <p className="text-sm text-[#e7b2a8]">{approveStory.error.message}</p>
        ) : null}
        {storyJobFailed(jobs) ? (
          <p className="text-sm text-[#e7b2a8]">{storyJobFailed(jobs)}</p>
        ) : null}
      </div>
    </div>
  );
}