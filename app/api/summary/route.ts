import { readActor } from "@/lib/http/request";
import { jsonData, toErrorResponse } from "@/lib/http/errors";
import { projectService } from "@/lib/services/projectService";

export async function GET() {
  try {
    const actor = await readActor();
    const summary = await projectService.summary(actor);
    return jsonData(summary);
  } catch (error) {
    return toErrorResponse(error);
  }
}
