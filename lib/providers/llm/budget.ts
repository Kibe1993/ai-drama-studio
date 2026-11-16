/**
 * Output budgets derived from the requested episode duration.
 *
 * Every provider used to cap generated output at a single fixed ceiling
 * (8000 completion tokens, or 8192 Ollama context), which is below what a
 * complete multi-scene three-act screenplay needs. A long episode was
 * therefore truncated after its opening scene. These helpers scale the
 * ceiling with the work so the prompt can actually deliver what it asks for.
 *
 * They also back the pacing rules: the same duration must yield a comparable
 * number of scenes in the prompt guidance and in validation.
 */

export type SceneRange = { min: number; max: number };

/**
 * Scene count used by both the prompt and validation.
 * An explicit episode policy wins. Otherwise the duration formula applies.
 */
export function resolveSceneRange(
  targetDurationSeconds: number,
  sceneRange?: SceneRange | null,
): SceneRange {
  const fallback = storySceneRange(targetDurationSeconds);
  if (!sceneRange) return fallback;
  const min = Math.min(40, Math.max(1, Math.trunc(sceneRange.min)));
  const max = Math.min(40, Math.max(min, Math.trunc(sceneRange.max)));
  return { min, max };
}

/** The scene count a duration should produce. Shared by the prompt and validation. */
export function storySceneRange(targetDurationSeconds: number): { min: number; max: number } {
  const minutes = targetDurationSeconds / 60;
  if (minutes <= 1) return { min: 1, max: 4 };
  if (minutes <= 3) return { min: 3, max: 6 };
  if (minutes <= 5) return { min: 6, max: 8 };
  if (minutes <= 10) return { min: 8, max: 15 };
  return { min: 12, max: 24 };
}

/**
 * Minimum scenes a duration must contain for the screenplay to count as
 * complete. Below the floor the generation is treated as incomplete and the
 * provider sequence fails over instead of saving a partial episode.
 */
export function minimumScenesForDuration(targetDurationSeconds: number): number {
  return storySceneRange(targetDurationSeconds).min;
}

const MIN_COMPLETION_BUDGET = 8_000;
const MAX_COMPLETION_BUDGET = 32_000;
const OVERHEAD_TOKENS = 2_000;
const STORY_TOKENS_PER_SCENE = 1_400;
const STAGE_TOKENS_PER_SCENE = 1_200;

function clampBudget(budget: number): number {
  return Math.min(MAX_COMPLETION_BUDGET, Math.max(MIN_COMPLETION_BUDGET, Math.round(budget)));
}

/** Completion-token ceiling for the screenplay stage, sized to the episode. */
export function storyCompletionBudget(targetDurationSeconds: number): number {
  const scenes = storySceneRange(targetDurationSeconds).max;
  return clampBudget(scenes * STORY_TOKENS_PER_SCENE + OVERHEAD_TOKENS);
}

/**
 * Completion-token ceiling for a stage that echoes a scene list back
 * (character extraction, scene breakdown). Sizes to the screenplay length so a
 * long screenplay is not truncated while its scenes are transcribed.
 */
export function stageCompletionBudget(sceneCount: number): number {
  return clampBudget(sceneCount * STAGE_TOKENS_PER_SCENE + OVERHEAD_TOKENS);
}
