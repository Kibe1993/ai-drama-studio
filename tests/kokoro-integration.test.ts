import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";

import { KokoroAudioProvider } from "@/lib/providers/media/audio/kokoro";
import type { AudioGenerationRequest } from "@/lib/providers/media/audio/types";

const KOKORO_PYTHON = "C:\\AI-Drama-Studio-Kokoro\\.venv\\Scripts\\python.exe";
const kokoroAvailable = existsSync(KOKORO_PYTHON);

describe.skipIf(!kokoroAvailable)("kokoro audio provider (real)", () => {
  const provider = new KokoroAudioProvider();

  it("generates real audio for a dialogue line", async () => {
    const request: AudioGenerationRequest = {
      kind: "dialogue",
      text: "I won't let them take this from us.",
      voiceProfile: {
        id: "test",
        provider: "kokoro",
        voiceIdentifier: "af_heart",
        language: "en",
      },
      settings: { language: "en" },
      idempotencyKey: "kokoro-integration-test-1",
    };

    const result = await provider.generate(request);

    expect(result.mock).toBe(false);
    expect(result.mimeType).toBe("audio/wav");
    expect(result.bytes.byteLength).toBeGreaterThan(1000);

    const riff = String.fromCharCode(...result.bytes.slice(0, 4));
    const wave = String.fromCharCode(...result.bytes.slice(8, 12));
    expect(riff).toBe("RIFF");
    expect(wave).toBe("WAVE");
  }, 180_000);

  it("generates real audio with a male voice", async () => {
    const request: AudioGenerationRequest = {
      kind: "dialogue",
      text: "Then we fight. We fight for everything we love.",
      voiceProfile: {
        id: "test",
        provider: "kokoro",
        voiceIdentifier: "am_adam",
        language: "en",
      },
      settings: { language: "en" },
      idempotencyKey: "kokoro-integration-test-2",
    };

    const result = await provider.generate(request);

    expect(result.mock).toBe(false);
    expect(result.bytes.byteLength).toBeGreaterThan(1000);

    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    const sampleRate = view.getUint32(24, true);
    expect(sampleRate).toBe(24000);
  }, 180_000);

  it("generates narration audio", async () => {
    const request: AudioGenerationRequest = {
      kind: "narration",
      text: "The storm raged outside as the two figures faced each other across the dimly lit room.",
      voiceProfile: {
        id: "narrator",
        provider: "kokoro",
        voiceIdentifier: "af_heart",
        language: "en",
      },
      settings: { language: "en" },
      idempotencyKey: "kokoro-integration-test-3",
    };

    const result = await provider.generate(request);

    expect(result.mock).toBe(false);
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  }, 180_000);

  it("rejects unknown voice IDs", async () => {
    const request: AudioGenerationRequest = {
      kind: "dialogue",
      text: "Hello.",
      voiceProfile: {
        id: "test",
        provider: "kokoro",
        voiceIdentifier: "invalid_voice",
        language: "en",
      },
      settings: { language: "en" },
      idempotencyKey: "kokoro-integration-test-4",
    };

    await expect(provider.generate(request)).rejects.toThrow("unknown_kokoro_voice");
  });

  it("rejects empty text", async () => {
    const request: AudioGenerationRequest = {
      kind: "dialogue",
      text: "   ",
      voiceProfile: {
        id: "test",
        provider: "kokoro",
        voiceIdentifier: "af_heart",
        language: "en",
      },
      settings: { language: "en" },
      idempotencyKey: "kokoro-integration-test-5",
    };

    await expect(provider.generate(request)).rejects.toThrow("text_required");
  });
});