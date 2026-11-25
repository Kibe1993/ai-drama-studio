import "server-only";
import OpenAI from "openai";
import { StudioError } from "@/lib/http/errors";
import {
  CHAT_PROVIDERS,
  getChatProvider,
  isChatProviderConfigured,
  resolveBaseURL,
  type ChatProviderInfo,
} from "@/lib/providers/llm/chatProviders";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionParams = {
  provider: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
};

export type ChatCompletionResult = {
  provider: string;
  model: string;
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
};

async function getApiKey(provider: ChatProviderInfo, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const key = env[provider.apiKeyEnvVar]?.trim();
  if (!key) {
    throw new StudioError(
      `${provider.displayName} API key not configured. Set ${provider.apiKeyEnvVar}.`,
      503,
      "provider_not_configured",
    );
  }

  if (provider.specialAuth === "github_copilot") {
    return resolveCopilotToken(key, env);
  }

  return key;
}

async function resolveCopilotToken(githubToken: string, env: NodeJS.ProcessEnv): Promise<string> {
  const cached = copilotTokenCache.get(githubToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      "Authorization": `Bearer ${githubToken}`,
      "Accept": "application/json",
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot-chat/0.1.0",
    },
  });

  if (!response.ok) {
    throw new StudioError(
      `Failed to get Copilot token: ${response.status}`,
      503,
      "copilot_auth_failed",
    );
  }

  const data = (await response.json()) as { token: string; expires_at: number };
  const token = data.token;
  const expiresAt = data.expires_at * 1000;
  copilotTokenCache.set(githubToken, { token, expiresAt });
  return token;
}

const copilotTokenCache = new Map<string, { token: string; expiresAt: number }>();

function buildHeaders(provider: ChatProviderInfo): Record<string, string> {
  if (provider.specialAuth === "github_copilot") {
    return {
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot-chat/0.1.0",
      "Copilot-Integration-Id": "vscode-chat",
    };
  }
  return {};
}

export const chatService = {
  listProviders(env: NodeJS.ProcessEnv = process.env) {
    return CHAT_PROVIDERS.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      defaultModel: p.defaultModel,
      freeTier: p.freeTier,
      freeTierDescription: p.freeTierDescription,
      models: p.models,
      docsUrl: p.docsUrl,
      configured: isChatProviderConfigured(p.id, env),
      openAICompatible: p.openAICompatible,
    }));
  },

  getProvider(id: string, env: NodeJS.ProcessEnv = process.env) {
    const provider = getChatProvider(id);
    if (!provider) throw new StudioError(`Unknown provider: ${id}`, 404, "provider_not_found");
    return {
      id: provider.id,
      displayName: provider.displayName,
      defaultModel: provider.defaultModel,
      freeTier: provider.freeTier,
      freeTierDescription: provider.freeTierDescription,
      models: provider.models,
      docsUrl: provider.docsUrl,
      configured: isChatProviderConfigured(provider.id, env),
      openAICompatible: provider.openAICompatible,
    };
  },

  async complete(params: ChatCompletionParams, env: NodeJS.ProcessEnv = process.env): Promise<ChatCompletionResult> {
    const provider = getChatProvider(params.provider);
    if (!provider) {
      throw new StudioError(`Unknown provider: ${params.provider}`, 400, "provider_not_found");
    }

    const apiKey = await getApiKey(provider, env);
    const model = params.model ?? provider.defaultModel;
    const baseURL = resolveBaseURL(provider, env);

    const client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: buildHeaders(provider),
      maxRetries: 1,
      timeout: 60_000,
    });

    try {
      const completion = await client.chat.completions.create({
        model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
      });

      const content = completion.choices[0]?.message?.content ?? "";
      const finishReason = completion.choices[0]?.finish_reason ?? "";

      return {
        provider: provider.id,
        model,
        content,
        finishReason,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Chat completion failed";
      if (message.includes("401") || message.includes("authentication")) {
        throw new StudioError(message, 401, "authentication_error");
      }
      if (message.includes("429") || message.includes("rate_limit")) {
        throw new StudioError(message, 429, "rate_limited");
      }
      if (message.includes("404") || message.includes("model_not_found")) {
        throw new StudioError(message, 404, "model_not_found");
      }
      throw new StudioError(message, 500, "chat_completion_failed");
    }
  },
};