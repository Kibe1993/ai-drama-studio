"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { StoryBibleDraft, StoryBibleRecord } from "@/lib/validation/storyBible";

const key = (projectId: string) => ["story-bible", projectId] as const;

export function useStoryBible(projectId: string) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => api<{ bible: StoryBibleRecord }>(`/api/projects/${projectId}/story-bible`),
    refetchInterval: (query) => {
      const status = query.state.data?.bible.generationStatus;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });
}

export type StoryBibleJobView = {
  id: string;
  status: string;
  progress: { stage: string; message: string };
  output: unknown;
};

export function useStoryBibleJob(projectId: string, jobId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["story-bible-job", projectId, jobId],
    queryFn: () => api<{ job: StoryBibleJobView }>(`/api/generations/${jobId}`),
    enabled: Boolean(jobId) && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });
}

export type StoryBibleGenerationRequest = {
  operation: "generate" | "regenerate" | "revise" | "section";
  idea?: string;
  title?: string;
  creativeDirection?: string;
  instruction?: string;
  section?: string;
  freshInterpretation?: boolean;
};

export function useGenerateStoryBible(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StoryBibleGenerationRequest) => api<{ bible: StoryBibleRecord; job: unknown }>(
      `/api/projects/${projectId}/story-bible/generate`, { method: "POST", body: JSON.stringify(input) }
    ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useRegenerateStoryBible(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<StoryBibleGenerationRequest, "operation">) => api<{ bible: StoryBibleRecord; job: unknown }>(
      `/api/projects/${projectId}/story-bible/regenerate`, { method: "POST", body: JSON.stringify(input) }
    ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useReviseStoryBible(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<StoryBibleGenerationRequest, "instruction" | "freshInterpretation">) => api<{ bible: StoryBibleRecord; job: unknown }>(
      `/api/projects/${projectId}/story-bible/revise`, { method: "POST", body: JSON.stringify(input) }
    ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useRegenerateStoryBibleSection(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<StoryBibleGenerationRequest, "section" | "instruction" | "freshInterpretation">) => api<{ bible: StoryBibleRecord; job: unknown }>(
      `/api/projects/${projectId}/story-bible/sections/${input.section}/regenerate`, { method: "POST", body: JSON.stringify(input) }
    ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useSaveStoryBible(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: StoryBibleDraft) => api<{ bible: StoryBibleRecord }>(
      `/api/projects/${projectId}/story-bible`, { method: "PATCH", body: JSON.stringify(draft) }
    ),
    onSuccess: (result) => {
      client.setQueryData(key(projectId), result);
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useApproveStoryBible(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { expectedVersion: number; expectedDraftRevision: number }) => api<{ bible: StoryBibleRecord }>(
      `/api/projects/${projectId}/story-bible`, {
        method: "POST",
        body: JSON.stringify(input),
      }
    ),
    onSuccess: (result) => {
      client.setQueryData(key(projectId), result);
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}
