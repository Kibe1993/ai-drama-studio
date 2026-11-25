import "server-only";
import { StudioError } from "@/lib/http/errors";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type LottieMetadata = {
  version: string;
  frameRate: number;
  durationInFrames: number;
  durationSeconds: number;
  width: number;
  height: number;
  name: string;
  hasLayers: boolean;
  layerCount: number;
};

export type SvgMetadata = {
  width: number;
  height: number;
  viewBox: string;
  hasAnimation: boolean;
  elementCount: number;
};

export type RemotionTemplateParams = {
  lottiePath: string;
  outputPath: string;
  compositionId: string;
  width?: number;
  height?: number;
};

function isLottieJson(data: unknown): data is { v: string; fr: number; op: number; w: number; h: number; nm: string; layers: unknown[] } {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.v === "string" && typeof obj.fr === "number" && typeof obj.op === "number" && typeof obj.w === "number" && typeof obj.h === "number" && Array.isArray(obj.layers);
}

export const lottieService = {
  async validateLottie(filePath: string): Promise<LottieMetadata> {
    try {
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content);
      if (!isLottieJson(data)) {
        throw new StudioError("Invalid Lottie JSON: missing required fields (v, fr, op, w, h, layers)", 400, "invalid_lottie");
      }
      return {
        version: data.v,
        frameRate: data.fr,
        durationInFrames: Math.round(data.op),
        durationSeconds: data.op / data.fr,
        width: data.w,
        height: data.h,
        name: data.nm ?? path.basename(filePath, ".json"),
        hasLayers: data.layers.length > 0,
        layerCount: data.layers.length,
      };
    } catch (cause) {
      if (cause instanceof StudioError) throw cause;
      throw new StudioError(
        cause instanceof Error ? cause.message : "Failed to validate Lottie file",
        500,
        "lottie_validation_failed",
      );
    }
  },

  async validateSvg(filePath: string): Promise<SvgMetadata> {
    try {
      const content = await readFile(filePath, "utf-8");
      if (!content.includes("<svg")) {
        throw new StudioError("Invalid SVG: no <svg> root element", 400, "invalid_svg");
      }
      const widthMatch = content.match(/<svg[^>]*\swidth="(\d+)"/);
      const heightMatch = content.match(/<svg[^>]*\sheight="(\d+)"/);
      const viewBoxMatch = content.match(/<svg[^>]*\sviewBox="([^"]+)"/);
      const hasAnimation = /<animate|<animateTransform|<animateMotion|<set[\s>]/.test(content);
      const elementCount = (content.match(/<(?:rect|circle|ellipse|line|polyline|polygon|path|text|g|use|image|defs|linearGradient|radialGradient|filter|mask|clipPath|pattern|symbol|marker)\b/g) ?? []).length;
      return {
        width: widthMatch ? Number(widthMatch[1]) : 0,
        height: heightMatch ? Number(heightMatch[1]) : 0,
        viewBox: viewBoxMatch ? viewBoxMatch[1] : "",
        hasAnimation,
        elementCount,
      };
    } catch (cause) {
      if (cause instanceof StudioError) throw cause;
      throw new StudioError(
        cause instanceof Error ? cause.message : "Failed to validate SVG file",
        500,
        "svg_validation_failed",
      );
    }
  },

  async generateRemotionTemplate(params: RemotionTemplateParams): Promise<{ filePath: string }> {
    try {
      const width = params.width ?? 1920;
      const height = params.height ?? 1080;
      const template = `import { AbsoluteFill } from "remotion";
import { Lottie } from "@remotion/lottie";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import lottieAnimation from "${params.lottiePath.replace(/\\/g, "/")}";

export const ${params.compositionId} = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "white", justifyContent: "center", alignItems: "center" }}>
      <Lottie
        animationData={lottieAnimation}
        style={{ width: ${width}, height: ${height}, opacity }}
      />
    </AbsoluteFill>
  );
};
`;
      const outputDir = path.dirname(params.outputPath);
      await mkdir(outputDir, { recursive: true });
      await writeFile(params.outputPath, template, "utf-8");
      return { filePath: params.outputPath };
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Failed to generate Remotion template",
        500,
        "template_generation_failed",
      );
    }
  },

  async convertSvgToLottie(svgPath: string, outputPath: string): Promise<{ filePath: string; note: string }> {
    try {
      const svgContent = await readFile(svgPath, "utf-8");
      const widthMatch = svgContent.match(/<svg[^>]*\swidth="(\d+)"/);
      const heightMatch = svgContent.match(/<svg[^>]*\sheight="(\d+)"/);
      const width = widthMatch ? Number(widthMatch[1]) : 100;
      const height = heightMatch ? Number(heightMatch[1]) : 100;
      const hasAnimation = /<animate|<animateTransform|<animateMotion/.test(svgContent);
      if (hasAnimation) {
        const note = "SVG contains SMIL animations which cannot be automatically converted to Lottie. Use a tool like LottieFiles SVG-to-Lottie converter or manually recreate the animation in After Effects with Bodymovin.";
        return { filePath: svgPath, note };
      }
      const lottieEquivalent = {
        v: "5.7.4",
        fr: 30,
        ip: 0,
        op: 1,
        w: width,
        h: height,
        nm: path.basename(svgPath, ".svg"),
        layers: [
          {
            ddd: 0,
            ind: 1,
            ty: 2,
            nm: "svg_image",
            refId: "image_0",
            sr: 1,
            ks: {
              o: { a: 0, k: 100 },
              r: { a: 0, k: 0 },
              p: { a: 0, k: [width / 2, height / 2, 0] },
              a: { a: 0, k: [width / 2, height / 2, 0] },
              s: { a: 0, k: [100, 100, 100] },
            },
            ao: 0,
            ip: 0,
            op: 1,
            st: 0,
            bm: 0,
          },
        ],
        assets: [
          {
            id: "image_0",
            w: width,
            h: height,
            u: "",
            p: svgContent,
            e: 1,
          },
        ],
      };
      const outputDir = path.dirname(outputPath);
      await mkdir(outputDir, { recursive: true });
      await writeFile(outputPath, JSON.stringify(lottieEquivalent, null, 2), "utf-8");
      return { filePath: outputPath, note: "Static SVG embedded as Lottie image layer. For animated SVGs, use LottieFiles converter." };
    } catch (cause) {
      throw new StudioError(
        cause instanceof Error ? cause.message : "Failed to convert SVG to Lottie",
        500,
        "svg_to_lottie_failed",
      );
    }
  },
};