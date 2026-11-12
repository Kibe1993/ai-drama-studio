"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StoryReview } from "@/components/production/StoryReview";
import { ScenePlanner } from "@/components/production/ScenePlanner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useApproveStory, useProduction, useProductionAction } from "@/hooks/useProduction";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import type { JobRecord, RunRecord } from "@/lib/pipeline/types";
import type { StoryRecord } from "@/lib/validation/story";

function storyStatus(run: RunRecord | null, jobs: JobRecord[], story: StoryRecord | null): string | null {
  const storyJob = [...jobs].reverse().find((job) => job.jobType === "story.generate");
  if (storyJob && (storyJob.status === "queued" || storyJob.status === "processing")) {
    return storyJob.progress?.message || "Generating story";
  }
  if (storyJob?.status === "failed" || story?.status === "failed") return "Story generation failed";
  if (story?.status === "approved" || run?.stageResults.story?.approved) return "Story approved";
  if (story?.status === "awaiting_approval" || (run?.status === "waiting_for_approval" && run.currentStage === "story")) {
    return "Awaiting story approval";
  }
  return null;
}

function providerLine(story: StoryRecord): string | null {
  if (!story.provider) return null;
  const name = providerName(story.provider);
  const model = story.model ? ` (${story.model})` : "";
  const fallback = story.fallbackFrom ? ` Fallback from ${providerName(story.fallbackFrom)}.` : "";
  return `Screenplay from ${name}${model}.${fallback}`;
}

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
  // Historical videoReady values were written by the mock-only implementation.
  if (scene.videoReady && !scene.videoAssetId) return "MOCK";
  return "PENDING";
}

function unavailableMessage(run: RunRecord): string {
  if (run.currentStage === "render" || run.stageResults.render) {
    return run.stageResults.render?.status === "mock"
      ? "UNAVAILABLE - the render stage is MOCK; no final video file was created."
      : "UNAVAILABLE - no validated final video file was stored.";
  }
  return "UNAVAILABLE - the video stage is MOCK; no real scene clips were generated.";
}

export function ProductionPanel({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
}) {
  const client = useQueryClient();
  const production = useProduction(projectId);
  const action = useProductionAction(projectId);
  const approveStory = useApproveStory(projectId);
  const run = production.data?.run ?? null;
  const story = production.data?.story ?? null;
  useEffect(() => {
    if (!run) return;
    void client.invalidateQueries({ queryKey: ["projects", projectId] });
  }, [client, projectId, run]);
  const jobs = production.data?.jobs ?? [];
  const open = jobs.some((job) => job.status === "queued" || job.status === "processing");
  const activeJob = [...jobs].reverse().find((job) => job.status === "queued" || job.status === "processing");
  const failedScenes = run?.stageResults.scenes?.items.filter((scene) => scene.failed) ?? [];
  const label = storyStatus(run, jobs, story);
  const storyWaiting = label === "Awaiting story approval" && Boolean(story);
  const busy = action.isPending || approveStory.isPending;

  if (status === "archived") return null;

  return (
    <section className="mt-8 border-y border-[#2e2a25] py-6">
      <h2 className="text-sm tracking-[0.14em] text-[#a39b8f] uppercase">Production</h2>
      {production.isLoading ? <p className="mt-3 text-[#a39b8f]">Loading production</p> : null}
      {run ? (
        <p className="mt-3 text-[#f3efe6]">
          {activeJob?.progress.message ||
            (run.status === "unavailable"
              ? unavailableMessage(run)
              : run.status === "waiting_for_approval"
              ? "Waiting for your approval"
              : run.status === "completed"
                ? "Rendering final video is finished"
                : "Production is idle")}
        </p>
      ) : (
        <p className="mt-3 text-[#cfc6b8]">
          Create an episode below, then start its screenplay. Review and approve it before later stages continue.
        </p>
      )}
      {label ? <p className="mt-3 text-sm text-[#c4a574]">{label}</p> : null}
      {story ? <StoryReview story={story} /> : null}
      {story && providerLine(story) ? <p className="mt-3 text-sm text-[#a39b8f]">{providerLine(story)}</p> : null}
      {run?.stageResults.story && !story ? (
        <p className="mt-3 text-sm text-[#cfc6b8]">
          {run.stageResults.story.title}. {run.stageResults.story.synopsis}
        </p>
      ) : null}
      {run?.stageResults.characters ? (
        <div className="mt-3 text-sm text-[#a39b8f]">
          {run.stageResults.characters.profiles && run.stageResults.characters.profiles.length > 0 ? (
            <ul>
              {run.stageResults.characters.profiles.map((character) => (
                <li key={character.name}>
                  {character.name}
                  {character.role ? ` · ${character.role}` : ""}
                  {character.physicalDescription ? ` · ${character.physicalDescription}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>{run.stageResults.characters.names.join(", ")}</p>
          )}
          {run.stageResults.characters.provider ? (
            <p className="mt-1">
              Characters from {providerName(run.stageResults.characters.provider)}
              {run.stageResults.characters.model ? ` (${run.stageResults.characters.model})` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}
      {run?.stageResults.scenes ? (
        <div className="mt-3 text-sm text-[#cfc6b8]">
          <ul>
            {run.stageResults.scenes.items.map((scene) => (
              <li key={scene.sceneNumber}>
                Scene {scene.sceneNumber}: {scene.title}
                {scene.location ? ` · ${scene.location}` : ""}
                {scene.timeOfDay ? ` · ${scene.timeOfDay}` : ""}
                {` · video ${videoStatusLabel(scene)}`}
              </li>
            ))}
          </ul>
          {run.stageResults.scenes.provider ? (
            <p className="mt-1 text-[#a39b8f]">
              Scenes from {providerName(run.stageResults.scenes.provider)}
              {run.stageResults.scenes.model ? ` (${run.stageResults.scenes.model})` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}
      {run?.status === "waiting_for_approval" && run.currentStage === "scenes" ? (
        <ScenePlanner projectId={projectId} scenes={production.data?.scenes ?? []} />
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {status === "planning" && run && !open && !run.stageResults.story ? (
          <Button disabled={busy} onClick={() => action.mutate({ action: "story" })}>
            Develop story
          </Button>
        ) : null}
        {storyWaiting && story ? (
          <Button disabled={busy} onClick={() => approveStory.mutate(story.id)}>
            {approveStory.isPending ? "Approving story" : "Approve story"}
          </Button>
        ) : null}
        {run?.status === "waiting_for_approval" && !open && !storyWaiting ? (
          <Button disabled={busy} onClick={() => action.mutate({ action: "approve" })}>
            Approve and continue
          </Button>
        ) : null}
        {status === "failed" ? (
          <Button disabled={busy} onClick={() => action.mutate({ action: "retry" })}>
            Retry
          </Button>
        ) : null}
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
        {run && (run.status === "running" || run.status === "waiting_for_approval" || run.status === "unavailable") ? (
          <Button variant="quiet" disabled={busy} onClick={() => action.mutate({ action: "cancel" })}>
            Stop run
          </Button>
        ) : null}
      </div>
      {action.error instanceof ApiError ? (
        <p className="mt-3 text-sm text-[#e7b2a8]">{action.error.message}</p>
      ) : null}
      {approveStory.error instanceof ApiError ? (
        <p className="mt-3 text-sm text-[#e7b2a8]">{approveStory.error.message}</p>
      ) : null}
      {storyJobFailed(jobs) ? (
        <p className="mt-3 text-sm text-[#e7b2a8]">{storyJobFailed(jobs)}</p>
      ) : null}
    </section>
  );
}
