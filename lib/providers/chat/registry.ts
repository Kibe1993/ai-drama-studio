import "server-only";
import type { ChatAgentProvider, ChatAgentId, ChatAgentProviderInfo } from "@/lib/assistant/types";
import { GeminiChatProvider } from "./geminiChatProvider";
import { OpenAIChatProvider } from "./openaiChatProvider";
import { DeepSeekChatProvider } from "./deepSeekChatProvider";
import { GroqChatProvider } from "./groqChatProvider";

const providers: Record<ChatAgentId, ChatAgentProvider> = {
  gemini: new GeminiChatProvider(),
  groq: new GroqChatProvider(),
  openai: new OpenAIChatProvider(),
  deepseek: new DeepSeekChatProvider(),
};

const PROVIDER_ORDER: ChatAgentId[] = ["groq", "gemini", "openai", "deepseek"];

export function getChatAgentProvider(id: string): ChatAgentProvider | undefined {
  return providers[id as ChatAgentId];
}

export function listChatAgentProviders(): ChatAgentProviderInfo[] {
  return PROVIDER_ORDER.map((id) => {
    const p = providers[id];
    return {
      id: p.id,
      displayName: p.displayName,
      configured: p.configured,
      freeTier: p.freeTier,
      defaultModel: p.defaultModel,
      models: p.models,
      docsUrl: p.docsUrl,
      apiKeyEnvVar: p.apiKeyEnvVar,
    };
  });
}