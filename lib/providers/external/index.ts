import "server-only";
import { ComfyUIProvider } from "./comfyui";
import { registerToolProvider } from "./registry";

let initialized = false;

export function initializeExternalProviders(): void {
  if (initialized) return;
  initialized = true;
  registerToolProvider(new ComfyUIProvider());
}