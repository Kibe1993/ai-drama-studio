import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { animationService } from "@/lib/services/animationService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    return jsonData(await animationService.listTools(actor.userId));
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = z.object({
      action: z.enum(["export", "import", "render", "poll"]),
      toolType: z.enum(["synfig", "opentoonz", "pencil2d", "blender"]),
      projectId: z.string().optional(),
      assetIds: z.array(z.string()).optional(),
      format: z.string().optional(),
      outputPath: z.string().optional(),
      filePath: z.string().optional(),
      projectFile: z.string().optional(),
      operationId: z.string().optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const { action, toolType, ...rest } = parsed.data;
    switch (action) {
      case "export":
        return jsonData(await animationService.exportToTool(actor.userId, toolType, {
          projectId: rest.projectId ?? "",
          assetIds: rest.assetIds ?? [],
          format: rest.format ?? "png",
          outputPath: rest.outputPath ?? `export_${toolType}_${Date.now()}`,
        }));
      case "import":
        return jsonData(await animationService.importFromTool(actor.userId, toolType, rest.filePath ?? ""));
      case "render":
        return jsonData(await animationService.render(actor.userId, toolType, {
          projectFile: rest.projectFile ?? "",
          outputPath: rest.outputPath,
        }));
      case "poll":
        return jsonData(await animationService.pollRender(actor.userId, toolType, rest.operationId ?? ""));
      default:
        return errorResponse(400, "invalid_action", "Unknown action");
    }
  });
}