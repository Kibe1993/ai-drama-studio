"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { EpisodeInput, EpisodeRecord } from "@/lib/validation/episode";

const key = (projectId: string) => ["episodes", projectId] as const;

export type EpisodeSuggestJobView = {
  id: string;
  status: string;
  progress: { stage: string; message: string };
  error: { code: string; message: string; retryable: boolean } | null;
};

export function useEpisodes(projectId: string) {
  return useQuery({ queryKey: key(projectId), queryFn: () => api<{ episodes: EpisodeRecord[] }>(`/api/projects/${projectId}/episodes`) });
}

export function useCreateEpisode(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EpisodeInput) => api<{ episode: EpisodeRecord }>(`/api/projects/${projectId}/episodes`, {
      method: "POST", body: JSON.stringify(input),
    }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useGenerateEpisode(projectId: string) {
  const client = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => api<{ job: EpisodeSuggestJobView }>(`/api/projects/${projectId}/episodes/generate`, {
      method: "POST", body: JSON.stringify({}),
    }),
    onSuccess: (data) => { setJobId(data.job.id); },
  });
  const job = useQuery({
    queryKey: ["episode-suggest-job", jobId],
    queryFn: () => api<{ job: EpisodeSuggestJobView }>(`/api/generations/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });
  const status = job.data?.job.status;
  useEffect(() => {
    if (status === "completed") {
      void client.invalidateQueries({ queryKey: key(projectId) });
    }
  }, [status, client, projectId]);
  const running = Boolean(jobId) && (status === "queued" || status === "processing");
  const failed = status === "failed";
  return {
    start: () => { setJobId(null); start.mutate(); },
    pending: start.isPending || running,
    message: running ? (job.data?.job.progress.message ?? "Developing episode idea…") : null,
    error: start.error ?? (failed && job.data?.job.error ? new Error(job.data.job.error.message) : null),
  };
}
