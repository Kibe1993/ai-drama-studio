export class StudioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/mongodb(\+srv)?:\/\/\S+/gi, "[redacted]").slice(0, 400);
}

export function jsonData<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof StudioError) {
    return errorResponse(error.status, error.code, error.message);
  }
  if (error instanceof Error && error.message === "invalid_cursor") {
    return errorResponse(400, "invalid_cursor", "That page cursor is not valid");
  }
  console.error(safeErrorMessage(error));
  return errorResponse(500, "internal", "Something went wrong");
}
