import "server-only";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderCapability } from "@/lib/providers/media/capability";
import type { AudioProvider, AudioGenerationRequest, AudioGenerationResult } from "@/lib/providers/media/audio/types";
import { defaultNarratorVoice, isKokoroVoice, languageCodeFromString } from "@/lib/providers/media/audio/kokoroVoices";
import { log } from "@/lib/log";

const KOKORO_CAPABILITIES: ProviderCapability = {
  supportsImageToImage: false,
  supportsImageToVideo: false,
  supportsReferenceGuidedVideo: false,
  maxClipDurationSeconds: 60,
  maxImageDimension: 0,
  isMock: false,
  isPaid: false,
  supportedModels: ["kokoro-82m"],
};

export type KokoroProviderConfig = {
  pythonPath: string;
  bridgeScriptPath: string;
  tempDir: string;
  timeoutMs: number;
};

export function resolveKokoroConfig(env: NodeJS.ProcessEnv = process.env): KokoroProviderConfig {
  const projectRoot = process.cwd();
  return {
    pythonPath: env.KOKORO_PYTHON_PATH?.trim() || "C:\\AI-Drama-Studio-Kokoro\\.venv\\Scripts\\python.exe",
    bridgeScriptPath: env.KOKORO_BRIDGE_SCRIPT?.trim() || path.join(projectRoot, "scripts", "kokoro_tts.py"),
    tempDir: env.KOKORO_TEMP_DIR?.trim() || path.join(tmpdir(), "kokoro-tts"),
    timeoutMs: Number(env.KOKORO_TIMEOUT_MS?.trim()) || 180_000,
  };
}

type BridgeResult = {
  ok: boolean;
  error?: string;
  output_path?: string;
  sample_rate?: number;
  duration_seconds?: number;
  num_chunks?: number;
  num_samples?: number;
};

function runBridge(config: KokoroProviderConfig, request: {
  text: string;
  voice: string;
  speed: number;
  output_path: string;
  lang_code: string;
}): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonPath, [config.bridgeScriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("kokoro_timeout"));
    }, config.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`kokoro_spawn_failed: ${err.message}`));
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const lines = stdout.trim().split("\n");
      const jsonLine = lines.find((line) => {
        const trimmed = line.trim();
        return trimmed.startsWith("{") && trimmed.endsWith("}");
      });
      if (!jsonLine) {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").slice(-500);
        reject(new Error(`kokoro_no_json_output: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(jsonLine.trim()) as BridgeResult);
      } catch {
        reject(new Error("kokoro_invalid_json_output"));
      }
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

export class KokoroAudioProvider implements AudioProvider {
  readonly id = "kokoro";
  readonly capabilities = KOKORO_CAPABILITIES;
  private readonly config: KokoroProviderConfig;

  constructor(config?: KokoroProviderConfig) {
    this.config = config ?? resolveKokoroConfig();
  }

  async generate(request: AudioGenerationRequest): Promise<AudioGenerationResult> {
    const kokoroStart = Date.now();
    const voiceId = request.voiceProfile?.voiceIdentifier || defaultNarratorVoice();
    const langCode = request.voiceProfile?.language
      ? (languageCodeFromString(request.voiceProfile.language) ?? "a")
      : (languageCodeFromString(request.settings.language) ?? "a");

    log.info("audio", "audio.kokoro.request.started", {
      voiceId,
      langCode,
      kind: request.kind,
      textLength: request.text.length,
      idempotencyKey: request.idempotencyKey.slice(0, 32),
    });

    if (request.kind === "sfx") {
      throw new Error("kokoro_does_not_support_sfx");
    }
    if (!request.text || request.text.trim().length === 0) {
      throw new Error("text_required");
    }

    if (!isKokoroVoice(voiceId)) {
      throw new Error(`unknown_kokoro_voice: ${voiceId}`);
    }

    const speed = 1.0;
    const tempFile = path.join(
      this.config.tempDir,
      `${createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 32)}-${randomUUID().slice(0, 8)}.wav`
    );

    await mkdir(path.dirname(tempFile), { recursive: true });

    let result: BridgeResult;
    try {
      result = await runBridge(this.config, {
        text: request.text,
        voice: voiceId,
        speed,
        output_path: tempFile,
        lang_code: langCode,
      });
    } catch (error) {
      await rm(tempFile, { force: true });
      log.error("audio", "audio.kokoro.request.failed", {
        voiceId,
        stage: "bridge",
        ms: Date.now() - kokoroStart,
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
      throw error;
    }

    if (!result.ok || !result.output_path) {
      await rm(tempFile, { force: true });
      log.error("audio", "audio.kokoro.request.failed", {
        voiceId,
        stage: "bridge_result",
        ms: Date.now() - kokoroStart,
        errorMessage: result.error ?? "kokoro_generation_failed",
      });
      throw new Error(result.error ?? "kokoro_generation_failed");
    }

    let bytes: Uint8Array;
    try {
      const buffer = await readFile(tempFile);
      bytes = new Uint8Array(buffer);
    } catch {
      throw new Error("kokoro_output_file_unreadable");
    } finally {
      await rm(tempFile, { force: true });
    }

    if (bytes.byteLength < 44) {
      throw new Error("kokoro_output_too_small");
    }
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const wave = String.fromCharCode(...bytes.slice(8, 12));
    if (riff !== "RIFF" || wave !== "WAVE") {
      throw new Error("kokoro_output_not_wav");
    }

    log.info("audio", "audio.kokoro.request.completed", {
      voiceId,
      langCode,
      ms: Date.now() - kokoroStart,
      byteLength: bytes.byteLength,
      durationSeconds: result.duration_seconds,
    });

    return {
      bytes,
      mimeType: "audio/wav",
      mock: false,
      usage: { estimatedCostCents: 0 },
    };
  }
}