import type { CharacterPrompt, EpisodeSuggestionPrompt, ScenePrompt, SeasonPlanPrompt } from "@/lib/providers/llm/stageTasks";
import type { RepairScenesPrompt } from "@/lib/providers/llm/repairScenes";
import type { StoryCriticFinding, StoryCriticPrompt } from "@/lib/providers/llm/storyCritic";
import type { CharacterProfile, ProductionScene } from "@/lib/validation/productionStages";
import type { EpisodeSuggestion } from "@/lib/validation/episode";
import type { GeneratedStory, ScreenplayScene } from "@/lib/validation/story";
import type { StoryBibleTaskInput, StoryBibleTaskResult } from "@/lib/providers/llm/storyBibleTask";
import type { SeasonPlan } from "@/lib/validation/seasonPlan";

export type StoryPrompt = {
  title: string;
  idea: string;
  genre: string;
  language: string;
  visualStyle: string;
  tone: string;
  targetDurationSeconds: number;
  aspectRatio: string;
  productionType?: string;
  continuityContext?: string;
  /** CASNA Stage G: the approved Season Plan for this series. */
  seasonPlan?: unknown | null;
  /** CASNA Stage F/G: the episode-specific plan this screenplay must follow. */
  episodePlan?: unknown | null;
  /** CASNA Stage G: established canon from approved episodes. */
  continuityLedger?: unknown | null;
  /** CASNA Stage E/G: the immediately preceding approved episode. */
  previousEpisode?: { episodeNumber: number; title: string; synopsis: string } | null;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type AttemptRecord = {
  provider: string;
  model: string;
  durationMs: number;
  success: boolean;
  category: string;
  httpStatus: number | null;
  inputTokens?: number;
  outputTokens?: number;
  fallback: boolean;
};

export type StoryModelResult = GeneratedStory & {
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  attempts?: AttemptRecord[];
  usage?: TokenUsage;
  /**
   * The provider reported that it stopped at its output ceiling, so the
   * screenplay it returned is not necessarily complete. This is the
   * finish-reason signal, independent of the JSON shape.
   */
  truncated?: boolean;
};

export type StoryContinuationModelResult = {
  screenplay: ScreenplayScene[];
  usage?: TokenUsage;
  truncated?: boolean;
};

export type StoryCallOptions = {
  signal?: AbortSignal;
  runId?: string;
  jobId?: string;
  onStatus?: (message: string) => void | Promise<void>;
  sequenceTimeoutMs?: number;
};

export type CharacterModelResult = {
  characters: CharacterProfile[];
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  attempts?: AttemptRecord[];
  usage?: TokenUsage;
};

export type SceneModelResult = {
  scenes: ProductionScene[];
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  attempts?: AttemptRecord[];
  usage?: TokenUsage;
};

export type StoryBibleModelResult = {
  result: StoryBibleTaskResult;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  attempts?: AttemptRecord[];
  usage?: TokenUsage;
};

export type EpisodeSuggestionModelResult = {
  suggestion: EpisodeSuggestion;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  attempts?: AttemptRecord[];
  usage?: TokenUsage;
};

export type SeasonPlanModelResult = {
  plan: SeasonPlan;
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  attempts?: AttemptRecord[];
  usage?: TokenUsage;
};

export type RepairScenesModelResult = {
  screenplay: ScreenplayScene[];
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  attempts?: AttemptRecord[];
  usage?: TokenUsage;
};

export type StoryCritiqueModelResult = {
  findings: StoryCriticFinding[];
  provider?: string;
  model?: string;
  fallbackFrom?: string | null;
  attempts?: AttemptRecord[];
  usage?: TokenUsage;
};

export type LLMProvider = {
  readonly id: string;
  readonly model: string;
  generateStory(input: StoryPrompt, options?: StoryCallOptions): Promise<StoryModelResult>;
  generateCharacters(input: CharacterPrompt, options?: StoryCallOptions): Promise<CharacterModelResult>;
  generateScenes(input: ScenePrompt, options?: StoryCallOptions): Promise<SceneModelResult>;
  generateStoryBible?(input: StoryBibleTaskInput, options?: StoryCallOptions): Promise<StoryBibleModelResult>;
  generateEpisodeSuggestion?(input: EpisodeSuggestionPrompt, options?: StoryCallOptions): Promise<EpisodeSuggestionModelResult>;
  generateSeasonPlan?(input: SeasonPlanPrompt, options?: StoryCallOptions): Promise<SeasonPlanModelResult>;
  /** CASNA Stage H: rewrite only the scenes a validation finding points at. */
  repairScenes?(input: RepairScenesPrompt, options?: StoryCallOptions): Promise<RepairScenesModelResult>;
  /** CASNA Stage H: optional advisory continuity critique. */
  critiqueStory?(input: StoryCriticPrompt, options?: StoryCallOptions): Promise<StoryCritiqueModelResult>;
  /**
   * Extend a screenplay that stopped short by asking the same provider for the
   * scenes that follow the ones already written. Optional: a provider that
   * cannot continue simply fails over instead.
   */
  continueStory?(
    input: StoryPrompt,
    written: ScreenplayScene[],
    options?: StoryCallOptions
  ): Promise<StoryContinuationModelResult>;
};

export type { CharacterPrompt, EpisodeSuggestionPrompt, ScenePrompt, SeasonPlanPrompt };

export type LlmCompletionRequest = {
  model: string;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  signal: AbortSignal;
  maxOutputTokens?: number;
};

export type LlmClient = {
  complete(input: LlmCompletionRequest): Promise<{ text: string; usage?: TokenUsage; truncated?: boolean }>;
};
