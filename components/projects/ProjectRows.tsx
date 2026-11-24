"use client";

import Link from "next/link";
import { PRODUCTION_MODES, PRODUCTION_TYPES, STATUS_LABELS } from "@/lib/domain/projectCatalog";
import type { Project } from "@/hooks/useProjects";

const STATUS_COLORS: Record<string, string> = {
  draft: "#a39b8f",
  story_pending: "#c4a574",
  story_approved: "#6bb36b",
  characters_pending: "#c4a574",
  characters_approved: "#6bb36b",
  scenes_pending: "#c4a574",
  scenes_approved: "#6bb36b",
  media_pending: "#c4a574",
  rendering: "#7b9bdb",
  completed: "#6bb36b",
  archived: "#6b6258",
  failed: "#e7b2a8",
};

export function ProjectRows({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return <p className="text-[#a39b8f]">No projects in this list.</p>;
  }

  return (
    <ul className="space-y-2">
      {projects.map((project) => {
        const statusColor = STATUS_COLORS[project.status] ?? "#a39b8f";
        return (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}`}
              className="block rounded-xl border border-[#2e2a25] bg-[#181612] px-5 py-4 transition-colors duration-150 hover:border-[#3a342c] hover:bg-[#1f1c17]"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-[#f3efe6]">{project.title}</span>
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    color: statusColor,
                    backgroundColor: `${statusColor}1a`,
                  }}
                >
                  {STATUS_LABELS[project.status]}
                </span>
              </div>
              <span className="mt-1 block text-sm text-[#a39b8f]">
                {PRODUCTION_TYPES.find((item) => item.id === project.productionType)?.label} ·{" "}
                {PRODUCTION_MODES.find((item) => item.id === project.productionMode)?.label} · {project.genre} ·{" "}
                {Math.round(project.targetDurationSeconds / 60)} min · {project.aspectRatio}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
