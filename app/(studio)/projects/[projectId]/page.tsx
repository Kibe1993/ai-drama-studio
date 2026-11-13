"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { Button } from "@/components/ui/button";
import { useWorkflow } from "@/hooks/useWorkflow";
import { useProject } from "@/hooks/useProjects";
import {
  WORKFLOW_STAGE_LABELS,
  WORKFLOW_STAGE_PATH,
  type WorkflowStage,
} from "@/lib/domain/workflow";

function ContinueButton({ projectId, stage }: { projectId: string; stage: WorkflowStage }) {
  return (
    <Link href={`/projects/${projectId}/${WORKFLOW_STAGE_PATH[stage]}`}>
      <Button>Continue to {WORKFLOW_STAGE_LABELS[stage]} →</Button>
    </Link>
  );
}

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const workflow = useWorkflow(projectId);

  const project = query.data?.project;
  const stage = workflow.data?.stage;

  // Redirect to the current workflow stage after a brief moment so the
  // user always lands on the right workspace. We keep this page as an
  // overview/hub they can return to.
  useEffect(() => {
    if (stage) {
      router.replace(`/projects/${projectId}/${WORKFLOW_STAGE_PATH[stage]}`);
    }
  }, [stage, projectId, router]);

  return (
    <div className="mx-auto max-w-4xl">
      <ProjectHeader projectId={projectId} />
      {project && stage ? (
        <div className="mt-8 grid gap-6">
          <div className="rounded border border-[#39342d] p-6">
            <p className="text-sm text-[#a39b8f]">You are at</p>
            <p className="font-display text-3xl">{WORKFLOW_STAGE_LABELS[stage]}</p>
            <div className="mt-4">
              <ContinueButton projectId={projectId} stage={stage} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
