import "server-only";
import { ComfyUIProvider } from "./comfyui";
import { synfigProvider, openToonzProvider, pencil2DProvider, blenderGreasePencilProvider } from "./animation2d";
import { makeHumanProvider, mixamoProvider } from "./animation3d";
import { audacityProvider, wav2LipProvider, sadTalkerProvider } from "./audioLipsync";
import { remotionProvider } from "./remotion";
import { registerToolProvider } from "./registry";

let initialized = false;

export function initializeExternalProviders(): void {
  if (initialized) return;
  initialized = true;
  registerToolProvider(new ComfyUIProvider());
  registerToolProvider(synfigProvider);
  registerToolProvider(openToonzProvider);
  registerToolProvider(pencil2DProvider);
  registerToolProvider(blenderGreasePencilProvider);
  registerToolProvider(makeHumanProvider);
  registerToolProvider(mixamoProvider);
  registerToolProvider(audacityProvider);
  registerToolProvider(wav2LipProvider);
  registerToolProvider(sadTalkerProvider);
  registerToolProvider(remotionProvider);
}