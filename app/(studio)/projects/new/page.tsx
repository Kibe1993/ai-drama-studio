"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { emptyProject, ProjectForm } from "@/components/projects/ProjectForm";
import { ApiError } from "@/hooks/api";
import { useCreateProject } from "@/hooks/useProjects";

export default function NewProjectPage() {
  const router = useRouter();
  const create = useCreateProject();
  const idempotencyKey = useRef(crypto.randomUUID());

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-5xl">New drama</h1>
      <p className="mt-3 mb-8 text-[#a39b8f]">
        A short brief is enough. The story is not generated until a later stage.
      </p>
      <ProjectForm
        initial={emptyProject}
        submitLabel="Save draft"
        pending={create.isPending}
        onSubmit={async (values) => {
          const result = await create.mutateAsync({
            input: values,
            idempotencyKey: idempotencyKey.current,
          });
          router.push(`/projects/${result.project.id}/story`);
        }}
      />
      {create.isError ? (
        <p className="mt-4 text-sm text-[#e7b2a8]">
          {create.error instanceof ApiError ? create.error.message : "The draft could not be saved."}
        </p>
      ) : null}
    </div>
  );
}
