import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { isObjectId } from "@/lib/repositories/ownership";
import { productionSceneRepository } from "@/lib/repositories/productionSceneRepository";
import { productionRunRepository } from "@/lib/repositories/productionRunRepository";
import { StudioError } from "@/lib/http/errors";
import type { SceneEdit } from "@/lib/validation/scene";

type ScenePort = Pick<typeof productionSceneRepository, "listForRun" | "updateOwned" | "create">;
type RunPort = Pick<typeof productionRunRepository, "findLatest" | "save">;
type ContinuityPort = { syncSceneEvent(clerkUserId: string, projectId: string, runId: string, scene: SceneEdit & { sceneNumber: number }): Promise<void> };

export function createProductionSceneService(scenes: ScenePort, runs: RunPort, continuity?: ContinuityPort) {
  return {
    async list(actor: RequestAuth, projectId: string) {
      if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
      const run = await runs.findLatest(actor.userId, projectId);
      if (!run) return { run: null, scenes: [] };
      return { run, scenes: await scenes.listForRun(actor.userId, run.id) };
    },

    async create(actor: RequestAuth, projectId: string, sceneNumber: number, input: SceneEdit) {
      if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
      if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
        throw new StudioError("That scene number is not valid", 400, "invalid_scene");
      }
      const run = await runs.findLatest(actor.userId, projectId);
      if (!run || run.status !== "waiting_for_approval" || run.currentStage !== "scenes" || !run.stageResults.scenes) {
        throw new StudioError("Scenes can only be added before scene approval", 409, "scene_edit_closed");
      }
      const storyId = run.stageResults.story?.storyId;
      if (!storyId) throw new StudioError("No approved story found for this run", 409, "missing_story");
      const existing = run.stageResults.scenes.items.find((s) => s.sceneNumber === sceneNumber);
      if (existing) throw new StudioError(`Scene ${sceneNumber} already exists`, 409, "scene_exists");
      const saved = await scenes.create(actor.userId, projectId, run.id, storyId, sceneNumber, input);
      run.stageResults.scenes.items.push({
        sceneNumber,
        title: input.title,
        videoReady: false,
        failed: false,
        location: input.location,
        interiorExterior: input.interiorExterior,
        timeOfDay: input.timeOfDay,
        charactersPresent: input.charactersPresent,
        visualDescription: input.visualDescription,
        action: input.action,
        dialogue: input.dialogue,
        cameraDirection: input.cameraDirection,
        estimatedDurationSeconds: input.estimatedDurationSeconds,
      });
      await runs.save(run);
      await continuity?.syncSceneEvent(actor.userId, projectId, run.id, { ...input, sceneNumber });
      return saved;
    },

    async update(actor: RequestAuth, projectId: string, sceneNumber: number, input: SceneEdit) {
      if (!isObjectId(projectId)) throw new StudioError("That project id is not valid", 400, "invalid_id");
      if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
        throw new StudioError("That scene number is not valid", 400, "invalid_scene");
      }
      const run = await runs.findLatest(actor.userId, projectId);
      if (!run || run.status !== "waiting_for_approval" || run.currentStage !== "scenes" || !run.stageResults.scenes) {
        throw new StudioError("Scenes can only be edited before scene approval", 409, "scene_edit_closed");
      }
      const existing = run.stageResults.scenes.items.find((scene) => scene.sceneNumber === sceneNumber);
      if (!existing) throw new StudioError("Scene not found", 404, "not_found");
      const saved = await scenes.updateOwned(actor.userId, projectId, run.id, sceneNumber, input);
      if (!saved) throw new StudioError("Scene not found", 404, "not_found");
      run.stageResults.scenes.items = run.stageResults.scenes.items.map((scene) => scene.sceneNumber === sceneNumber
        ? { ...scene, ...input }
        : scene);
      await runs.save(run);
      await continuity?.syncSceneEvent(actor.userId, projectId, run.id, { ...input, sceneNumber });
      return saved;
    },
  };
}

import { continuityRepository } from "@/lib/repositories/continuityRepository";

export const productionSceneService = createProductionSceneService(productionSceneRepository, productionRunRepository, continuityRepository);
