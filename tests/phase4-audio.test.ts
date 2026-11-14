import { describe, expect, it } from "vitest";
import { createAudioProductionService } from "@/lib/services/audioProductionService";

describe("audio production service", () => {
  const service = createAudioProductionService();

  it("validates dialogue originates from the approved screenplay", () => {
    const approved = [
      { speaker: "Amara", text: "I won't let them take this from us." },
      { speaker: "Kael", text: "Then we fight." },
    ];
    const candidate = [
      { speaker: "Amara", text: "I won't let them take this from us." },
      { speaker: "Kael", text: "Then we fight." },
    ];
    const result = service.validateDialogueFromScreenplay(candidate, approved);
    expect(result.valid).toBe(true);
    expect(result.invalidLines).toHaveLength(0);
  });

  it("rejects invented dialogue not in the approved screenplay", () => {
    const approved = [{ speaker: "Amara", text: "I won't let them take this." }];
    const candidate = [
      { speaker: "Amara", text: "I won't let them take this." },
      { speaker: "Kael", text: "Let's run away instead." },
    ];
    const result = service.validateDialogueFromScreenplay(candidate, approved);
    expect(result.valid).toBe(false);
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0].text).toBe("Let's run away instead.");
  });

  it("rejects unlicensed copyrighted music", () => {
    expect(() => service.validateMusicLicensing({
      assetId: "abc123",
      volume: 0.5,
      startSeconds: 0,
      endSeconds: 30,
      licensing: "",
    })).toThrow();

    expect(() => service.validateMusicLicensing({
      assetId: "abc123",
      volume: 0.5,
      startSeconds: 0,
      endSeconds: 30,
      licensing: "unlicensed",
    })).toThrow();
  });

  it("accepts properly licensed music", () => {
    expect(() => service.validateMusicLicensing({
      assetId: "abc123",
      volume: 0.5,
      startSeconds: 0,
      endSeconds: 30,
      licensing: "CC-BY-4.0",
    })).not.toThrow();
  });

  it("detects dialogue duration mismatch with shot video", () => {
    const ok = service.detectDurationMismatch(5.0, 5.2);
    expect(ok.mismatch).toBe(false);

    const bad = service.detectDurationMismatch(8.0, 5.0);
    expect(bad.mismatch).toBe(true);
    expect(bad.difference).toBe(3.0);
  });
});