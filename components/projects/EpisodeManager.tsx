"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useCreateEpisode, useEpisodes } from "@/hooks/useEpisodes";
import { useProductionAction } from "@/hooks/useProduction";
import { DURATION_OPTIONS, type ProductionMode, type ProjectStatus } from "@/lib/domain/projectCatalog";
import type { EpisodeInput } from "@/lib/validation/episode";

export function EpisodeManager({
  projectId, productionMode, defaultDuration, projectStatus,
}: { projectId: string; productionMode: ProductionMode; defaultDuration: number; projectStatus: ProjectStatus }) {
  const query = useEpisodes(projectId);
  const create = useCreateEpisode(projectId);
  const production = useProductionAction(projectId);
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [duration, setDuration] = useState(defaultDuration);
  const rows = query.data?.episodes ?? [];
  const busy = create.isPending || production.isPending;
  const error = create.error ?? production.error;
  const blocked = projectStatus === "archived";

  async function addEpisode() {
    const input: EpisodeInput = { title, premise, targetDurationSeconds: duration };
    await create.mutateAsync(input);
    setTitle("");
    setPremise("");
  }

  return (
    <section className="mt-8 border-b border-[#2e2a25] pb-6">
      <h2 className="font-display text-3xl">Episodes</h2>
      <p className="mt-2 text-sm text-[#a39b8f]">
        Each episode has its own screenplay and target duration. Serialized episodes capture the approved Story Bible version they start from.
      </p>
      {query.isLoading ? <p className="mt-3 text-sm text-[#a39b8f]">Loading episodes</p> : null}
      {query.isError ? <p className="mt-3 text-sm text-[#e7b2a8]">Episodes could not be loaded.</p> : null}
      {rows.length ? (
        <ul className="mt-4 grid gap-3">
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
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy || blocked} onClick={() => production.mutate({ action: "start", workflowMode: "guided", episodeId: episode.id })}>Start guided</Button>
                  <Button size="sm" variant="quiet" disabled={busy || blocked} onClick={() => production.mutate({ action: "start", workflowMode: "automatic", episodeId: episode.id })}>Start automatic</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="quiet" disabled={busy || blocked || !title.trim()} onClick={addEpisode}>{create.isPending ? "Creating" : "Create episode"}</Button>
        {productionMode === "serialized" && rows.length > 0 ? (
          <span className="text-xs text-[#a39b8f]">A later episode requires an approved Story Bible snapshot.</span>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-[#e7b2a8]">{error instanceof ApiError ? error.message : "The episode action failed."}</p> : null}
    </section>
  );
}
