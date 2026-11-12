"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { RunRecord, JobRecord } from "@/lib/pipeline/types";
import type { StoryRecord } from "@/lib/validation/story";
import type { SceneRecord } from "@/lib/validation/scene";

export type ProductionState = {
  run: RunRecord | null;
  jobs: JobRecord[];
  story: StoryRecord | null;
  scenes: SceneRecord[];
};

const key = (projectId: string) => ["production", projectId] as const;

export function useProduction(projectId: string) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => api<ProductionState>(`/api/projects/${projectId}/production`),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const open = jobs.some((job) => job.status === "queued" || job.status === "processing");
      return open ? 3000 : false;
    },
  });
}

export function useProductionAction(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<unknown>(`/api/projects/${projectId}/production`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["episodes", projectId] });
      void client.invalidateQueries({ queryKey: ["projects", projectId] });
      void client.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}

export function useApproveStory(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) =>
      api<unknown>(`/api/projects/${projectId}/stories/${storyId}/approve`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["projects", projectId] });
      void client.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}
