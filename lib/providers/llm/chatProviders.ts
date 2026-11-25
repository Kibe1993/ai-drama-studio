import "server-only";

export type ChatProviderInfo = {
  id: string;
  displayName: string;
  baseURL: string;
  apiKeyEnvVar: string;
  defaultModel: string;
  freeTier: boolean;
  freeTierDescription: string;
  openAICompatible: boolean;
  models: string[];
  docsUrl: string;
  specialAuth?: "github_copilot";
};

export const CHAT_PROVIDERS: ChatProviderInfo[] = [
  {
    id: "cerebras",
    displayName: "Cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    apiKeyEnvVar: "CEREBRAS_API_KEY",
    defaultModel: "llama-4-scout-17b-16bit",
    freeTier: true,
    freeTierDescription: "Free tier with fast inference. Llama 4 Scout 17B available at no cost.",
    openAICompatible: true,
    models: [
      "llama-4-scout-17b-16bit",
      "llama-4-scout-17b",
      "llama3.1-8b",
      "llama3.1-70b",
    ],
    docsUrl: "https://docs.cerebras.ai",
  },
  {
    id: "sambanova",
    displayName: "SambaNova",
    baseURL: "https://api.sambanova.ai/v1",
    apiKeyEnvVar: "SAMBANOVA_API_KEY",
    defaultModel: "Meta-Llama-3.1-8B-Instruct",
    freeTier: true,
    freeTierDescription: "Free SambaNova Cloud API. Multiple Llama models available at no cost.",
    openAICompatible: true,
    models: [
      "Meta-Llama-3.1-8B-Instruct",
      "Meta-Llama-3.1-70B-Instruct",
      "Meta-Llama-3.2-3B-Instruct",
      "Meta-Llama-3.2-1B-Instruct",
    ],
    docsUrl: "https://docs.sambanova.ai/cloud/docs/get-started/supported-models",
  },
  {
    id: "together",
    displayName: "Together AI",
    baseURL: "https://api.together.xyz/v1",
    apiKeyEnvVar: "TOGETHER_API_KEY",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
    freeTier: true,
    freeTierDescription: "$5 free credits on signup. Free-tier models available with rate limits.",
    openAICompatible: true,
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
      "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      "Qwen/Qwen2.5-7B-Instruct-Turbo",
    ],
    docsUrl: "https://docs.together.ai",
  },
  {
    id: "fireworks",
    displayName: "Fireworks AI",
    baseURL: "https://api.fireworks.ai/inference/v1",
    apiKeyEnvVar: "FIREWORKS_API_KEY",
    defaultModel: "accounts/fireworks/models/llama-v3p1-8b-instruct",
    freeTier: true,
    freeTierDescription: "Free tier with rate limits. Llama 3.1 8B available at no cost.",
    openAICompatible: true,
    models: [
      "accounts/fireworks/models/llama-v3p1-8b-instruct",
      "accounts/fireworks/models/llama-v3p1-70b-instruct",
      "accounts/fireworks/models/mixtral-8x7b-instruct",
      "accounts/fireworks/models/qwen2p5-7b-instruct",
    ],
    docsUrl: "https://docs.fireworks.ai",
  },
  {
    id: "siliconflow",
    displayName: "SiliconFlow",
    baseURL: "https://api.siliconflow.cn/v1",
    apiKeyEnvVar: "SILICONFLOW_API_KEY",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    freeTier: true,
    freeTierDescription: "Free tier with multiple open-source models. Chinese API provider.",
    openAICompatible: true,
    models: [
      "Qwen/Qwen2.5-7B-Instruct",
      "Qwen/Qwen2.5-72B-Instruct",
      "deepseek-ai/DeepSeek-V2-Chat",
      "meta-llama/Meta-Llama-3.1-8B-Instruct",
    ],
    docsUrl: "https://docs.siliconflow.cn",
  },
  {
    id: "glm",
    displayName: "GLM (Zhipu AI)",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnvVar: "GLM_API_KEY",
    defaultModel: "glm-4-flash",
    freeTier: true,
    freeTierDescription: "Free tier with GLM-4-Flash model. Chinese AI provider with generous free limits.",
    openAICompatible: true,
    models: [
      "glm-4-flash",
      "glm-4-flashx",
      "glm-4-air",
      "glm-4-airx",
    ],
    docsUrl: "https://open.bigmodel.cn/dev/api",
  },
  {
    id: "novita",
    displayName: "Novita AI",
    baseURL: "https://api.novita.ai/v3/openai",
    apiKeyEnvVar: "NOVITA_API_KEY",
    defaultModel: "meta-llama/llama-3.1-8b-instruct",
    freeTier: true,
    freeTierDescription: "Free tier with $1 free credits. Multiple open-source models.",
    openAICompatible: true,
    models: [
      "meta-llama/llama-3.1-8b-instruct",
      "meta-llama/llama-3.1-70b-instruct",
      "mistralai/mistral-7b-instruct",
      "qwen/qwen2.5-7b-instruct",
    ],
    docsUrl: "https://novita.ai/docs",
  },
  {
    id: "huggingface",
    displayName: "Hugging Face",
    baseURL: "https://api-inference.huggingface.co/v1",
    apiKeyEnvVar: "HF_API_KEY",
    defaultModel: "meta-llama/Meta-Llama-3.E-8B-Instruct",
    freeTier: true,
    freeTierDescription: "Free Inference API with rate limits. OpenAI-compatible endpoint available.",
    openAICompatible: true,
    models: [
      "meta-llama/Meta-Llama-3E-8B-Instruct",
      "meta-llama/Meta-Llama-3.1-8B-Instruct",
      "mistralai/Mistral-7B-Instruct-v0.3",
      "Qwen/Qwen2.5-7B-Instruct",
    ],
    docsUrl: "https://huggingface.co/docs/api-inference",
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot",
    baseURL: "https://api.githubcopilot.com",
    apiKeyEnvVar: "GITHUB_COPILOT_TOKEN",
    defaultModel: "gpt-4o",
    freeTier: true,
    freeTierDescription: "Free tier: 50 chat messages/month + 2000 code completions/month. Requires GitHub Copilot subscription.",
    openAICompatible: true,
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "claude-3.5-sonnet",
      "o1",
    ],
    docsUrl: "https://docs.github.com/copilot",
    specialAuth: "github_copilot",
  },
  {
    id: "cloudflare",
    displayName: "Cloudflare Workers AI",
    baseURL: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    apiKeyEnvVar: "CLOUDFLARE_API_TOKEN",
    defaultModel: "@cf/meta/llama-3.1-8b-instruct",
    freeTier: true,
    freeTierDescription: "Free tier: 10,000 neurons/day. Runs on Cloudflare edge network.",
    openAICompatible: true,
    models: [
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/meta/llama-3.1-70b-instruct",
      "@cf/mistral/mistral-7b-instruct-v0.1",
      "@cf/qwen/qwen1.5-7b-chat",
    ],
    docsUrl: "https://developers.cloudflare.com/workers-ai",
  },
];

export function getChatProvider(id: string): ChatProviderInfo | undefined {
  return CHAT_PROVIDERS.find((p) => p.id === id);
}

export function isChatProviderConfigured(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const provider = getChatProvider(id);
  if (!provider) return false;
  return Boolean(env[provider.apiKeyEnvVar]?.trim());
}

export function listConfiguredChatProviders(env: NodeJS.ProcessEnv = process.env): ChatProviderInfo[] {
  return CHAT_PROVIDERS.filter((p) => isChatProviderConfigured(p.id, env));
}

export function resolveBaseURL(provider: ChatProviderInfo, env: NodeJS.ProcessEnv = process.env): string {
  return provider.baseURL.replace("${CLOUDFLARE_ACCOUNT_ID}", env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "");
}