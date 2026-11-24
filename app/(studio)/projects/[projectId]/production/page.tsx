"use client";

import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { ProductionPanel } from "@/components/production/ProductionPanel";
import { useProject } from "@/hooks/useProjects";

export default function ProductionPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;

  return (
    <StageLayout projectId={projectId} stage="production_design">
      {query.isLoading ? <p className="text-[#a39b8f]">Loading…</p> : null}
      {query.isError ? <p className="text-[#e7b2a8]">Failed to load project.</p> : null}
      {project ? <ProductionPanel projectId={project.id} status={project.status} /> : null}
    </StageLayout>
  );
}
