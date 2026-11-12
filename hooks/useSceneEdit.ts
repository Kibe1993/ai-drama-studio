"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/api";
import type { SceneEdit, SceneRecord } from "@/lib/validation/scene";

export function useSceneEdit(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneNumber, input }: { sceneNumber: number; input: SceneEdit }) =>
      api<{ scene: SceneRecord }>(`/api/projects/${projectId}/scenes?sceneNumber=${sceneNumber}`, {
        method: "PATCH", body: JSON.stringify(input),
      }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["production", projectId] }); },
  });
}
