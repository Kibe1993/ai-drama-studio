"use client";

import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { StoryDraftWorkspace } from "@/components/workflow/StoryDraftWorkspace";
import { useProject } from "@/hooks/useProjects";

export default function StoryDraftPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;

  return (
    <StageLayout projectId={projectId} stage="story">
      {project ? <StoryDraftWorkspace project={project} /> : null}
    </StageLayout>
  );
}
