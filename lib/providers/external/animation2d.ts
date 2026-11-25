import "server-only";
import type { ExternalToolProvider, ToolConnectionConfig, ExecuteParams, JobHandle, PollResult, ToolCapability, WorkflowInfo } from "./types";
import type { ToolType, HealthCheckResult } from "@/lib/validation/toolConfig";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export type FileBasedToolOptions = {
  toolType: ToolType;
  displayName: string;
  executableNames: string[];
  fileExtension: string;
  capabilities: ToolCapability;
  renderArgs?: (projectFile: string, outputPath: string) => string[];
};

export class FileBasedToolProvider implements ExternalToolProvider {
  readonly id: string;
  readonly toolType: ToolType;
  readonly capabilities: ToolCapability;
  private readonly executableNames: string[];
  private readonly fileExtension: string;
  private readonly renderArgsFn?: (projectFile: string, outputPath: string) => string[];

  constructor(options: FileBasedToolOptions) {
    this.id = options.toolType;
    this.toolType = options.toolType;
    this.capabilities = options.capabilities;
    this.executableNames = options.executableNames;
    this.fileExtension = options.fileExtension;
    this.renderArgsFn = options.renderArgs;
  }

  private async findExecutable(config: ToolConnectionConfig): Promise<string | null> {
    if (config.executablePath) {
      try {
        await access(config.executablePath);
        return config.executablePath;
      } catch {
        return null;
      }
    }
    for (const name of this.executableNames) {
      try {
        await execFileAsync(name, ["--version"], { timeout: 5000 });
        return name;
      } catch {
        continue;
      }
    }
    return null;
  }

  async healthCheck(config: ToolConnectionConfig): Promise<HealthCheckResult> {
    const start = Date.now();
    const exe = await this.findExecutable(config);
    if (!exe) {
      return {
        status: "unhealthy",
        message: `${this.id} executable not found. Configure the path or ensure it's in PATH.`,
        checkedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - start,
      };
    }
    return {
      status: "healthy",
      message: `${this.id} found at: ${exe}`,
      details: { executable: exe },
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - start,
    };
  }

  async listWorkflows(_config: ToolConnectionConfig): Promise<WorkflowInfo[]> {
    return [];
  }

  async execute(config: ToolConnectionConfig, params: ExecuteParams): Promise<JobHandle> {
    const exe = await this.findExecutable(config);
    if (!exe) throw new Error(`${this.id} executable not found`);

    const workingDir = config.workingDirectory ?? process.cwd();
    const projectFile = params.inputs.projectFile as string;
    if (!projectFile) throw new Error("projectFile is required");

    const outputPath = params.outputPath ?? path.join(workingDir, `output_${Date.now()}`);
    await mkdir(outputPath, { recursive: true });

    if (!this.renderArgsFn) {
      throw new Error(`${this.id} does not support headless rendering. Use export/import workflow.`);
    }

    const args = this.renderArgsFn(projectFile, outputPath);
    const timeout = params.timeoutMs ?? 300000;

    execFileAsync(exe, args, { cwd: workingDir, timeout })
      .catch(() => { });

    return {
      toolType: this.toolType,
      operationId: `render_${Date.now()}`,
      status: "submitted",
    };
  }

  async poll(_config: ToolConnectionConfig, handle: JobHandle): Promise<PollResult> {
    return {
      status: "processing",
      progress: undefined,
    };
  }

  async exportProject(config: ToolConnectionConfig, params: {
    projectId: string;
    assetIds: string[];
    format: string;
    outputPath: string;
  }): Promise<{ filePath: string }> {
    const workingDir = config.workingDirectory ?? process.cwd();
    const exportDir = path.join(workingDir, params.outputPath);
    await mkdir(exportDir, { recursive: true });

    const manifest = {
      tool: this.id,
      projectId: params.projectId,
      exportedAt: new Date().toISOString(),
      assets: params.assetIds,
      format: params.format,
    };

    const manifestPath = path.join(exportDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    return { filePath: manifestPath };
  }

  async importResult(config: ToolConnectionConfig, filePath: string): Promise<{
    filePath: string;
    format: string;
    metadata?: Record<string, unknown>;
  }> {
    const workingDir = config.workingDirectory ?? process.cwd();
    const importDir = path.isAbsolute(filePath) ? filePath : path.join(workingDir, filePath);

    try {
      const files = await readdir(importDir);
      const resultFiles = files.filter((f) => f.endsWith(this.fileExtension) || f.endsWith(".mp4") || f.endsWith(".png"));
      return {
        filePath: importDir,
        format: this.fileExtension,
        metadata: { files: resultFiles, count: resultFiles.length },
      };
    } catch {
      return {
        filePath: importDir,
        format: this.fileExtension,
      };
    }
  }
}

export const synfigProvider = new FileBasedToolProvider({
  toolType: "synfig",
  displayName: "Synfig Studio",
  executableNames: ["synfig", "synfigstudio"],
  fileExtension: ".sifz",
  capabilities: {
    hasApi: false,
    supportsHeadless: true,
    supportsWorkflow: false,
    supportsFileImport: true,
    supportsFileExport: true,
    supportedFileFormats: [".sifz", ".sif", ".png", ".mp4"],
  },
  renderArgs: (projectFile, outputPath) => [
    projectFile,
    "-o", `${outputPath}/render_#####.png`,
    "-t", "png",
  ],
});

export const openToonzProvider = new FileBasedToolProvider({
  toolType: "opentoonz",
  displayName: "OpenToonz",
  executableNames: ["opentoonz", "OpenToonz_1.6"],
  fileExtension: ".otx",
  capabilities: {
    hasApi: false,
    supportsHeadless: false,
    supportsWorkflow: false,
    supportsFileImport: true,
    supportsFileExport: true,
    supportedFileFormats: [".otx", ".tnz", ".png", ".mp4"],
  },
});

export const pencil2DProvider = new FileBasedToolProvider({
  toolType: "pencil2d",
  displayName: "Pencil2D",
  executableNames: ["pencil2d", "Pencil2D"],
  fileExtension: ".pclx",
  capabilities: {
    hasApi: false,
    supportsHeadless: false,
    supportsWorkflow: false,
    supportsFileImport: true,
    supportsFileExport: true,
    supportedFileFormats: [".pclx", ".png", ".mp4"],
  },
});

export const blenderGreasePencilProvider = new FileBasedToolProvider({
  toolType: "blender",
  displayName: "Blender (Grease Pencil)",
  executableNames: ["blender", "blender.exe"],
  fileExtension: ".blend",
  capabilities: {
    hasApi: true,
    supportsHeadless: true,
    supportsWorkflow: true,
    supportsFileImport: true,
    supportsFileExport: true,
    supportedFileFormats: [".blend", ".png", ".mp4", ".fbx", ".glb"],
  },
  renderArgs: (projectFile, outputPath) => [
    projectFile,
    "--background",
    "--render-output", `${outputPath}/frame_#####`,
    "--render-format", "PNG",
    "--render-anim",
  ],
});