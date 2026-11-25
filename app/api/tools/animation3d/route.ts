import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { animation3DService } from "@/lib/services/animation3DService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const [tools, animations] = await Promise.all([
      animation3DService.listTools(actor.userId),
      animation3DService.listMixamoAnimations(),
    ]);
    return jsonData({ tools, animations });
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = z.object({
      action: z.enum(["generate_model", "import_rig", "render", "poll"]),
      toolType: z.enum(["blender", "makehuman", "mixamo"]).optional(),
      params: z.record(z.unknown()).default({}),
      filePath: z.string().optional(),
      operationId: z.string().optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const { action, params, filePath, operationId } = parsed.data;
    switch (action) {
      case "generate_model":
        return jsonData(await animation3DService.generateCharacterModel(actor.userId, params as { outputPath: string } & Record<string, unknown>));
      case "import_rig":
        return jsonData(await animation3DService.importRig(actor.userId, filePath ?? ""));
      case "render":
        return jsonData(await animation3DService.renderAnimation(actor.userId, params as { projectFile: string; outputPath?: string }));
      case "poll":
        return jsonData(await animation3DService.pollRender(actor.userId, parsed.data.toolType ?? "blender", operationId ?? ""));
      default:
        return errorResponse(400, "invalid_action", "Unknown action");
    }
  });
}