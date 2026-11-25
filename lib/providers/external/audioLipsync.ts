import "server-only";
import { FileBasedToolProvider } from "./animation2d";
import type { ToolCapability } from "./types";

const AUDACITY_CAPABILITIES: ToolCapability = {
  hasApi: false,
  supportsHeadless: true,
  supportsWorkflow: false,
  supportsFileImport: true,
  supportsFileExport: true,
  supportedFileFormats: [".aup", ".wav", ".mp3", ".flac", ".ogg"],
};

const WAV2LIP_CAPABILITIES: ToolCapability = {
  hasApi: false,
  supportsHeadless: true,
  supportsWorkflow: false,
  supportsFileImport: true,
  supportsFileExport: true,
  supportedFileFormats: [".mp4", ".avi", ".wav"],
};

const SADTALKER_CAPABILITIES: ToolCapability = {
  hasApi: false,
  supportsHeadless: true,
  supportsWorkflow: false,
  supportsFileImport: true,
  supportsFileExport: true,
  supportedFileFormats: [".mp4", ".png", ".jpg", ".wav"],
};

export const audacityProvider = new FileBasedToolProvider({
  toolType: "audacity",
  displayName: "Audacity",
  executableNames: ["audacity", "Audacity"],
  fileExtension: ".aup",
  capabilities: AUDACITY_CAPABILITIES,
  renderArgs: (projectFile, outputPath) => [
    projectFile,
    "--batch",
    "--export", `${outputPath}/export.wav`,
  ],
});

export const wav2LipProvider = new FileBasedToolProvider({
  toolType: "wav2lip",
  displayName: "Wav2Lip",
  executableNames: ["python", "python3"],
  fileExtension: ".mp4",
  capabilities: WAV2LIP_CAPABILITIES,
  renderArgs: (projectFile, outputPath) => [
    "inference.py",
    "--checkpoint_path", "checkpoints/wav2lip.pth",
    "--face", projectFile,
    "--audio", `${outputPath}/audio.wav`,
    "--outfile", `${outputPath}/lip_sync.mp4`,
  ],
});

export const sadTalkerProvider = new FileBasedToolProvider({
  toolType: "sadtalker",
  displayName: "SadTalker",
  executableNames: ["python", "python3"],
  fileExtension: ".mp4",
  capabilities: SADTALKER_CAPABILITIES,
  renderArgs: (projectFile, outputPath) => [
    "inference.py",
    "--driven_audio", `${outputPath}/audio.wav`,
    "--source_image", projectFile,
    "--result_dir", outputPath,
  ],
});

export type LipSyncParams = {
  faceImage: string;
  audioFile: string;
  outputPath: string;
  tool: "wav2lip" | "sadtalker";
  options?: {
    resizeFactor?: number;
    stillMode?: boolean;
    enhancer?: "gfpgan" | "none";
  };
};

export type AudioEditParams = {
  inputFile: string;
  outputFile: string;
  operations: Array<{
    type: "normalize" | "amplify" | "noise_reduction" | "fade_in" | "fade_out" | "trim" | "compress";
    params?: Record<string, unknown>;
  }>;
};