export type StudioErrorFinding = {
  category: string;
  severity: string;
  sceneNumber?: number;
  message: string;
  code?: string;
  evidence?: string;
};

export class StudioError extends Error {
  readonly findings?: StudioErrorFinding[];
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    findings?: StudioErrorFinding[]
  ) {
    super(message);
    if (findings) this.findings = findings;
  }
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/mongodb(\+srv)?:\/\/\S+/gi, "[redacted]").slice(0, 400);
}

export function jsonData<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  findings?: StudioErrorFinding[]
): Response {
  return Response.json({ error: { code, message, findings } }, { status });
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof StudioError) {
    return errorResponse(error.status, error.code, error.message, error.findings);
  }
  if (error instanceof Error && error.message === "invalid_cursor") {
    return errorResponse(400, "invalid_cursor", "That page cursor is not valid");
  }
  console.error(safeErrorMessage(error));
  return errorResponse(500, "internal", "Something went wrong");
}
