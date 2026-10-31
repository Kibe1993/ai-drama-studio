"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useProduction, useProductionAction } from "@/hooks/useProduction";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";

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
  const run = production.data?.run ?? null;
  useEffect(() => {
    if (!run) return;
    void client.invalidateQueries({ queryKey: ["projects", projectId] });
  }, [client, projectId, run]);
  const jobs = production.data?.jobs ?? [];
  const open = jobs.some((job) => job.status === "queued" || job.status === "processing");
  const activeJob = [...jobs].reverse().find((job) => job.status === "queued" || job.status === "processing");
  const failedScenes = run?.stageResults.scenes?.items.filter((scene) => scene.failed) ?? [];

  if (status === "archived") return null;

  return (
    <section className="mt-8 border-y border-[#2e2a25] py-6">
      <h2 className="text-sm tracking-[0.14em] text-[#a39b8f] uppercase">Production</h2>
      {production.isLoading ? <p className="mt-3 text-[#a39b8f]">Loading production</p> : null}
      {run ? (
        <p className="mt-3 text-[#f3efe6]">
          {activeJob?.progress.message ||
            (run.status === "waiting_for_approval"
              ? "Waiting for your approval"
              : run.status === "completed"
                ? "Rendering final video is finished"
                : "Production is idle")}
        </p>
      ) : (
        <p className="mt-3 text-[#cfc6b8]">
          Start a guided run and approve each stage, or let an automatic run continue on its own. Both keep every finished stage.
        </p>
      )}
      {run?.stageResults.story ? (
        <p className="mt-3 text-sm text-[#cfc6b8]">
          {run.stageResults.story.title}. {run.stageResults.story.synopsis}
        </p>
      ) : null}
      {run?.stageResults.characters ? (
        <p className="mt-2 text-sm text-[#a39b8f]">{run.stageResults.characters.names.join(", ")}</p>
      ) : null}
      {run?.stageResults.scenes ? (
        <ul className="mt-3 text-sm text-[#cfc6b8]">
          {run.stageResults.scenes.items.map((scene) => (
            <li key={scene.sceneNumber}>
              Scene {scene.sceneNumber}: {scene.title}
              {scene.videoReady ? " · video ready" : ""}
              {scene.failed ? " · failed" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {status === "draft" ? (
          <>
            <Button disabled={action.isPending} onClick={() => action.mutate({ action: "start", workflowMode: "guided" })}>
              Start guided
            </Button>
            <Button
              variant="quiet"
              disabled={action.isPending}
              onClick={() => action.mutate({ action: "start", workflowMode: "automatic" })}
            >
              Start automatic
            </Button>
          </>
        ) : null}
        {status === "planning" && run && !open && !run.stageResults.story ? (
          <Button disabled={action.isPending} onClick={() => action.mutate({ action: "story" })}>
            Develop story
          </Button>
        ) : null}
        {run?.status === "waiting_for_approval" && !open ? (
          <Button disabled={action.isPending} onClick={() => action.mutate({ action: "approve" })}>
            Approve and continue
          </Button>
        ) : null}
        {status === "failed" ? (
          <Button disabled={action.isPending} onClick={() => action.mutate({ action: "retry" })}>
            Retry
          </Button>
        ) : null}
        {failedScenes.map((scene) => (
          <Button
            key={scene.sceneNumber}
            variant="quiet"
            disabled={action.isPending}
            onClick={() => action.mutate({ action: "retryScene", sceneNumber: scene.sceneNumber })}
          >
            Retry scene {scene.sceneNumber}
          </Button>
        ))}
        {run && (run.status === "running" || run.status === "waiting_for_approval") ? (
          <Button variant="quiet" disabled={action.isPending} onClick={() => action.mutate({ action: "cancel" })}>
            Stop run
          </Button>
        ) : null}
      </div>
      {action.error instanceof ApiError ? (
        <p className="mt-3 text-sm text-[#e7b2a8]">{action.error.message}</p>
      ) : null}
    </section>
  );
}
