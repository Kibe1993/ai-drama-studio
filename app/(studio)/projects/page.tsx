"use client";

import Link from "next/link";
import { ProjectRows } from "@/components/projects/ProjectRows";
import { Button } from "@/components/ui/button";
import { useProjectList } from "@/hooks/useProjects";
import { Plus, FolderOpen } from "lucide-react";

export default function ProjectsPage() {
  const list = useProjectList();
  const projects = list.data?.pages.flatMap((page) => page.projects) ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-[0.16em] text-[#c4a574] uppercase">Projects</p>
          <h1 className="font-display mt-2 text-5xl">My projects</h1>
          <p className="mt-3 text-[#a39b8f]">Drafts stay here until you archive or delete them.</p>
        </div>
        <Button asChild>
          <Link href="/projects/new" className="inline-flex items-center gap-2">
            <Plus size={16} strokeWidth={2} />
            New drama
          </Link>
        </Button>
      </div>

      {list.isLoading ? (
        <p className="mt-10 text-[#a39b8f]">Loading projects…</p>
      ) : null}
      {list.isError ? (
        <p className="mt-10 text-[#e7b2a8]">Projects could not be loaded.</p>
      ) : null}
      {list.data && projects.length === 0 ? (
        <div className="mt-10 rounded-xl border border-[#2e2a25] bg-[#181612] px-6 py-12 text-center">
          <FolderOpen size={32} strokeWidth={1.5} className="mx-auto text-[#6b6258]" />
          <p className="mt-3 text-[#cfc6b8]">No dramas yet. Create one from a story idea.</p>
          <div className="mt-5">
            <Button asChild>
              <Link href="/projects/new" className="inline-flex items-center gap-2">
                <Plus size={16} strokeWidth={2} />
                Create your first drama
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
      {projects.length > 0 ? (
        <div className="mt-8">
          <ProjectRows projects={projects} />
        </div>
      ) : null}
      {list.hasNextPage ? (
        <div className="mt-6 flex justify-center">
          <Button
            variant="quiet"
            size="sm"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
