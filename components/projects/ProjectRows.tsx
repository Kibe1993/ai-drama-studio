"use client";

import Link from "next/link";
import { STATUS_LABELS } from "@/lib/domain/projectCatalog";
import type { Project } from "@/hooks/useProjects";

export function ProjectRows({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return <p className="text-[#a39b8f]">No projects in this list.</p>;
  }

  return (
    <ul className="divide-y divide-[#2e2a25] border-y border-[#2e2a25]">
      {projects.map((project) => (
        <li key={project.id}>
          <Link href={`/projects/${project.id}`} className="grid gap-1 py-4 sm:grid-cols-[1fr_auto] sm:items-baseline">
            <span>
              <span className="block text-[#f3efe6]">{project.title}</span>
              <span className="text-sm text-[#a39b8f]">
                {project.genre} · {Math.round(project.targetDurationSeconds / 60)} min · {project.aspectRatio}
              </span>
            </span>
            <span className="text-sm text-[#c4a574]">{STATUS_LABELS[project.status]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
