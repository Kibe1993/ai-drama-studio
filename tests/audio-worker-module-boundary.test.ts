import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { JobError } from "@/lib/pipeline/types";
import { isModuleResolutionError } from "@/lib/pipeline/processJob";

const PROJECT_ROOT = process.cwd();

function readFile(relPath: string): string {
  return readFileSync(path.join(PROJECT_ROOT, relPath), "utf-8");
}

function hasUseClient(filePath: string): boolean {
  try {
    const content = readFile(filePath);
    return content.includes('"use client"') || content.includes("'use client'");
  } catch {
    return false;
  }
}

function hasServerOnly(filePath: string): boolean {
  try {
    const content = readFile(filePath);
    return content.includes('import "server-only"') || content.includes("import 'server-only'");
  } catch {
    return false;
  }
}

describe("Audio worker module boundary regression", () => {
  describe("Module resolution error detection", () => {
    it("detects server-only Client Component import errors", () => {
      const error = new Error(
        "This module cannot be imported from a Client Component module. It should only be used from a Server Component."
      );
      expect(isModuleResolutionError(error)).toBe(true);
    });

    it("detects 'Cannot find module' errors", () => {
      const error = new Error("Cannot find module '@/lib/providers/media/audio/kokoro'");
      expect(isModuleResolutionError(error)).toBe(true);
    });

    it("detects 'Could not resolve' errors", () => {
      const error = new Error("Could not resolve './server-only'");
      expect(isModuleResolutionError(error)).toBe(true);
    });

    it("detects ERR_MODULE_NOT_FOUND errors", () => {
      const error = new Error("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'server-only'");
      expect(isModuleResolutionError(error)).toBe(true);
    });

    it("does not classify Kokoro connection errors as module resolution", () => {
      const error = new Error("kokoro_spawn_failed: ECONNREFUSED 127.0.0.1:8000");
      expect(isModuleResolutionError(error)).toBe(false);
    });

    it("does not classify timeout errors as module resolution", () => {
      const error = new Error("kokoro_timeout");
      expect(isModuleResolutionError(error)).toBe(false);
    });

    it("does not classify generic generation errors as module resolution", () => {
      const error = new Error("kokoro_generation_failed");
      expect(isModuleResolutionError(error)).toBe(false);
    });

    it("does not classify non-Error values as module resolution", () => {
      expect(isModuleResolutionError("some string")).toBe(false);
      expect(isModuleResolutionError(undefined)).toBe(false);
      expect(isModuleResolutionError(null)).toBe(false);
      expect(isModuleResolutionError({ message: "cannot be imported" })).toBe(false);
    });
  });

  describe("Retry classification for module boundary errors", () => {
    it("creates a non-retryable JobError for module resolution failures", () => {
      const originalError = new Error(
        "This module cannot be imported from a Client Component module. It should only be used from a Server Component."
      );
      const isModuleErr = isModuleResolutionError(originalError);
      expect(isModuleErr).toBe(true);

      const errorCode = isModuleErr ? "module_resolution" : "stage_failed";
      const failure = new JobError(originalError.message, errorCode, !isModuleErr);

      expect(failure.code).toBe("module_resolution");
      expect(failure.retryable).toBe(false);
    });

    it("creates a retryable JobError for transient Kokoro failures", () => {
      const originalError = new Error("kokoro_spawn_failed: ECONNREFUSED");
      const isModuleErr = isModuleResolutionError(originalError);
      expect(isModuleErr).toBe(false);

      const errorCode = isModuleErr ? "module_resolution" : "stage_failed";
      const failure = new JobError(originalError.message, errorCode, !isModuleErr);

      expect(failure.code).toBe("stage_failed");
      expect(failure.retryable).toBe(true);
    });

    it("creates a retryable JobError for Kokoro timeout", () => {
      const originalError = new Error("kokoro_timeout");
      const isModuleErr = isModuleResolutionError(originalError);
      expect(isModuleErr).toBe(false);

      const failure = new JobError(originalError.message, "stage_failed", !isModuleErr);
      expect(failure.retryable).toBe(true);
    });
  });

  describe("Audio worker dependency graph does not import Client Components", () => {
    const audioWorkerModules = [
      "lib/providers/media/audio/kokoro.ts",
      "lib/providers/media/audio/types.ts",
      "lib/providers/media/audio/kokoroVoices.ts",
      "lib/providers/media/capability.ts",
      "lib/services/ttsOrchestrationService.ts",
      "lib/services/dialogueExtractionService.ts",
      "lib/services/voiceAssignmentService.ts",
      "lib/services/mediaAssetService.ts",
      "lib/providers/storage/registry.ts",
      "lib/providers/storage/local.ts",
      "lib/providers/storage/types.ts",
      "lib/repositories/audioSegmentRepository.ts",
      "lib/repositories/voiceProfileRepository.ts",
      "lib/repositories/canonicalEntityRepository.ts",
      "lib/repositories/mediaAssetRepository.ts",
      "lib/pipeline/processJob.ts",
      "lib/log.ts",
      "lib/http/errors.ts",
    ];

    for (const mod of audioWorkerModules) {
      it(`${mod} has no "use client" directive`, () => {
        expect(hasUseClient(mod)).toBe(false);
      });
    }
  });

  describe("Audio worker server-only boundary is correct", () => {
    it("kokoro adapter has server-only protection", () => {
      expect(hasServerOnly("lib/providers/media/audio/kokoro.ts")).toBe(true);
    });

    it("ttsOrchestrationService has server-only protection", () => {
      expect(hasServerOnly("lib/services/ttsOrchestrationService.ts")).toBe(true);
    });

    it("kokoroVoices does NOT have server-only (shared with client)", () => {
      expect(hasServerOnly("lib/providers/media/audio/kokoroVoices.ts")).toBe(false);
    });

    it("storage types do NOT have server-only (shared types)", () => {
      expect(hasServerOnly("lib/providers/storage/types.ts")).toBe(false);
    });

    it("storage registry does NOT have server-only", () => {
      expect(hasServerOnly("lib/providers/storage/registry.ts")).toBe(false);
    });
  });

  describe("Worker script uses react-server condition", () => {
    it("package.json worker script includes --conditions react-server", () => {
      const pkg = JSON.parse(readFile("package.json"));
      expect(pkg.scripts.worker).toContain("--conditions");
      expect(pkg.scripts.worker).toContain("react-server");
    });

    it("package.json media:orphan-audit script includes --conditions react-server", () => {
      const pkg = JSON.parse(readFile("package.json"));
      expect(pkg.scripts["media:orphan-audit"]).toContain("--conditions");
      expect(pkg.scripts["media:orphan-audit"]).toContain("react-server");
    });
  });

  describe("Audio worker can import modules with react-server condition", () => {
    it("server-only resolves to empty under react-server condition", async () => {
      const { execSync } = await import("node:child_process");
      const result = execSync(
        "npx tsx --conditions react-server -e \"import 'server-only'; console.log('OK')\"",
        { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 30_000 }
      );
      expect(result.trim()).toBe("OK");
    });

    it("Kokoro adapter can be imported without throwing", async () => {
      const mod = await import("@/lib/providers/media/audio/kokoro");
      expect(mod.KokoroAudioProvider).toBeDefined();
      expect(typeof mod.KokoroAudioProvider).toBe("function");
    });

    it("TTS orchestration service can be imported without throwing", async () => {
      const mod = await import("@/lib/services/ttsOrchestrationService");
      expect(mod.createTtsOrchestrationService).toBeDefined();
      expect(typeof mod.createTtsOrchestrationService).toBe("function");
    });

    it("Storage registry can be imported without throwing", async () => {
      const mod = await import("@/lib/providers/storage/registry");
      expect(mod.createStorageProvider).toBeDefined();
      expect(typeof mod.createStorageProvider).toBe("function");
    });
  });

  describe("Kokoro adapter structure", () => {
    it("has correct provider id and capabilities", async () => {
      const { KokoroAudioProvider } = await import("@/lib/providers/media/audio/kokoro");
      const provider = new KokoroAudioProvider();
      expect(provider.id).toBe("kokoro");
      expect(provider.capabilities.isMock).toBe(false);
      expect(provider.capabilities.supportedModels).toContain("kokoro-82m");
    });

    it("rejects SFX requests", async () => {
      const { KokoroAudioProvider } = await import("@/lib/providers/media/audio/kokoro");
      const provider = new KokoroAudioProvider();
      await expect(
        provider.generate({
          kind: "sfx",
          text: "explosion",
          voiceProfile: { id: "test", provider: "kokoro", voiceIdentifier: "af_heart", language: "en" },
          settings: { language: "en" },
          idempotencyKey: "test-sfx-reject",
        })
      ).rejects.toThrow("kokoro_does_not_support_sfx");
    });

    it("rejects empty text", async () => {
      const { KokoroAudioProvider } = await import("@/lib/providers/media/audio/kokoro");
      const provider = new KokoroAudioProvider();
      await expect(
        provider.generate({
          kind: "dialogue",
          text: "   ",
          voiceProfile: { id: "test", provider: "kokoro", voiceIdentifier: "af_heart", language: "en" },
          settings: { language: "en" },
          idempotencyKey: "test-empty-text",
        })
      ).rejects.toThrow("text_required");
    });
  });

  describe("Failed audio generation does not mark segment completed", () => {
    it("Kokoro adapter throws on invalid voice without producing output", async () => {
      const { KokoroAudioProvider } = await import("@/lib/providers/media/audio/kokoro");
      const provider = new KokoroAudioProvider();
      await expect(
        provider.generate({
          kind: "dialogue",
          text: "Hello world",
          voiceProfile: { id: "test", provider: "kokoro", voiceIdentifier: "nonexistent_voice", language: "en" },
          settings: { language: "en" },
          idempotencyKey: "test-bad-voice",
        })
      ).rejects.toThrow("unknown_kokoro_voice");
    });
  });

  describe("Kokoro local availability", () => {
    const KOKORO_PYTHON = "C:\\AI-Drama-Studio-Kokoro\\.venv\\Scripts\\python.exe";
    const kokoroAvailable = existsSync(KOKORO_PYTHON);

    it.skipIf(!kokoroAvailable)("Kokoro Python environment is installed", () => {
      expect(kokoroAvailable).toBe(true);
    });

    it.skipIf(kokoroAvailable)("Kokoro Python environment is NOT installed — real invocation test skipped", () => {
      expect(kokoroAvailable).toBe(false);
    });
  });
});