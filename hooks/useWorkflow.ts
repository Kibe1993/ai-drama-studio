"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { WorkflowState } from "@/lib/services/workflowService";

export const workflowKey = (projectId: string) => ["workflow", projectId] as const;

/**
 * The derived state of the guided workflow for one project: which stage is
 * open, each stage's progress, and why the next one is blocked. The backend
 * owns the truth; this only renders it.
 */
export function useWorkflow(projectId: string) {
  return useQuery({
    queryKey: workflowKey(projectId),
    queryFn: () => api<{ workflow: WorkflowState }>(`/api/projects/${projectId}/workflow`).then((body) => body.workflow),
    refetchInterval: (query) => {
      const workflow = query.state.data;
      return workflow?.bible.generating ? 2000 : false;
    },
  });
}
