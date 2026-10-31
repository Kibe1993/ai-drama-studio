"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { ProjectStatus } from "@/lib/domain/projectCatalog";
import type { ProjectInput } from "@/lib/validation/project";

export type Project = {
  id: string;
  title: string;
  originalStoryIdea: string;
  genre: string;
  language: string;
  visualStyle: string;
  tone: string;
  targetDurationSeconds: number;
  aspectRatio: string;
  status: ProjectStatus;
  workflowMode: "guided" | "automatic";
  createdAt: string;
  updatedAt: string;
};

type ProjectPage = { projects: Project[]; nextCursor: string | null };
type Summary = {
  counts: Record<ProjectStatus, number>;
  recent: Project[];
  completed: Project[];
};

export const projectKeys = {
  all: ["projects"] as const,
  list: ["projects", "list"] as const,
  detail: (id: string) => ["projects", id] as const,
  summary: ["summary"] as const,
};

export function useProjectList() {
  return useInfiniteQuery({
    queryKey: projectKeys.list,
    queryFn: ({ pageParam }) => {
      const query = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
      return api<ProjectPage>(`/api/projects${query}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => api<{ project: Project }>(`/api/projects/${id}`),
  });
}

export function useSummary() {
  return useQuery({
    queryKey: projectKeys.summary,
    queryFn: () => api<Summary>("/api/summary"),
  });
}

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: ProjectInput; idempotencyKey: string }) =>
      api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "idempotency-key": idempotencyKey },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: projectKeys.all });
      void client.invalidateQueries({ queryKey: projectKeys.summary });
    },
  });
}

export function useUpdateProject(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectInput) =>
      api<{ project: Project }>(`/api/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (result) => {
      client.setQueryData(projectKeys.detail(id), result);
      void client.invalidateQueries({ queryKey: projectKeys.list });
      void client.invalidateQueries({ queryKey: projectKeys.summary });
    },
  });
}

function useProjectAction(id: string, path: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ project: Project }>(`/api/projects/${id}/${path}`, { method: "POST" }),
    onSuccess: (result) => {
      client.setQueryData(projectKeys.detail(id), result);
      void client.invalidateQueries({ queryKey: projectKeys.list });
      void client.invalidateQueries({ queryKey: projectKeys.summary });
    },
  });
}

export function useArchiveProject(id: string) {
  return useProjectAction(id, "archive");
}

export function useRestoreProject(id: string) {
  return useProjectAction(id, "restore");
}

export function useDuplicateProject(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ project: Project }>(`/api/projects/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: projectKeys.list });
      void client.invalidateQueries({ queryKey: projectKeys.summary });
    },
  });
}

export function useDeleteProject(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ deleted: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      client.removeQueries({ queryKey: projectKeys.detail(id) });
      void client.invalidateQueries({ queryKey: projectKeys.list });
      void client.invalidateQueries({ queryKey: projectKeys.summary });
    },
  });
}
