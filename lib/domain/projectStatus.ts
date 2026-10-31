import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from "@/lib/domain/projectCatalog";

/**
 * Legal project status changes. Callers name the target. They never copy a
 * status out of a client payload.
 *
 * `failed` may return only to the checkpoint stored on the production run.
 * The caller passes that checkpoint. This table does not guess it.
 */
const EDGES: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["planning", "archived"],
  planning: ["story_ready", "failed"],
  story_ready: ["characters_ready", "archived"],
  characters_ready: ["scenes_ready", "archived"],
  scenes_ready: ["generating", "archived"],
  generating: ["rendering", "failed"],
  rendering: ["completed", "failed"],
  completed: ["archived"],
  failed: ["archived"],
  archived: ["draft"],
};

export function canTransition(
  from: ProjectStatus,
  to: ProjectStatus,
  checkpoint?: ProjectStatus
): boolean {
  if (!PROJECT_STATUSES.includes(from) || !PROJECT_STATUSES.includes(to)) {
    return false;
  }
  if (from === "failed" && to !== "archived") {
    return checkpoint !== undefined && checkpoint !== "failed" && to === checkpoint;
  }
  return EDGES[from].includes(to);
}

export function assertTransition(
  from: ProjectStatus,
  to: ProjectStatus,
  checkpoint?: ProjectStatus
): void {
  if (canTransition(from, to, checkpoint)) return;
  throw new Error(`Cannot change a project from ${from} to ${to}`);
}
