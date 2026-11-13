"use client";

import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { StoryBibleEditor } from "@/components/projects/StoryBibleEditor";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/useProjects";
import { useWorkflow } from "@/hooks/useWorkflow";

export default function StoryBiblePage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;
  const workflow = useWorkflow(projectId);

  const bibleApproved = workflow.data?.bible.approved ?? false;
  const bibleNeedsReview = workflow.data?.bible.needsReview ?? false;

  return (
    <StageLayout projectId={projectId} stage="bible">
      {project ? (
        <>
          {bibleNeedsReview ? (
            <div className="mb-6 rounded border border-[#6b3a32] p-4">
              <p className="text-sm text-[#dfc18a]">
                The approved story has changed since this Story Bible was approved. Review the Bible and re-approve to keep canon up to date.
              </p>
            </div>
          ) : null}
          <StoryBibleEditor
            projectId={project.id}
            initialIdea={project.originalStoryIdea}
            initialTitle={project.title}
          />
          {bibleApproved ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => router.push(`/projects/${projectId}/episodes`)}>
                Continue to Episodes →
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </StageLayout>
  );
}
