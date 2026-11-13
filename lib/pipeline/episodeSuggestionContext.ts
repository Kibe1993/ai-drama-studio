import type { ProjectRecord } from "@/lib/repositories/projectRepository";
import { storyBibleBrief } from "@/lib/providers/llm/storyBibleSections";
import type { StoryBibleRecord } from "@/lib/validation/storyBible";

/**
 * The reference an episode suggestion is written from: a compact projection of
 * the current bible draft, the legacy five fields, or the project's original
 * story idea. Returns null when there is nothing to base an episode on.
 *
 * The Season Plan, episode plan, and Continuity Ledger are supplied separately
 * by `casnaContext`, so there is a single derivation path for serialized shows.
 */
export function episodeSuggestionReference(project: ProjectRecord, bible: StoryBibleRecord | null): unknown {
  if (bible?.content) return storyBibleBrief(bible.content);
  if (bible && (bible.premise.trim() || bible.canonFacts.length)) {
    return {
      premise: bible.premise,
      worldRules: bible.worldRules.slice(0, 8),
      themes: bible.themes.slice(0, 8),
      boundaries: bible.boundaries.slice(0, 8),
      canonFacts: bible.canonFacts.slice(0, 10),
    };
  }
  return project.originalStoryIdea.trim() ? { storyIdea: project.originalStoryIdea } : null;
}
