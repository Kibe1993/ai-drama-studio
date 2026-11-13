"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useUpdateStory } from "@/hooks/useProduction";
import type { DialogueLine, ScreenplayScene, StoryRecord } from "@/lib/validation/story";

/**
 * CASNA: the creator can edit an unapproved screenplay directly. Saving
 * revalidates the episode against canon on the server; approval stays blocked
 * while an error finding remains.
 */
export function ScreenplayEditor({
  projectId,
  story,
}: {
  projectId: string;
  story: StoryRecord;
}) {
  const update = useUpdateStory(projectId);
  const [title, setTitle] = useState(story.title);
  const [synopsis, setSynopsis] = useState(story.synopsis);
  const [scenes, setScenes] = useState<ScreenplayScene[]>(() => cloneScenes(story.screenplay));

  function setScene(sceneNumber: number, patch: Partial<ScreenplayScene>) {
    setScenes((current) =>
      current.map((scene) => (scene.sceneNumber === sceneNumber ? { ...scene, ...patch } : scene))
    );
  }

  function save() {
    update.mutate({
      storyId: story.id,
      title: title.trim() || undefined,
      synopsis: synopsis.trim() || undefined,
      screenplay: scenes,
      expectedUpdatedAt: story.updatedAt,
    });
  }

  const error = update.error;
  const validation = update.data?.story.validationFindings;

  return (
    <details className="mt-4 rounded border border-[#39342d] p-4">
      <summary className="cursor-pointer font-display text-lg text-[#f3efe6]">
        Edit this screenplay
      </summary>
      <p className="mt-2 text-xs text-[#a39b8f]">
        Saving revalidates the episode against the Story Bible, Season Plan, and Continuity Ledger. You
        cannot edit a screenplay that has already been approved.
      </p>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-[#c4a574]">Episode title</span>
          <input
            className="studio-field"
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-[#c4a574]">Synopsis</span>
          <textarea
            className="studio-field min-h-20"
            maxLength={2000}
            value={synopsis}
            onChange={(event) => setSynopsis(event.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4">
        {scenes.map((scene) => (
          <div key={scene.sceneNumber} className="border border-[#2e2a25] p-3">
            <p className="text-sm text-[#f3efe6]">Scene {scene.sceneNumber}</p>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-xs">
                <span className="text-[#a39b8f]">Heading</span>
                <input
                  className="studio-field"
                  maxLength={160}
                  value={scene.heading}
                  onChange={(event) => setScene(scene.sceneNumber, { heading: event.target.value })}
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  <span className="text-[#a39b8f]">Location</span>
                  <input
                    className="studio-field"
                    maxLength={160}
                    value={scene.location}
                    onChange={(event) => setScene(scene.sceneNumber, { location: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-[#a39b8f]">Time of day</span>
                  <input
                    className="studio-field"
                    maxLength={40}
                    value={scene.timeOfDay}
                    onChange={(event) => setScene(scene.sceneNumber, { timeOfDay: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-[#a39b8f]">Characters (comma separated)</span>
                  <input
                    className="studio-field"
                    value={scene.charactersPresent.join(", ")}
                    onChange={(event) =>
                      setScene(scene.sceneNumber, {
                        charactersPresent: event.target.value
                          .split(",")
                          .map((name) => name.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              </div>
              <label className="grid gap-1 text-xs">
                <span className="text-[#a39b8f]">Visual description</span>
                <textarea
                  className="studio-field min-h-16"
                  maxLength={2000}
                  value={scene.visualDescription}
                  onChange={(event) =>
                    setScene(scene.sceneNumber, { visualDescription: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="text-[#a39b8f]">Action</span>
                <textarea
                  className="studio-field min-h-16"
                  maxLength={2000}
                  value={scene.action}
                  onChange={(event) => setScene(scene.sceneNumber, { action: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="text-[#a39b8f]">Dialogue (one line per entry: Name: line)</span>
                <textarea
                  className="studio-field min-h-20"
                  value={dialogueText(scene.dialogue)}
                  onChange={(event) =>
                    setScene(scene.sceneNumber, { dialogue: parseDialogue(event.target.value) })
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={update.isPending} onClick={save}>
          {update.isPending ? "Saving…" : "Save edit and revalidate"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-[#e7b2a8]">
            {error instanceof ApiError ? error.message : "The screenplay could not be saved."}
          </p>
        ) : null}
        {validation && !error ? (
          <p role="status" className="text-sm text-[#dfc18a]">
            {validation.passed
              ? "Saved. The episode passes validation."
              : "Saved, but validation errors remain. Resolve them before approving."}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function dialogueText(dialogue: DialogueLine[]): string {
  return dialogue.map((line) => `${line.characterName}: ${line.line}`).join("\n");
}

function parseDialogue(value: string): DialogueLine[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator <= 0) return { characterName: "Narrator", line };
      return {
        characterName: line.slice(0, separator).trim() || "Narrator",
        line: line.slice(separator + 1).trim(),
      };
    })
    .filter((line) => line.line.length > 0);
}

function cloneScenes(screenplay: ScreenplayScene[]): ScreenplayScene[] {
  return screenplay.map((scene) => ({
    ...scene,
    charactersPresent: [...scene.charactersPresent],
    dialogue: scene.dialogue.map((line) => ({ ...line })),
  }));
}
