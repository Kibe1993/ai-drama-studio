"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import { workflowKey } from "@/hooks/useWorkflow";
import type { JobRecord } from "@/lib/pipeline/types";
import type { StoryRecord } from "@/lib/validation/story";

const key = (projectId: string) => ["story-draft", projectId] as const;

export type StoryDraftState = { story: StoryRecord | null; job: JobRecord | null };

export type StoryDraftRequest = {
  operation: "generate" | "revise" | "regenerate";
  instruction?: string;
  creativeDirection?: string;
};

/** The project-level story draft of Stage 2 and its latest generation job. */
export function useStoryDraft(projectId: string) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => api<StoryDraftState>(`/api/projects/${projectId}/story-draft`),
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === "queued" || status === "processing" ? 2500 : false;
    },
  });
}

function useInvalidate(projectId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: key(projectId) });
    void client.invalidateQueries({ queryKey: workflowKey(projectId) });
    void client.invalidateQueries({ queryKey: ["projects", projectId] });
    void client.invalidateQueries({ queryKey: ["summary"] });
  };
}

export function useStartStoryDraft(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: StoryDraftRequest) =>
      api<StoryDraftState>(`/api/projects/${projectId}/story-draft`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
}

export function useApproveStoryDraft(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (storyId: string) =>
      api<StoryRecord>(`/api/projects/${projectId}/story-draft/${storyId}/approve`, { method: "POST" }),
    onSuccess: invalidate,
  });
}
export function useStoryDraftJob(projectId: string, jobId: string | null | undefined) {
  return useQuery({
    queryKey: ["story-draft-job", projectId, jobId],
    queryFn: () => api<{ job: JobRecord }>(`/api/generations/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === "queued" || status === "processing" ? 2500 : false;
    },
  });
}
