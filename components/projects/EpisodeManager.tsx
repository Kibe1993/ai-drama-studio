"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useCreateEpisode, useEpisodes, useGenerateEpisode } from "@/hooks/useEpisodes";
import { useProductionAction } from "@/hooks/useProduction";
import { DURATION_OPTIONS, type ProductionMode, type ProjectStatus } from "@/lib/domain/projectCatalog";
import type { EpisodeInput } from "@/lib/validation/episode";

export function EpisodeManager({
  projectId,
  productionMode,
  defaultDuration,
  projectStatus,
  planApproved,
  planNeedsReview,
  nextLocked,
  nextLockReason,
}: {
  projectId: string;
  productionMode: ProductionMode;
  defaultDuration: number;
  projectStatus: ProjectStatus;
  planApproved: boolean;
  planNeedsReview: boolean;
  nextLocked: boolean;
  nextLockReason: string | null;
}) {
  const router = useRouter();
  const query = useEpisodes(projectId);
  const create = useCreateEpisode(projectId);
  const generateEpisode = useGenerateEpisode(projectId);
  const production = useProductionAction(projectId);
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [duration, setDuration] = useState(defaultDuration);
  const rows = query.data?.episodes ?? [];
  const busy = create.isPending || generateEpisode.pending || production.isPending;
  const error = create.error ?? generateEpisode.error ?? production.error;
  const blocked = projectStatus === "archived";
  const episodeLocked = productionMode === "serialized" && (!planApproved || planNeedsReview || nextLocked);
  const approvedStatuses = new Set(["story_approved", "completed"]);
  const earlierUnapproved = (episodeNumber: number) =>
    rows.find((row) => row.episodeNumber < episodeNumber && !approvedStatuses.has(row.status)) ?? null;

  async function addEpisode() {
    const input: EpisodeInput = { title, premise, targetDurationSeconds: duration };
    await create.mutateAsync(input);
    setTitle("");
    setPremise("");
  }

  async function startProduction(episodeId: string, workflowMode: "guided" | "automatic") {
    await production.mutateAsync({ action: "start", workflowMode, episodeId });
    router.push(`/projects/${projectId}/production`);
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-[#a39b8f]">
        Each episode has its own screenplay and target duration. Serialized episodes are produced in order:
        an episode unlocks only after the previous episode is approved and the Continuity Ledger is updated.
      </p>
      {productionMode === "serialized" && !planApproved ? (
        <p role="alert" className="rounded border border-[#6b3a32] p-3 text-sm text-[#e7b2a8]">
          Episode generation is locked until you approve the Season Plan.
        </p>
      ) : null}
      {planNeedsReview ? (
        <p role="alert" className="rounded border border-[#6b3a32] p-3 text-sm text-[#dfc18a]">
          The approved Story Bible changed after this Season Plan was approved. Review and re-approve the plan
          before generating new episodes.
        </p>
      ) : null}
      {nextLockReason && !planNeedsReview ? (
        <p className="rounded border border-[#39342d] p-3 text-sm text-[#dfc18a]">{nextLockReason}</p>
      ) : null}
      {query.isLoading ? <p className="text-sm text-[#a39b8f]">Loading episodes</p> : null}
      {query.isError ? <p className="text-sm text-[#e7b2a8]">Episodes could not be loaded.</p> : null}
      {rows.length ? (
        <ul className="grid gap-3">
          {rows.map((episode) => (
            <li key={episode.id} className="flex flex-wrap items-center justify-between gap-3 border border-[#2e2a25] p-3">
              <div>
                <p className="text-[#f3efe6]">Episode {episode.episodeNumber}: {episode.title}</p>
                <p className="mt-1 text-xs text-[#a39b8f]">
                  {Math.round(episode.targetDurationSeconds / 60)} min · {episode.status.replaceAll("_", " ")}
                  {episode.baseSnapshotVersion ? ` · canon snapshot ${episode.baseSnapshotVersion}` : ""}
                </p>
                {episode.premise ? <p className="mt-1 text-sm text-[#cfc6b8]">{episode.premise}</p> : null}
              </div>
              {episode.status === "draft" ? (
                earlierUnapproved(episode.episodeNumber) ? (
                  <span className="text-xs text-[#dfc18a]">
                    Locked until episode {earlierUnapproved(episode.episodeNumber)!.episodeNumber} is approved
                  </span>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy || blocked || episodeLocked}
                      onClick={() => startProduction(episode.id, "guided")}
                    >
                      Start guided
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy || blocked || episodeLocked}
                      onClick={() => startProduction(episode.id, "automatic")}
                    >
                      Start automatic
                    </Button>
                  </div>
                )
              ) : episode.status === "in_production" || episode.status === "story_approved" || episode.status === "completed" ? (
                <Button size="sm" disabled={busy || blocked} onClick={() => router.push(`/projects/${projectId}/production`)}>
                  Open production
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">Episode title
          <input className="studio-field" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Episode ${rows.length + 1}`} />
        </label>
        <label className="grid gap-2 text-sm">Screenplay target
          <select className="studio-field" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
            {DURATION_OPTIONS.map((option) => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm sm:col-span-2">Episode premise
          <textarea className="studio-field min-h-20" maxLength={3000} value={premise} onChange={(event) => setPremise(event.target.value)} placeholder="What happens in this episode?" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || blocked || episodeLocked} onClick={() => generateEpisode.start()}>
          {generateEpisode.pending ? "Developing episode…" : `Generate episode ${rows.length + 1} with AI`}
        </Button>
        <Button variant="quiet" disabled={busy || blocked || episodeLocked || !title.trim()} onClick={addEpisode}>
          {create.isPending ? "Creating" : "Create episode"}
        </Button>
        {productionMode === "serialized" && rows.length > 0 ? (
          <span className="text-xs text-[#a39b8f]">A later episode requires an approved Story Bible snapshot.</span>
        ) : null}
      </div>
      {generateEpisode.message ? <p role="status" className="text-xs text-[#dfc18a]">{generateEpisode.message}</p> : null}
      {error ? <p role="alert" className="text-sm text-[#e7b2a8]">{error instanceof ApiError ? error.message : "The episode action failed."}</p> : null}
    </div>
  );
}

