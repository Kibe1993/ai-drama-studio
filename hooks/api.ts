export type ApiErrorFinding = {
  category: string;
  severity: string;
  sceneNumber?: number;
  message: string;
  code?: string;
  evidence?: string;
};

export class ApiError extends Error {
  readonly findings?: ApiErrorFinding[];
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    findings?: ApiErrorFinding[]
  ) {
    super(message);
    if (findings) this.findings = findings;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; message?: string; findings?: ApiErrorFinding[] };
  } | null;
  if (!response.ok) {
    throw new ApiError(
      body?.error?.message ?? "Request failed",
      response.status,
      body?.error?.code ?? "request_failed",
      body?.error?.findings
    );
  }
  return body?.data as T;
}
