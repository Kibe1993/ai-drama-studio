import { describe, expect, it } from "vitest";
import type { RequestAuth } from "@/lib/auth/session";
import type { RunRecord } from "@/lib/pipeline/types";
import type { SceneRecord } from "@/lib/validation/scene";
import { createProductionSceneService } from "@/lib/services/productionSceneService";

const owner: RequestAuth = { userId: "scene-owner", isAdmin: false, email: "", name: "", imageUrl: "" };
const projectId = "a".repeat(24);
const runId = "b".repeat(24);
const now = new Date().toISOString();

function makeScene(): SceneRecord {
  return {
    id: "c".repeat(24), clerkUserId: owner.userId, projectId, productionRunId: runId,
    episodeId: "d".repeat(24), storyId: "e".repeat(24), sceneNumber: 1,
    title: "The letter", location: "Kitchen", interiorExterior: "interior", timeOfDay: "Evening",
    charactersPresent: ["Amara"], visualDescription: "Warm lamplight on a folded letter.",
    action: "Amara opens the letter.", dialogue: [], cameraDirection: "Slow push in",
    estimatedDurationSeconds: 45, shotPlan: [], videoReady: false, videoStatus: "pending",
    videoAssetId: null, failed: false, createdAt: now, updatedAt: now,
  };
}

function harness() {
  const scene = makeScene();
  const run: RunRecord = {
    id: runId, clerkUserId: owner.userId, projectId, episode: null, workflowMode: "guided",
    currentStage: "scenes", status: "waiting_for_approval",
    stageResults: { scenes: { approved: false, items: [{
      sceneNumber: 1, title: scene.title, location: scene.location, interiorExterior: "interior",
      timeOfDay: scene.timeOfDay, charactersPresent: scene.charactersPresent,
      visualDescription: scene.visualDescription, action: scene.action, dialogue: [],
      cameraDirection: scene.cameraDirection, estimatedDurationSeconds: 45,
      videoReady: false, videoStatus: "pending", failed: false,
    }] } }, retryCheckpoint: null, startedAt: now, completedAt: null,
  };
  const service = createProductionSceneService(
    {
      async listForRun() { return [scene]; },
      async updateOwned(_userId, _projectId, _runId, _sceneNumber, input) {
        Object.assign(scene, input, { updatedAt: now });
        return scene;
      },
    },
    {
      async findLatest(userId, id) { return userId === owner.userId && id === projectId ? run : null; },
      async save(value) { Object.assign(run, value); return run; },
    },
  );
  return { service, run, scene };
}

describe("persistent scene planning", () => {
  it("saves shot plans to the scene record and synchronizes the approval snapshot", async () => {
    const { service, run, scene } = harness();
    const input = {
      title: "The letter", location: "Kitchen", interiorExterior: "interior" as const,
      timeOfDay: "Evening", charactersPresent: ["Amara"],
      visualDescription: "Warm lamplight on a folded letter.", action: "Amara opens it.",
      dialogue: [], cameraDirection: "Slow push in", estimatedDurationSeconds: 45,
      shotPlan: [{ shotNumber: 1, purpose: "Reveal her reaction", framing: "Close-up", cameraDirection: "Push in", action: "She looks up", estimatedDurationSeconds: 8 }],
    };
    const saved = await service.update(owner, projectId, 1, input);
    expect(saved.shotPlan).toEqual(input.shotPlan);
    expect(scene.shotPlan).toEqual(input.shotPlan);
    expect(run.stageResults.scenes?.items[0]?.action).toBe("Amara opens it.");
  });

  it("locks scene edits after the approval checkpoint", async () => {
    const { service, run } = harness();
    run.currentStage = "media";
    run.status = "running";
    await expect(service.update(owner, projectId, 1, {
      title: "The letter", location: "Kitchen", interiorExterior: "interior", timeOfDay: "Evening",
      charactersPresent: ["Amara"], visualDescription: "Light", action: "Open letter", dialogue: [],
      cameraDirection: "", estimatedDurationSeconds: 45, shotPlan: [],
    })).rejects.toMatchObject({ code: "scene_edit_closed" });
  });
});
