import { JobError } from "@/lib/pipeline/types";

export function safeProviderDetail(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/key=[^&\s]+/gi, "key=[redacted]")
    .slice(0, 300);
}

function causeCodeOf(error: unknown): string {
  if (!error || typeof error !== "object" || !("cause" in error)) return "";
  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return "";
  const code = cause.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "";
}

function googleStatusOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(message) as { error?: { status?: unknown } };
    const status = parsed.error?.status;
    return typeof status === "string" && /^[A-Z][A-Z0-9_]{0,40}$/.test(status) ? status : "";
  } catch {
    return "";
  }
}

function isApplicationTimeout(error: unknown): boolean {
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (!error || typeof error !== "object" || !("cause" in error)) return false;
  const cause = error.cause;
  return cause instanceof Error && cause.name === "TimeoutError";
}

export function geminiDiagnostics(error: unknown): {
  name: string;
  httpStatus: number | "";
  googleStatus: string;
  causeCode: string;
  detail: string;
  applicationTimeout: boolean;
} {
  return {
    name: error instanceof Error ? error.name : "Error",
    httpStatus: statusOf(error) ?? "",
    googleStatus: googleStatusOf(error),
    causeCode: causeCodeOf(error),
    detail: safeProviderDetail(error instanceof Error ? error.message : "Gemini request failed"),
    applicationTimeout: isApplicationTimeout(error),
  };
}

export function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { status?: unknown; code?: unknown; cause?: unknown };
  if (typeof record.status === "number") return record.status;
  if (typeof record.code === "number") return record.code;
  if (record.cause) return statusOf(record.cause);
  return null;
}

export class ClassifiedProviderError extends JobError {
  constructor(
    message: string,
    code: string,
    retryable: boolean,
    readonly httpStatus: number | null,
    readonly detail: string,
    readonly failedGeneration = ""
  ) {
    super(message, code, retryable);
  }
}

export function failedGenerationOf(error: unknown): string {
  if (!error || typeof error !== "object" || !("error" in error)) return "";
  const body = error.error;
  if (!body || typeof body !== "object" || !("failed_generation" in body)) return "";
  const value = body.failed_generation;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

export function classifyProviderError(providerName: string, error: unknown): ClassifiedProviderError {
  const status = statusOf(error);
  const raw = error instanceof Error ? error.message : `${providerName} request failed`;
  const detail = safeProviderDetail(raw);
  const failedGeneration = failedGenerationOf(error);
  const named = (message: string, code: string, retryable: boolean) =>
    new ClassifiedProviderError(message, code, retryable, status, detail, failedGeneration);

  if (status === 400) {
    return named(`${providerName} rejected the story request. ${detail}`, "invalid_request", false);
  }
  if (status === 401) {
    return named(`${providerName} rejected the API credentials.`, "authentication", false);
  }
  if (status === 403) {
    return named(`${providerName} refused the story request.`, "forbidden", false);
  }
  if (
    status === 402 ||
    /quota|billing|insufficient_quota|payment required|credit balance|exceeded your current quota/i.test(detail)
  ) {
    return named(`${providerName} free quota is exhausted.`, "quota_exhausted", true);
  }
  if (/model.*(not found|does not exist|unsupported|invalid)|unknown model|invalid model/i.test(detail)) {
    return named(`${providerName} does not accept the configured model.`, "invalid_model", false);
  }
  if (status === 429 || /resource_exhausted|rate limit|too many requests/i.test(detail)) {
    return named(`${providerName} rate limit reached. The story will be retried.`, "rate_limited", true);
  }
  if (
    status === 408 ||
    (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) ||
    /timeout|timed out|etimedout|deadline/i.test(detail)
  ) {
    return named(`${providerName} timed out. The story will be retried.`, "timeout", true);
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /econnreset|enotfound|eai_again|network|fetch failed|socket/i.test(detail)
  ) {
    return named(`${providerName} is unavailable. The story will be retried.`, "provider_unavailable", true);
  }
  return named(`${providerName} could not generate the story.`, "provider_failed", false);
}

export function geminiFailure(error: unknown): JobError {
  return classifyProviderError("Gemini", error);
}
