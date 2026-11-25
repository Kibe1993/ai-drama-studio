import "server-only";
import { FileBasedToolProvider } from "./animation2d";
import type { ToolCapability } from "./types";

const MAKEHUMAN_CAPABILITIES: ToolCapability = {
  hasApi: false,
  supportsHeadless: true,
  supportsWorkflow: false,
  supportsFileImport: true,
  supportsFileExport: true,
  supportedFileFormats: [".mhx", ".obj", ".fbx", ".glb", ".dae", ".stl"],
};

const MIXAMO_CAPABILITIES: ToolCapability = {
  hasApi: false,
  supportsHeadless: false,
  supportsWorkflow: false,
  supportsFileImport: true,
  supportsFileExport: true,
  supportedFileFormats: [".fbx", ".bvh"],
};

export const makeHumanProvider = new FileBasedToolProvider({
  toolType: "makehuman",
  displayName: "MakeHuman",
  executableNames: ["makehuman", "makehuman-community"],
  fileExtension: ".mhx",
  capabilities: MAKEHUMAN_CAPABILITIES,
  renderArgs: (projectFile, outputPath) => [
    projectFile,
    "--export", "fbx",
    "--output", `${outputPath}/character.fbx`,
  ],
});

export const mixamoProvider = new FileBasedToolProvider({
  toolType: "mixamo",
  displayName: "Mixamo",
  executableNames: [],
  fileExtension: ".fbx",
  capabilities: MIXAMO_CAPABILITIES,
});

export type Character3DProfile = {
  modelAssetId?: string;
  rigAssetId?: string;
  animationLibrary: Array<{
    animationId: string;
    name: string;
    assetId?: string;
    category: string;
  }>;

};

export type MakeHumanParams = {
  height?: number;
  weight?: number;
  age?: number;
  gender?: "male" | "female" | "neutral";
  ethnicity?: string;
  hairStyle?: string;
  hairColor?: string;
  eyeColor?: string;
  clothing?: string;
};

export type MixamoAnimation = {
  id: string;
  name: string;
  category: string;
  description?: string;
  durationSeconds?: number;
};