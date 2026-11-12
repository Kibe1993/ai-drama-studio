"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { EpisodeInput, EpisodeRecord } from "@/lib/validation/episode";

const key = (projectId: string) => ["episodes", projectId] as const;

export function useEpisodes(projectId: string) {
  return useQuery({ queryKey: key(projectId), queryFn: () => api<{ episodes: EpisodeRecord[] }>(`/api/projects/${projectId}/episodes`) });
}

export function useCreateEpisode(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EpisodeInput) => api<{ episode: EpisodeRecord }>(`/api/projects/${projectId}/episodes`, {
      method: "POST", body: JSON.stringify(input),
    }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: key(projectId) }); },
  });
}
