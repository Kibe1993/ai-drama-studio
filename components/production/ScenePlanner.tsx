"use client";

import { useState } from "react";
import { ApiError } from "@/hooks/api";
import { useSceneEdit } from "@/hooks/useSceneEdit";
import type { SceneEdit, SceneRecord, ShotPlan } from "@/lib/validation/scene";
import { Button } from "@/components/ui/button";

export function ScenePlanner({ projectId, scenes }: { projectId: string; scenes: SceneRecord[] }) {
  const edit = useSceneEdit(projectId);
  const [drafts, setDrafts] = useState<Record<string, SceneEdit>>({});
  function draftOf(scene: SceneRecord): SceneEdit {
    return drafts[scene.id] ?? {
      title: scene.title,
      location: scene.location,
      interiorExterior: scene.interiorExterior,
      timeOfDay: scene.timeOfDay,
      charactersPresent: scene.charactersPresent,
      visualDescription: scene.visualDescription,
      action: scene.action,
      dialogue: scene.dialogue,
      cameraDirection: scene.cameraDirection,
      estimatedDurationSeconds: scene.estimatedDurationSeconds,
      shotPlan: scene.shotPlan,
    };
  }
  function change(scene: SceneRecord, patch: Partial<SceneEdit>) {
    setDrafts((current) => ({ ...current, [scene.id]: { ...draftOf(scene), ...patch } }));
  }
  async function save(scene: SceneRecord) {
    await edit.mutateAsync({ sceneNumber: scene.sceneNumber, input: draftOf(scene) });
    setDrafts((current) => { const next = { ...current }; delete next[scene.id]; return next; });
  }

  if (!scenes.length) return null;
  return (
    <section className="mt-5 border-t border-[#2e2a25] pt-4">
      <h3 className="font-display text-2xl">Scene plan</h3>
      <p className="mt-1 text-xs text-[#a39b8f]">Edit scene details and add a shot plan before approving the scene breakdown.</p>
      <div className="mt-3 grid gap-4">
        {scenes.map((scene) => {
          const draft = draftOf(scene);
          const updateShot = (index: number, patch: Partial<ShotPlan>) => {
            const shotPlan = draft.shotPlan.map((shot, shotIndex) => shotIndex === index ? { ...shot, ...patch } : shot);
            change(scene, { shotPlan });
          };
          return (
            <article key={scene.id} className="border border-[#2e2a25] p-3">
              <p className="text-sm text-[#c4a574]">Scene {scene.sceneNumber}</p>
              <div className="mt-2 grid gap-2">
                <input aria-label={`Scene ${scene.sceneNumber} title`} className="studio-field" value={draft.title} onChange={(event) => change(scene, { title: event.target.value })} />
                <input aria-label={`Scene ${scene.sceneNumber} location`} className="studio-field" value={draft.location} onChange={(event) => change(scene, { location: event.target.value })} />
                <textarea aria-label={`Scene ${scene.sceneNumber} visual description`} className="studio-field min-h-20" value={draft.visualDescription} onChange={(event) => change(scene, { visualDescription: event.target.value })} />
                <textarea aria-label={`Scene ${scene.sceneNumber} action`} className="studio-field min-h-20" value={draft.action} onChange={(event) => change(scene, { action: event.target.value })} />
                <textarea aria-label={`Scene ${scene.sceneNumber} camera direction`} className="studio-field min-h-16" value={draft.cameraDirection} onChange={(event) => change(scene, { cameraDirection: event.target.value })} placeholder="Overall camera direction" />
              </div>
              <div className="mt-3 grid gap-2">
                <p className="text-xs uppercase tracking-wide text-[#a39b8f]">Shot plan</p>
                {draft.shotPlan.map((shot, index) => (
                  <div key={`${scene.id}-shot-${index}`} className="grid gap-2 border-l border-[#6b5a3c] pl-3">
                    <input aria-label={`Scene ${scene.sceneNumber} shot ${index + 1} purpose`} className="studio-field" value={shot.purpose} onChange={(event) => updateShot(index, { purpose: event.target.value })} placeholder="Shot purpose" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input aria-label={`Scene ${scene.sceneNumber} shot ${index + 1} framing`} className="studio-field" value={shot.framing} onChange={(event) => updateShot(index, { framing: event.target.value })} placeholder="Framing" />
                      <input aria-label={`Scene ${scene.sceneNumber} shot ${index + 1} duration`} className="studio-field" type="number" min={1} max={180} value={shot.estimatedDurationSeconds ?? ""} onChange={(event) => updateShot(index, { estimatedDurationSeconds: event.target.value ? Number(event.target.value) : null })} placeholder="Seconds" />
                    </div>
                    <textarea aria-label={`Scene ${scene.sceneNumber} shot ${index + 1} camera`} className="studio-field min-h-14" value={shot.cameraDirection} onChange={(event) => updateShot(index, { cameraDirection: event.target.value })} placeholder="Camera movement or angle" />
                    <textarea aria-label={`Scene ${scene.sceneNumber} shot ${index + 1} action`} className="studio-field min-h-14" value={shot.action} onChange={(event) => updateShot(index, { action: event.target.value })} placeholder="What this shot shows" />
                    <Button size="sm" variant="quiet" onClick={() => change(scene, { shotPlan: draft.shotPlan.filter((_, shotIndex) => shotIndex !== index).map((item, shotIndex) => ({ ...item, shotNumber: shotIndex + 1 })) })}>Remove shot</Button>
                  </div>
                ))}
                <Button size="sm" variant="quiet" disabled={draft.shotPlan.length >= 20} onClick={() => change(scene, { shotPlan: [...draft.shotPlan, { shotNumber: draft.shotPlan.length + 1, purpose: "New shot", framing: "", cameraDirection: "", action: "", estimatedDurationSeconds: null }] })}>Add shot</Button>
              </div>
              <Button className="mt-3" size="sm" disabled={edit.isPending} onClick={() => void save(scene)}>{edit.isPending ? "Saving scene" : "Save scene plan"}</Button>
            </article>
          );
        })}
      </div>
      {edit.error ? <p role="alert" className="mt-3 text-sm text-[#e7b2a8]">{edit.error instanceof ApiError ? edit.error.message : "Scene changes could not be saved."}</p> : null}
    </section>
  );
}
