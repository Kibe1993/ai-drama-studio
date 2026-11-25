import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { lottieService } from "@/lib/services/lottieService";
import { z } from "zod";

export function POST(request: Request) {
  return logged(request, async () => {
    await readActor();
    const parsed = z.object({
      action: z.enum(["validate_lottie", "validate_svg", "generate_template", "svg_to_lottie"]),
      params: z.record(z.unknown()),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    const { action, params } = parsed.data;
    switch (action) {
      case "validate_lottie":
        return jsonData(await lottieService.validateLottie(params.filePath as string));
      case "validate_svg":
        return jsonData(await lottieService.validateSvg(params.filePath as string));
      case "generate_template":
        return jsonData(await lottieService.generateRemotionTemplate(params as { lottiePath: string; outputPath: string; compositionId: string; width?: number; height?: number }));
      case "svg_to_lottie":
        return jsonData(await lottieService.convertSvgToLottie(params.svgPath as string, params.outputPath as string));
      default:
        return errorResponse(400, "invalid_action", "Unknown action");
    }
  });
}