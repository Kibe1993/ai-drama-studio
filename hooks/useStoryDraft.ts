"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { StoryDraftRequest } from "@/lib/validation/story";
import type { StoryRecord } from "@/lib/validation/story";

export type GenerationJobView = {
  id: string;
  status: string;
  progress: { stage: string; message: string };
  output: unknown;
  error: { code: string; message: string; retryable: boolean } | null;
};

type StoryDraftState = {
  story: StoryRecord | null;
  job: GenerationJobView | null;
};

const key = (projectId: string) => ["story-draft", projectId] as const;

export function useStoryDraft(projectId: string) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => api<StoryDraftState>(`/api/projects/${projectId}/story-draft`),
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      return job && (job.status === "queued" || job.status === "processing") ? 2000 : false;
    },
  });
}

export function useStartStoryDraft(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StoryDraftRequest) =>
      api<{ story: StoryRecord | null; job: GenerationJobView }>(
        `/api/projects/${projectId}/story-draft`,
        { method: "POST", body: JSON.stringify(input) }
      ),
    onSuccess: (data) => {
      client.setQueryData(key(projectId), data);
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useApproveStoryDraft(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) =>
      api<{ story: StoryRecord }>(
        `/api/projects/${projectId}/story-draft/${storyId}/approve`,
        { method: "POST" }
      ),
    onSuccess: (data) => {
      client.setQueryData(key(projectId), (prev: StoryDraftState | undefined) => ({
        story: data.story,
        job: prev?.job ?? null,
      }));
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
      void client.invalidateQueries({ queryKey: ["projects", projectId] });
    },
  });
}

/**
 * Polls a generation job by id until it completes or fails.
 * Returns the latest job view.
 */
export function useStoryDraftJob(projectId: string, jobId: string | null | undefined) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["story-draft-job", projectId, jobId] as const,
    queryFn: () => api<{ job: GenerationJobView }>(`/api/generations/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const status = q.state.data?.job.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });
  const status = query.data?.job.status;
  useEffect(() => {
    if (status === "completed" || status === "failed") {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    }
  }, [status, client, projectId]);
  return query;
}
