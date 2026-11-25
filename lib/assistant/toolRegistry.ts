export const EXPOSED_READ_TOOLS = [
  "project.list",
  "project.get",
  "document.get",
  "entity.list",
  "entity.get",
  "canon.get",
  "canon.facts",
  "scene.list",
  "scene.get",
  "episode.list",
  "episode.get",
  "media.list",
  "timeline.get",
  "activity.recent",
] as const;

export const EXPOSED_WRITE_TOOLS = [
  "document.update",
  "story.propose",
  "entity.create",
  "entity.update",
] as const;

export const ALL_EXPOSED_TOOLS = [...EXPOSED_READ_TOOLS, ...EXPOSED_WRITE_TOOLS] as const;

const WRITE_SET = new Set<string>(EXPOSED_WRITE_TOOLS);
const EXPOSED_SET = new Set<string>(ALL_EXPOSED_TOOLS);

export function requiresApproval(toolName: string): boolean {
  return WRITE_SET.has(toolName);
}

export function isExposed(toolName: string): boolean {
  return EXPOSED_SET.has(toolName);
}