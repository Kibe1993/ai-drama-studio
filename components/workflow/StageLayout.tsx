"use client";

import { ProjectHeader } from "@/components/workflow/ProjectHeader";
import { AssistantHandoffPanel } from "@/components/workflow/AssistantHandoffPanel";
import { useWorkflowGuard } from "@/hooks/useWorkflowGuard";
import { WORKFLOW_STAGE_LABELS, type WorkflowStage } from "@/lib/domain/workflow";

/**
 * Shared layout for each workflow stage page. Renders the project header,
 * the workflow stepper, and guards access — redirecting users who try to
 * access a stage they haven't unlocked.
 */
export function StageLayout({
  projectId,
  stage,
  children,
}: {
  projectId: string;
  stage: WorkflowStage;
  children: React.ReactNode;
}) {
  const { workflow, isLoading } = useWorkflowGuard(projectId, stage);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <ProjectHeader projectId={projectId} />
        <p className="mt-8 text-[#a39b8f]">Loading workflow</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <ProjectHeader projectId={projectId} />
      <div className="mt-8">
        <h2 className="font-display text-3xl">{WORKFLOW_STAGE_LABELS[stage]}</h2>
        {workflow?.blockedReason && workflow.stage === stage ? (
          <p className="mt-2 text-sm text-[#dfc18a]">{workflow.blockedReason}</p>
        ) : null}
        <div className="mt-6">{children}</div>
        <AssistantHandoffPanel projectId={projectId} stage={stage} />
      </div>
    </div>
  );
}
