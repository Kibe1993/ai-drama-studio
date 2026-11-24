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
      {project ? <SeasonPlanWorkspace project={project} /> : null}
    </StageLayout>
  );
}
