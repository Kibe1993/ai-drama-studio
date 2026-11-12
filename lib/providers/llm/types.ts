import type { CharacterPrompt, ScenePrompt } from "@/lib/providers/llm/stageTasks";
import type { CharacterProfile, ProductionScene } from "@/lib/validation/productionStages";
import type { GeneratedStory } from "@/lib/validation/story";
import type { StoryBibleTaskInput, StoryBibleTaskResult } from "@/lib/providers/llm/storyBibleTask";

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

export type LLMProvider = {
  readonly id: string;
  readonly model: string;
  generateStory(input: StoryPrompt, options?: StoryCallOptions): Promise<StoryModelResult>;
  generateCharacters(input: CharacterPrompt, options?: StoryCallOptions): Promise<CharacterModelResult>;
  generateScenes(input: ScenePrompt, options?: StoryCallOptions): Promise<SceneModelResult>;
  generateStoryBible?(input: StoryBibleTaskInput, options?: StoryCallOptions): Promise<StoryBibleModelResult>;
};

export type { CharacterPrompt, ScenePrompt };

export type LlmCompletionRequest = {
  model: string;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  signal: AbortSignal;
};

export type LlmClient = {
  complete(input: LlmCompletionRequest): Promise<{ text: string; usage?: TokenUsage }>;
};
