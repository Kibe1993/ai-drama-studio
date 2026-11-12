import OpenAI from "openai";
import { chatJson } from "@/lib/providers/llm/chat";
import { ClassifiedProviderError } from "@/lib/providers/llm/errors";
import { requestCharacters, requestScenes, type StageTransport } from "@/lib/providers/llm/stageTasks";
import type { LLMProvider } from "@/lib/providers/llm/types";
import { jsonSchemaFormat } from "@/lib/providers/llm/schemaFormat";

type ChatStageOptions = {
  label: string;
  apiKey: string | undefined;
  baseURL?: string;
  model: string;
  headers?: Record<string, string>;
  extra?: Record<string, unknown>;
  schemaMode: "json_object" | "json_schema";
  strictSchema?: boolean;
  recoverRejected?: boolean;
};

export function bindChatStages(options: ChatStageOptions): Pick<LLMProvider, "generateCharacters" | "generateScenes"> {
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
  };
}
