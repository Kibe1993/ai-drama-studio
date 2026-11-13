"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkflow } from "@/hooks/useWorkflow";
import type { WorkflowStage } from "@/lib/domain/workflow";
import { WORKFLOW_STAGE_PATH } from "@/lib/domain/workflow";

/**
 * Returns whether a given stage is accessible based on workflow state.
 * Earlier stages are always accessible (review), but a user cannot jump ahead
 * past the current stage.
 */
function isStageAccessible(targetStage: WorkflowStage, currentStage: WorkflowStage): boolean {
  const order = ["story", "bible", "plan", "episodes", "production"] as const;
  const targetIndex = order.indexOf(targetStage as (typeof order)[number]);
  const currentIndex = order.indexOf(currentStage as (typeof order)[number]);
  return targetIndex <= currentIndex;
}

/**
 * Redirects to the current workflow stage if the user tries to access a
 * stage that hasn't been unlocked yet. Returns the workflow state and a
 * boolean indicating whether the stage is accessible.
 */
export function useWorkflowGuard(projectId: string, stage: WorkflowStage) {
  const router = useRouter();
  const query = useWorkflow(projectId);
  const workflow = query.data;
  const accessible = workflow ? isStageAccessible(stage, workflow.stage) : true;

  useEffect(() => {
    if (workflow && !isStageAccessible(stage, workflow.stage)) {
      router.replace(`/projects/${projectId}/${WORKFLOW_STAGE_PATH[workflow.stage]}`);
    }
  }, [workflow, stage, projectId, router]);

  return { workflow, isLoading: query.isLoading, accessible };
}
