export const PAID_PROVIDER_IDS = ["openai", "anthropic", "deepseek"] as const;

/** Official Gemini pricing lists these input and output prices as "Free of charge". */
export const FREE_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash"] as const;

/**
 * Groq's Free plan is $0 and is for API access. This id is published on Groq's rate-limit page.
 * The published numeric limits on that page are the Developer plan, which bills per token.
 */
export const FREE_GROQ_MODELS = ["openai/gpt-oss-20b"] as const;

/** Official free-mode setup request uses this model id. */
export const FREE_MISTRAL_MODELS = ["mistral-small-latest"] as const;

export const DEFAULT_FREE_MODELS = {
  gemini: "gemini-3.8-flash",
  groq: "openai/gpt-oss-20b",
  openrouter: "openrouter/free",
  mistral: "mistral-small-latest",
} as const;

export function isFreeOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.LLM_FREE_ONLY?.trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

export function openRouterModelIsFree(model: string): boolean {
  return model === "openrouter/free" || model.endsWith(":free");
}

export function freeModelAllowed(provider: string, model: string): boolean {
  if ((PAID_PROVIDER_IDS as readonly string[]).includes(provider)) return false;
  if (provider === "gemini") return (FREE_GEMINI_MODELS as readonly string[]).includes(model);
  if (provider === "groq") return (FREE_GROQ_MODELS as readonly string[]).includes(model);
  if (provider === "openrouter") return openRouterModelIsFree(model);
  if (provider === "mistral") return (FREE_MISTRAL_MODELS as readonly string[]).includes(model);
  return false;
}

export function providerBlockedReason(provider: string, model: string, freeOnly: boolean): string | null {
  if (!freeOnly) return null;
  if ((PAID_PROVIDER_IDS as readonly string[]).includes(provider)) {
    return "Paid providers are disabled while free-only mode is enabled.";
  }
  if (!freeModelAllowed(provider, model)) {
    return "That model is not on the verified free-tier list.";
  }
  return null;
}
