export const EXPOSED_READ_TOOLS = [
  "project.list",
  "project.get",
  "project.context",
  "document.get",
  "document.export",
  "entity.list",
  "entity.get",
  "canon.query",
  "canon.summary",
  "scene.list",
  "scene.get",
  "episode.list",
  "episode.get",
  "media.list",
  "timeline.get",
  "activity.list",
  "pipeline.get",
  "planning.get",
  "review.listPending",
  "render.status",
] as const;

export const EXPOSED_WRITE_TOOLS = [
  "project.create",
  "project.update",
  "document.update",
  "document.import",
  "story.createDraft",
  "entity.create",
  "canon.add",
  "scene.create",
  "scene.update",
  "episode.create",
  "episode.updateScreenplay",
  "planning.update",
  "planning.submit",
  "pipeline.start",
  "pipeline.generateStory",
] as const;

export const DESTRUCTIVE_TOOLS = [
  "project.delete",
] as const;

export const ALL_EXPOSED_TOOLS = [...EXPOSED_READ_TOOLS, ...EXPOSED_WRITE_TOOLS, ...DESTRUCTIVE_TOOLS] as const;

const WRITE_SET = new Set<string>(EXPOSED_WRITE_TOOLS);
const DESTRUCTIVE_SET = new Set<string>(DESTRUCTIVE_TOOLS);
const EXPOSED_SET = new Set<string>(ALL_EXPOSED_TOOLS);

export function requiresApproval(toolName: string): boolean {
  return WRITE_SET.has(toolName) || DESTRUCTIVE_SET.has(toolName);
}

export function isDestructive(toolName: string): boolean {
  return DESTRUCTIVE_SET.has(toolName);
}

export function isExposed(toolName: string): boolean {
  return EXPOSED_SET.has(toolName);
}