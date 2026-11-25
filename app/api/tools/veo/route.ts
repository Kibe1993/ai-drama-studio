import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { veoService } from "@/lib/services/veoService";
import { z } from "zod";

export function GET(request: Request) {
  return logged(request, async () => {
    await readActor();
    const configured = !!process.env.VEO_API_KEY?.trim();
    return jsonData({
      configured,
      models: ["veo-3.0-generate-preview", "veo-2.0-generate-001"],
      pricing: {
        "veo-3.0-generate-preview": "$0.50/second",
        "veo-2.0-generate-001": "$0.25/second",
      },
    });
  });
}

export function POST(request: Request) {
  return logged(request, async () => {
    const actor = await readActor();
    const parsed = z.object({
      action: z.enum(["generate", "poll", "cancel"]),
      params: z.record(z.unknown()).default({}),
      operationId: z.string().optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const { action, params, operationId } = parsed.data;
    switch (action) {
      case "generate":
        return jsonData(await veoService.generate(actor.userId, params as { prompt: { subject: string; environment: string; style: string; lighting: string; camera: string; composition: string; continuityNotes: string; motion: string; cameraMovement: string; durationSeconds: number; segmentNote: string }; aspectRatio: string; durationSeconds: number; model?: string }));
      case "poll":
        return jsonData(await veoService.poll(actor.userId, operationId ?? ""));
      case "cancel":
        return jsonData(await veoService.cancel(actor.userId, operationId ?? ""));
      default:
        return errorResponse(400, "invalid_action", "Unknown action");
    }
  });
}