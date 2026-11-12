"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { isBusyStatus, STATUS_LABELS, type ProjectStatus } from "@/lib/domain/projectCatalog";
import { ProductionPanel } from "@/components/production/ProductionPanel";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { StoryBibleEditor } from "@/components/projects/StoryBibleEditor";
import { EpisodeManager } from "@/components/projects/EpisodeManager";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import {
  useArchiveProject,
  useDeleteProject,
  useDuplicateProject,
  useProject,
  useRestoreProject,
  useUpdateProject,
  type Project,
} from "@/hooks/useProjects";
import type { ProjectInput } from "@/lib/validation/project";

const STAGES: ProjectStatus[] = [
  "draft",
  "planning",
  "story_ready",
  "characters_ready",
  "scenes_ready",
  "generating",
  "rendering",
  "completed",
];

function toInput(project: Project): ProjectInput {
  return {
    title: project.title,
    originalStoryIdea: project.originalStoryIdea,
    genre: project.genre as ProjectInput["genre"],
    language: project.language as ProjectInput["language"],
    visualStyle: project.visualStyle as ProjectInput["visualStyle"],
    tone: project.tone,
    targetDurationSeconds: project.targetDurationSeconds as ProjectInput["targetDurationSeconds"],
    aspectRatio: project.aspectRatio as ProjectInput["aspectRatio"],
    productionType: project.productionType,
    productionMode: project.productionMode,
  };
}

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const update = useUpdateProject(projectId);
  const archive = useArchiveProject(projectId);
  const restore = useRestoreProject(projectId);
  const duplicate = useDuplicateProject(projectId);
  const remove = useDeleteProject(projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const project = query.data?.project;
  const message =
    update.error || archive.error || restore.error || duplicate.error || remove.error;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/projects" className="text-sm text-[#c4a574]">
        All projects
      </Link>
      {query.isLoading ? <p className="mt-8 text-[#a39b8f]">Loading project</p> : null}
      {query.isError ? <p className="mt-8 text-[#e7b2a8]">This project could not be opened.</p> : null}
      {project ? (
        <>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-[#c4a574]">{STATUS_LABELS[project.status]}</p>
              <h1 className="font-display text-5xl">{project.title}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              {project.status === "archived" ? (
                <Button variant="quiet" disabled={restore.isPending} onClick={() => restore.mutate()}>
                  Restore
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  disabled={archive.isPending || isBusyStatus(project.status)}
                  onClick={() => archive.mutate()}
                >
                  Archive
                </Button>
              )}
              <Button
                variant="quiet"
                disabled={duplicate.isPending}
                onClick={async () => {
                  const result = await duplicate.mutateAsync();
                  router.push(`/projects/${result.project.id}`);
                }}
              >
                Duplicate
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </div>
          </div>

          <ol className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {STAGES.map((stage) => (
              <li key={stage} className={stage === project.status ? "text-[#f3efe6]" : "text-[#6f675d]"}>
                {STATUS_LABELS[stage]}
              </li>
            ))}
          </ol>
          <ProductionPanel projectId={project.id} status={project.status} />
          <EpisodeManager
            projectId={project.id}
            productionMode={project.productionMode}
            defaultDuration={project.targetDurationSeconds}
            projectStatus={project.status}
          />
          <StoryBibleEditor projectId={project.id} initialIdea={project.originalStoryIdea} initialTitle={project.title} readOnly={project.status === "archived" || isBusyStatus(project.status)} />

          {confirmDelete ? (
            <div className="mt-6 flex flex-wrap items-center gap-3 border border-[#6b3a32] px-4 py-3">
              <p className="text-sm text-[#f0c2b8]">Delete this project and its brief?</p>
              <Button
                variant="danger"
                size="sm"
                disabled={remove.isPending}
                onClick={async () => {
                  await remove.mutateAsync();
                  router.push("/projects");
                }}
              >
                Delete project
              </Button>
              <button type="button" className="text-sm text-[#cfc6b8]" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          ) : null}

          <div className="mt-10">
            {project.status === "archived" || isBusyStatus(project.status) ? (
              <Brief project={project} />
            ) : (
              <ProjectForm
                key={project.updatedAt}
                initial={toInput(project)}
                submitLabel="Save changes"
                pending={update.isPending}
                onSubmit={async (values) => {
                  await update.mutateAsync(values);
                }}
              />
            )}
          </div>
          {message instanceof ApiError ? (
            <p className="mt-4 text-sm text-[#e7b2a8]">{message.message}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Brief({ project }: { project: Project }) {
  return (
    <dl className="grid gap-4 text-[#cfc6b8]">
      <div>
        <dt className="text-sm text-[#a39b8f]">Story idea</dt>
        <dd className="mt-1 whitespace-pre-wrap">{project.originalStoryIdea || "No story idea yet."}</dd>
      </div>
      <div>
        <dt className="text-sm text-[#a39b8f]">Setup</dt>
        <dd className="mt-1">
          {project.productionType} · {project.productionMode} · {project.genre} · {project.language} ·{" "}
          {project.visualStyle} · {project.tone} · {Math.round(project.targetDurationSeconds / 60)} min · {project.aspectRatio}
        </dd>
      </div>
    </dl>
  );
}
