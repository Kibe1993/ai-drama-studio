import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ExternalToolProvider,
  ToolConnectionConfig,
  ExecuteParams,
  JobHandle,
  PollResult,
  ToolCapability,
  WorkflowInfo,
} from "./types";
import type { HealthCheckResult } from "@/lib/validation/toolConfig";

const execFileAsync = promisify(execFile);

const REMOTION_CAPABILITIES: ToolCapability = {
  hasApi: false,
  supportsHeadless: true,
  supportsWorkflow: true,
  supportsFileImport: true,
  supportsFileExport: true,
  supportedFileFormats: [".tsx", ".ts", ".jsx", ".js", ".mp4", ".webm"],
};

export type RemotionComposition = {
  id: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
};

export type RemotionRenderParams = {
  entryPoint: string;
  compositionId: string;
  outputPath: string;
  codec?: "h264" | "h265" | "vp8" | "vp9";
  imageFormat?: "jpeg" | "png";
  quality?: number;
  crf?: number;
  props?: Record<string, unknown>;
};

export class RemotionProvider implements ExternalToolProvider {
  readonly id = "remotion";
  readonly toolType = "remotion" as const;
  readonly capabilities = REMOTION_CAPABILITIES;

  private async findNpx(config: ToolConnectionConfig): Promise<string | null> {
    if (config.executablePath) {
      try {
        await access(config.executablePath);
        return config.executablePath;
      } catch {
        return null;
      }
    }
    try {
      await execFileAsync("npx", ["--version"], { timeout: 5000 });
      return "npx";
    } catch {
      return null;
    }
  }

  async healthCheck(config: ToolConnectionConfig): Promise<HealthCheckResult> {
    const start = Date.now();
    const npx = await this.findNpx(config);
    if (!npx) {
      return {
        status: "unhealthy",
        message: "npx not found. Install Node.js to use Remotion.",
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - start,
      };
    }
    const workingDir = config.workingDirectory ?? process.cwd();
    try {
      const pkgJson = await readFile(path.join(workingDir, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const hasRemotion = pkg.dependencies?.remotion || pkg.devDependencies?.remotion;
      if (!hasRemotion) {
        return {
          status: "degraded",
          message: "Remotion not found in package.json. Run: npm i remotion @remotion/cli",
          checkedAt: new Date().toISOString(),
          responseTimeMs: Date.now() - start,
        };
      }
      return {
        status: "healthy",
        message: `Remotion ${hasRemotion} found in ${workingDir}`,
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - start,
      };
    } catch {
      return {
        status: "unhealthy",
        message: `No package.json found in working directory: ${workingDir}`,
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - start,
      };
    }
  }

  async listWorkflows(config: ToolConnectionConfig): Promise<WorkflowInfo[]> {
    const workingDir = config.workingDirectory ?? process.cwd();
    const entryPoint = config.config?.entryPoint as string ?? "src/remotion/index.ts";
    const fullPath = path.resolve(workingDir, entryPoint);
    try {
      await access(fullPath);
      return [{
        id: entryPoint,
        name: path.basename(entryPoint),

        description: `Entry point: ${entryPoint}`,
      }];
    } catch {
      return [];
    }
  }

  async listCompositions(config: ToolConnectionConfig, entryPoint: string): Promise<RemotionComposition[]> {
    const npx = await this.findNpx(config);
    if (!npx) throw new Error("npx not found");
    const workingDir = config.workingDirectory ?? process.cwd();
    const { stdout } = await execFileAsync(npx, [
      "remotion", "compositions", entryPoint, "--json",
    ], { cwd: workingDir, timeout: 30000, maxBuffer: 1024 * 1024 });
    const data = JSON.parse(stdout) as RemotionComposition[];
    return data;
  }

  async execute(config: ToolConnectionConfig, params: ExecuteParams): Promise<JobHandle> {
    const npx = await this.findNpx(config);
    if (!npx) throw new Error("npx not found");
    const workingDir = config.workingDirectory ?? process.cwd();
    const renderParams = params.inputs as RemotionRenderParams;
    if (!renderParams.entryPoint || !renderParams.compositionId || !renderParams.outputPath) {
      throw new Error("entryPoint, compositionId, and outputPath are required");
    }

    const args = [
      "remotion", "render",
      renderParams.entryPoint,
      renderParams.compositionId,
      renderParams.outputPath,
      "--codec", renderParams.codec ?? "h264",
      "--image-format", renderParams.imageFormat ?? "jpeg",
    ];
    if (renderParams.quality !== undefined) args.push("--quality", String(renderParams.quality));
    if (renderParams.crf !== undefined) args.push("--crf", String(renderParams.crf));
    if (renderParams.props) args.push("--props", JSON.stringify(renderParams.props));

    const timeout = params.timeoutMs ?? 600000;
    execFileAsync(npx, args, { cwd: workingDir, timeout, maxBuffer: 10 * 1024 * 1024 })
      .catch(() => { });

    return {
      toolType: this.toolType,
      operationId: `remotion_${Date.now()}`,
      status: "submitted",
    };
  }

  async poll(_config: ToolConnectionConfig, handle: JobHandle): Promise<PollResult> {
    return {
      status: "processing",
      progress: undefined,
    };
  }

  async exportProject(_config: ToolConnectionConfig, _params: {
    projectId: string;
    assetIds: string[];
    format: string;
    outputPath: string;
  }): Promise<{ filePath: string }> {
    throw new Error("Remotion uses code-based compositions, not export/import");
  }

  async importResult(_config: ToolConnectionConfig, _filePath: string): Promise<{
    filePath: string;
    format: string;
    metadata?: Record<string, unknown>;
  }> {
    throw new Error("Remotion uses code-based compositions, not export/import");
  }
}

export const remotionProvider = new RemotionProvider();