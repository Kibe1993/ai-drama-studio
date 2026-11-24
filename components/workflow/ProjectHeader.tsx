"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorkflowStepper } from "@/components/workflow/WorkflowStepper";
import { ProjectNav } from "@/components/workflow/ProjectNav";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import {
  isBusyStatus,
  STATUS_LABELS,
} from "@/lib/domain/projectCatalog";
import {
  useArchiveProject,
  useDeleteProject,
  useDuplicateProject,
  useProject,
  useRestoreProject,
} from "@/hooks/useProjects";
import { useWorkflow } from "@/hooks/useWorkflow";

export function ProjectHeader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const query = useProject(projectId);
  const workflow = useWorkflow(projectId);
  const archive = useArchiveProject(projectId);
  const restore = useRestoreProject(projectId);
  const duplicate = useDuplicateProject(projectId);
  const remove = useDeleteProject(projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const project = query.data?.project;

  if (query.isLoading) return <p className="text-[#a39b8f]">Loading project</p>;
  if (query.isError) return <p className="text-[#e7b2a8]">This project could not be opened.</p>;
  if (!project) return null;

  const message = archive.error || restore.error || duplicate.error || remove.error;

  return (
    <div>
      <Link href="/projects" className="text-sm text-[#c4a574]">All projects</Link>
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
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
        </div>
      </div>

      {workflow.isError ? (
        <p className="mt-6 text-sm text-[#e7b2a8]">The workflow status could not be loaded.</p>
      ) : workflow.data ? (
        <WorkflowStepper
          projectId={project.id}
          steps={workflow.data.steps}
          activeStage={workflow.data.stage}
        />
      ) : null}

      <ProjectNav projectId={project.id} />

      {confirmDelete ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 border border-[#6b3a32] px-4 py-3">
          <p className="text-sm text-[#f0c2b8]">Delete this project and all its content?</p>
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

      {message instanceof ApiError ? (
        <p className="mt-4 text-sm text-[#e7b2a8]">{message.message}</p>
      ) : null}
    </div>
  );
}
