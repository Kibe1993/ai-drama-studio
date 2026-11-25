import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { audioLipsyncService } from "@/lib/services/audioLipsyncService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    return jsonData(await audioLipsyncService.listTools(actor.userId));
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = z.object({
      action: z.enum(["lipsync", "edit_audio", "poll"]),
      toolType: z.enum(["audacity", "wav2lip", "sadtalker", "kokoro"]).optional(),
      params: z.record(z.unknown()).default({}),
      operationId: z.string().optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const { action, params, operationId } = parsed.data;
    switch (action) {
      case "lipsync":
        return jsonData(await audioLipsyncService.generateLipSync(actor.userId, params as { faceImage: string; audioFile: string; outputPath: string; tool: "wav2lip" | "sadtalker" }));
      case "edit_audio":
        return jsonData(await audioLipsyncService.editAudio(actor.userId, params as { inputFile: string; outputFile: string; operations: Array<{ type: "normalize" | "amplify" | "noise_reduction" | "fade_in" | "fade_out" | "trim" | "compress"; params?: Record<string, unknown> }> }));
      case "poll":
        return jsonData(await audioLipsyncService.pollRender(actor.userId, parsed.data.toolType ?? "wav2lip", operationId ?? ""));
      default:
        return errorResponse(400, "invalid_action", "Unknown action");
    }
  });
}