"use client";

import Link from "next/link";
import { ProjectRows } from "@/components/projects/ProjectRows";
import { Button } from "@/components/ui/button";
import { useProjectList } from "@/hooks/useProjects";

export default function ProjectsPage() {
  const list = useProjectList();
  const projects = list.data?.pages.flatMap((page) => page.projects) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">My projects</h1>
          <p className="mt-3 text-[#a39b8f]">Drafts stay here until you archive or delete them.</p>
        </div>
        <Button asChild>
          <Link href="/projects/new">New drama</Link>
        </Button>
      </div>

      {list.isLoading ? <p className="mt-10 text-[#a39b8f]">Loading projects</p> : null}
      {list.isError ? <p className="mt-10 text-[#e7b2a8]">Projects could not be loaded.</p> : null}
      {list.data && projects.length === 0 ? (
        <p className="mt-10 text-[#cfc6b8]">No dramas yet. Create one from a story idea.</p>
      ) : null}
      {projects.length > 0 ? (
        <div className="mt-8">
          <ProjectRows projects={projects} />
        </div>
      ) : null}
      {list.hasNextPage ? (
        <button
          type="button"
          className="mt-6 text-sm text-[#c4a574]"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? "Loading" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
