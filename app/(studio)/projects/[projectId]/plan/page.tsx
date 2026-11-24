"use client";

import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { SeasonPlanWorkspace } from "@/components/workflow/SeasonPlanWorkspace";
import { useProject } from "@/hooks/useProjects";

export default function SeasonPlanPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;

  return (
    <StageLayout projectId={projectId} stage="episodes">
      {query.isLoading ? <p className="text-[#a39b8f]">Loading…</p> : null}
      {query.isError ? <p className="text-[#e7b2a8]">Failed to load project.</p> : null}
      {project ? <SeasonPlanWorkspace project={project} /> : null}
    </StageLayout>
  );
}
