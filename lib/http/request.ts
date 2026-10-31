import "server-only";
import { getRequestAuth } from "@/lib/auth/session";
import { StudioError } from "@/lib/http/errors";

export async function readActor() {
  const actor = await getRequestAuth();
  if (!actor) {
    throw new StudioError("Sign in to continue", 401, "unauthorized");
  }
  return actor;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new StudioError("The request body must be JSON", 400, "invalid_json");
  }
}
