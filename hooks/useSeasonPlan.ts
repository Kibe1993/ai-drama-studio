"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { SeasonPlanRequest } from "@/lib/validation/seasonPlan";
import type { SeasonPlan, SeasonPlanRecord } from "@/lib/validation/seasonPlan";
import type { ContinuityLedgerRecord } from "@/lib/validation/continuityLedger";

export type SeasonPlanJobView = {
  id: string;
  status: string;
  progress: { stage: string; message: string };
  output: unknown;
  error: { code: string; message: string; retryable: boolean } | null;
};

type SeasonPlanState = {
  plan: SeasonPlanRecord | null;
  job: SeasonPlanJobView | null;
  ledger: ContinuityLedgerRecord | null;
};

const key = (projectId: string) => ["season-plan", projectId] as const;

export function useSeasonPlan(projectId: string) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => api<SeasonPlanState>(`/api/projects/${projectId}/season-plan`),
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      return job && (job.status === "queued" || job.status === "processing") ? 2000 : false;
    },
  });
}

export function useStartSeasonPlan(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SeasonPlanRequest) =>
      api<{ plan: SeasonPlanRecord | null; job: SeasonPlanJobView }>(
        `/api/projects/${projectId}/season-plan`,
        { method: "POST", body: JSON.stringify(input) }
      ),
    onSuccess: (data) => {
      client.setQueryData(key(projectId), (prev: SeasonPlanState | undefined) => ({
        plan: data.plan ?? prev?.plan ?? null,
        job: data.job,
        ledger: prev?.ledger ?? null,
      }));
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useUpdateSeasonPlan(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { planId: string; expectedVersion: number; plan: SeasonPlan }) =>
      api<{ plan: SeasonPlanRecord }>(
        `/api/projects/${projectId}/season-plan/${input.planId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion: input.expectedVersion, plan: input.plan }),
        }
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(projectId) });
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export function useApproveSeasonPlan(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      api<{ plan: SeasonPlanRecord }>(
        `/api/projects/${projectId}/season-plan/${planId}/approve`,
        { method: "POST" }
      ),
    onSuccess: (data) => {
      client.setQueryData(key(projectId), (prev: SeasonPlanState | undefined) => ({
        plan: data.plan,
        job: prev?.job ?? null,
        ledger: prev?.ledger ?? null,
      }));
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}

export type ProposedDevelopmentView = {
  episodeNumber: number;
  development: string;
  source: "episode_plan";
};

export type ContinuityView = {
  ledger: ContinuityLedgerRecord | null;
  proposedDevelopments: ProposedDevelopmentView[];
  canRebuild: boolean;
};

export function useContinuity(projectId: string) {
  return useQuery({
    queryKey: ["continuity", projectId] as const,
    queryFn: () => api<ContinuityView>(`/api/projects/${projectId}/continuity`),
  });
}

export function useRebuildContinuity(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ replayedEpisodes: number; created: boolean; ledger: ContinuityLedgerRecord | null }>(
        `/api/projects/${projectId}/continuity/rebuild`,
        { method: "POST", body: JSON.stringify({}) }
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["continuity", projectId] });
      void client.invalidateQueries({ queryKey: ["workflow", projectId] });
    },
  });
}
