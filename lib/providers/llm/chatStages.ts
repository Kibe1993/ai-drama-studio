import OpenAI from "openai";
import { chatJson } from "@/lib/providers/llm/chat";
import { ClassifiedProviderError } from "@/lib/providers/llm/errors";
import { requestCharacters, requestScenes, type StageTransport } from "@/lib/providers/llm/stageTasks";
import type { LLMProvider } from "@/lib/providers/llm/types";
import { jsonSchemaFormat } from "@/lib/providers/llm/schemaFormat";
import { requestStoryBible, type StoryBibleTaskInput } from "@/lib/providers/llm/storyBibleTask";

type ChatStageOptions = {
  label: string;
  apiKey: string | undefined;
  baseURL?: string;
  model: string;
  headers?: Record<string, string>;
  extra?: Record<string, unknown>;
  schemaMode: "json_object" | "json_schema";
  strictSchema?: boolean;
  storyBibleSchemaMode?: "json_object" | "json_schema";
  storyBibleStrictSchema?: boolean;
  storyBibleExtra?: Record<string, unknown>;
  storyBibleMaxCompletionTokens?: number | ((input: StoryBibleTaskInput) => number | undefined);
  storyBibleTimeoutMs?: number;
  recoverRejected?: boolean;
};

const SECTION_COMPLETION_TOKENS: Record<NonNullable<StoryBibleTaskInput["section"]>, number> = {
  identity: 4_000,
  world: 6_000,
  characters: 8_000,
  narrative: 6_000,
  guidelines: 4_000,
  canon: 6_000,
};

export function storyBibleCompletionBudget(input: StoryBibleTaskInput, completeBudget: number): number {
  if (input.mode !== "section" || !input.section) return completeBudget;
  return SECTION_COMPLETION_TOKENS[input.section];
}

export function storyBibleResponseFormat(
  options: Pick<ChatStageOptions, "label" | "schemaMode" | "strictSchema" | "storyBibleSchemaMode" | "storyBibleStrictSchema">,
  schema: Record<string, unknown>,
  mode: StoryBibleTaskInput["mode"]
): OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"] {
  const schemaMode = options.storyBibleSchemaMode ?? options.schemaMode;
  if (schemaMode === "json_object") return { type: "json_object" };
  const strict = mode === "revise" ? false : options.storyBibleStrictSchema ?? options.strictSchema ?? false;
  return jsonSchemaFormat(options.label.toLowerCase().replace(/[^a-z0-9_]/g, "_"), schema, strict) as OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
}

export function bindChatStages(options: ChatStageOptions): Pick<LLMProvider, "generateCharacters" | "generateScenes" | "generateStoryBible"> {
  const transport = (): StageTransport => ({
    label: options.label,
    async request(system, prompt, schema, signal) {
      if (!options.apiKey) throw new Error(`${options.label.toUpperCase()}_API_KEY is not set.`);
      const responseFormat =
        options.schemaMode === "json_object"
          ? ({ type: "json_object" } as const)
          : jsonSchemaFormat(options.label.toLowerCase(), schema, options.strictSchema ?? false);
      try {
        return await chatJson({
          label: options.label,
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          model: options.model,
          system,
          prompt,
          signal,
          timeoutMs: 90_000,
          headers: options.headers,
          responseFormat: responseFormat as OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"],
          extra: options.extra,
        });
      } catch (error) {
        const failed = options.recoverRejected && error instanceof ClassifiedProviderError ? error.failedGeneration : "";
        if (!failed) throw error;
        return { text: failed };
      }
    },
  });
  return {
    generateCharacters: (input, callOptions) => requestCharacters(transport(), input, callOptions),
    generateScenes: (input, callOptions) => requestScenes(transport(), input, callOptions),
    generateStoryBible: async (input: StoryBibleTaskInput, callOptions) => {
      const maxCompletionTokens = typeof options.storyBibleMaxCompletionTokens === "function"
        ? options.storyBibleMaxCompletionTokens(input)
        : options.storyBibleMaxCompletionTokens;
      const result = await requestStoryBible({
        label: options.label,
        async request(system, prompt, schema, signal) {
          if (!options.apiKey) throw new Error(`${options.label.toUpperCase()}_API_KEY is not set.`);
          const response = await chatJson({
            label: options.label,
            apiKey: options.apiKey,
            baseURL: options.baseURL,
            model: options.model,
            system,
            prompt,
            signal,
            timeoutMs: options.storyBibleTimeoutMs ?? 90_000,
            headers: options.headers,
            responseFormat: storyBibleResponseFormat(options, schema, input.mode),
            extra: { ...options.extra, ...options.storyBibleExtra },
            maxCompletionTokens,
          });
          return response;
        },
      }, input, callOptions);
      return { result: result.result, usage: result.usage };
    },
  };
}
