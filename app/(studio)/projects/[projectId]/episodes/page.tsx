"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { EpisodeManager } from "@/components/projects/EpisodeManager";
import { ContinuityLedgerView } from "@/components/workflow/ContinuityLedgerView";
import { ImportDialog } from "@/components/projects/ImportDialog";
import { ExportDialog } from "@/components/projects/ExportDialog";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/useProjects";
import { useWorkflow } from "@/hooks/useWorkflow";
import { useEpisodes } from "@/hooks/useEpisodes";

export default function EpisodesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;
  const workflow = useWorkflow(projectId);
  const episodesQuery = useEpisodes(projectId);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const episodesNeedingReview = workflow.data?.episodes.needingReview ?? 0;
  const planNeedsReview = workflow.data?.plan.needsReview ?? false;
  const planApproved = workflow.data?.plan.approved ?? false;

  async function handleImport(content: string, format: "markdown" | "json" | "text") {
    let episodes: Array<{ title: string; premise: string; targetDurationSeconds: number }>;
    if (format === "json") {
      const parsed = JSON.parse(content);
      episodes = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      episodes = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const [title, premise, duration] = line.split("|").map((s) => s.trim());
          return {
            title: title ?? "Imported Episode",
            premise: premise ?? "",
            targetDurationSeconds: duration ? parseInt(duration, 10) : 180,
          };
        });
    }
    for (const ep of episodes) {
      const res = await fetch(`/api/projects/${projectId}/episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ep),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Failed to create episode "${ep.title}" (${res.status})`);
      }
    }
  }

  return (
    <StageLayout projectId={projectId} stage="episodes">
      {project ? (
        <>
          {workflow.data && !planApproved ? (
            <div className="mb-6 rounded border border-[#6b3a32] p-4">
              <p className="text-sm text-[#dfc18a]">
                Episode generation is locked until the Season Plan is approved.
              </p>
            </div>
          ) : null}
          {planNeedsReview ? (
            <div className="mb-6 rounded border border-[#6b3a32] p-4">
              <p className="text-sm text-[#dfc18a]">
                The approved Story Bible has changed since this Season Plan was approved. Review the plan and affected episodes for continuity.
              </p>
            </div>
          ) : null}
          {episodesNeedingReview > 0 ? (
            <div className="mb-6 rounded border border-[#6b3a32] p-4">
              <p className="text-sm text-[#dfc18a]">
                {episodesNeedingReview === 1
                  ? "1 episode was written from an older approved version and should be reviewed."
                  : `${episodesNeedingReview} episodes were written from older approved versions and should be reviewed.`}
              </p>
            </div>
          ) : null}
          <div className="mb-4 flex gap-2">
            <Button variant="quiet" size="sm" onClick={() => setShowImport(true)}>Import</Button>
            <Button variant="quiet" size="sm" onClick={() => setShowExport(true)}>Export</Button>
          </div>
          <EpisodeManager
            projectId={project.id}
            productionMode={project.productionMode}
            defaultDuration={project.targetDurationSeconds}
            projectStatus={project.status}
            planApproved={planApproved}
            planNeedsReview={planNeedsReview}
            nextLocked={workflow.data?.episodes.nextLocked ?? false}
            nextLockReason={workflow.data?.episodes.nextLockReason ?? null}
          />
          <ContinuityLedgerView projectId={project.id} />
          <ImportDialog
            open={showImport}
            onClose={() => setShowImport(false)}
            onImport={handleImport}
            title="Import Episodes"
          />
          <ExportDialog
            open={showExport}
            onClose={() => setShowExport(false)}
            data={episodesQuery.data?.episodes ?? []}
            title="Export Episodes"
          />
        </>
      ) : null}
    </StageLayout>
  );
}
