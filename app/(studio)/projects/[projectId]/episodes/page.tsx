"use client";

import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { EpisodeManager } from "@/components/projects/EpisodeManager";
import { ContinuityLedgerView } from "@/components/workflow/ContinuityLedgerView";
import { useProject } from "@/hooks/useProjects";
import { useWorkflow } from "@/hooks/useWorkflow";

export default function EpisodesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;
  const workflow = useWorkflow(projectId);

  const episodesNeedingReview = workflow.data?.episodes.needingReview ?? 0;
  const planNeedsReview = workflow.data?.plan.needsReview ?? false;
  const planApproved = workflow.data?.plan.approved ?? false;

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
        </>
      ) : null}
    </StageLayout>
  );
}
