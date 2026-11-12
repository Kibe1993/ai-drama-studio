import "server-only";
import { StudioError, toErrorResponse } from "@/lib/http/errors";
import { log } from "@/lib/log";

export async function logged(request: Request, run: () => Promise<Response>): Promise<Response> {
  const started = Date.now();
  const path = new URL(request.url).pathname;
  const label = `${request.method} ${path}`;
  log.info("api", label);
  try {
    const response = await run();
    log.info("api", `${label} -> ${response.status}`, { ms: Date.now() - started });
    return response;
  } catch (error) {
    const response = toErrorResponse(error);
    log.error("api", `${label} -> ${response.status}`, {
      ms: Date.now() - started,
      code: error instanceof StudioError ? error.code : "internal",
    });
    return response;
  }
}
