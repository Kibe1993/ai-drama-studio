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
  { id: "science_fiction", label: "Science fiction" },
  { id: "fantasy", label: "Fantasy" },
  { id: "mystery", label: "Mystery" },
  { id: "historical", label: "Historical" },
  { id: "human_interest", label: "Human interest" },
  { id: "philosophical", label: "Philosophical" },
  { id: "documentary", label: "Documentary" },
  { id: "educational", label: "Educational" },
  { id: "satire", label: "Satire" },
  { id: "animation", label: "Animation style" },
] as const;

export type Genre = (typeof GENRES)[number]["id"];

// Keep production identity separate from genre and queue workflow mode.
export const PRODUCTION_TYPES = [
  {
    id: "fictional_drama",
    label: "Fictional drama series",
    description: "Family drama, betrayal, revenge, relationships, poverty, ambition, sacrifice, friendship, and moral dilemmas.",
    example: "A family discovers that its inheritance is tied to a terrible secret.",
  },
  {
    id: "science_fiction_fantasy",
    label: "Science fiction and fantasy",
    description: "Artificial intelligence, future civilizations, parallel worlds, supernatural beings, time travel, magical kingdoms, and dystopian societies.",
    example: "A machine begins remembering lives that it never lived.",
  },
  {
    id: "mystery_crime_thriller",
    label: "Mystery, crime, and psychological thrillers",
    description: "Investigations, disappearances, serial mysteries, deception, psychological tension, and unexpected revelations.",
    example: "A detective investigates a murder in which every witness remembers a different victim.",
  },
  {
    id: "historical_stories",
    label: "Historical stories",
    description: "Ancient civilizations, historical conflicts, kings, explorers, ordinary people during major events, and fictional stories set in historical periods.",
    example: "The final days of a fictional kingdom before its collapse.",
  },
  {
    id: "romance_human_interest",
    label: "Romance and human-interest stories",
    description: "Love, heartbreak, difficult decisions, personal transformation, relationships, and stories about ordinary people.",
    example: "Two strangers meet every year without knowing they share the same past.",
  },
  {
    id: "documentary_educational",
    label: "Documentary-style and educational content",
    description: "Historical explainers, scientific concepts, biographies, social issues, nature stories, and visual educational narratives. Factual claims require research and verification.",
    example: "A visual explanation of how ancient civilizations built their cities.",
  },
  {
    id: "philosophical",
    label: "Philosophical and thought-provoking content",
    description: "Existence, consciousness, death, time, religion, suffering, human behaviour, and the meaning of life.",
    example: "A fictional conversation between a human being and an intelligence that has never experienced death.",
  },
  {
    id: "comedy_satire_animation",
    label: "Comedy, satire, and animation-style stories",
    description: "Social satire, workplace comedy, fictional characters, exaggerated situations, short sketches, and animated-looking productions.",
    example: "An exaggerated workplace sketch about an office where every rule changes daily.",
  },
] as const;
export type ProductionType = (typeof PRODUCTION_TYPES)[number]["id"];

export const PRODUCTION_MODES = [
  { id: "standalone", label: "Standalone" },
  { id: "serialized", label: "Serialized" },
  { id: "anthology", label: "Anthology" },
] as const;
export type ProductionMode = (typeof PRODUCTION_MODES)[number]["id"];

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
  { seconds: 300, label: "5 minutes" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 900, label: "15 minutes" },
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
