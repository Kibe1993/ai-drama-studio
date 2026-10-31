export const PROJECT_STATUSES = [
  "draft",
  "planning",
  "story_ready",
  "characters_ready",
  "scenes_ready",
  "generating",
  "rendering",
  "completed",
  "failed",
  "archived",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const GENRES = [
  { id: "romance", label: "Romance" },
  { id: "family", label: "Family drama" },
  { id: "comedy", label: "Comedy" },
  { id: "suspense", label: "Suspense" },
  { id: "thriller", label: "Thriller" },
  { id: "crime", label: "Crime" },
  { id: "inspirational", label: "Inspirational" },
  { id: "social", label: "Social drama" },
] as const;

export type Genre = (typeof GENRES)[number]["id"];

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "pt", label: "Portuguese" },
  { id: "sw", label: "Swahili" },
  { id: "ar", label: "Arabic" },
  { id: "hi", label: "Hindi" },
  { id: "zh", label: "Chinese" },
] as const;

export type ProjectLanguage = (typeof LANGUAGES)[number]["id"];

export const VISUAL_STYLES = [
  { id: "realistic", label: "Realistic cinematic" },
  { id: "naturalistic", label: "Naturalistic" },
  { id: "period", label: "Period drama" },
  { id: "stylized", label: "Stylized" },
] as const;

export type VisualStyle = (typeof VISUAL_STYLES)[number]["id"];

export const ASPECT_RATIOS = [
  { id: "16:9", label: "Landscape 16:9" },
  { id: "9:16", label: "Portrait 9:16" },
  { id: "1:1", label: "Square 1:1" },
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number]["id"];

export const DURATION_OPTIONS = [
  { seconds: 60, label: "1 minute" },
  { seconds: 120, label: "2 minutes" },
  { seconds: 180, label: "3 minutes" },
] as const;

export const WORKFLOW_MODES = ["guided", "automatic"] as const;
export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  planning: "Planning",
  story_ready: "Story ready",
  characters_ready: "Characters ready",
  scenes_ready: "Scenes ready",
  generating: "Generating",
  rendering: "Rendering",
  completed: "Completed",
  failed: "Failed",
  archived: "Archived",
};

export const BUSY_STATUSES = ["planning", "generating", "rendering"] as const;

export function isBusyStatus(status: ProjectStatus): boolean {
  return (BUSY_STATUSES as readonly string[]).includes(status);
}
