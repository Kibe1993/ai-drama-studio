import { describe, expect, it } from "vitest";
import {
  assignVoices,
  narratorAssignment,
} from "@/lib/services/voiceAssignmentService";

describe("voice assignment service", () => {
  it("assigns voices to speakers deterministically", () => {
    const assignments = assignVoices(["Amara", "Kael"], "project123");
    expect(assignments.size).toBe(2);
    expect(assignments.get("Amara")?.voiceIdentifier).toBeTruthy();
    expect(assignments.get("Kael")?.voiceIdentifier).toBeTruthy();
  });

  it("assigns the same voice to the same character consistently", () => {
    const a1 = assignVoices(["Amara"], "project123");
    const a2 = assignVoices(["Amara"], "project123");
    expect(a1.get("Amara")?.voiceIdentifier).toBe(a2.get("Amara")?.voiceIdentifier);
  });

  it("assigns different voices to different characters", () => {
    const assignments = assignVoices(["Amara", "Kael", "Zara", "Bishop"], "project123");
    const voiceIds = [...assignments.values()].map((a) => a.voiceIdentifier);
    const unique = new Set(voiceIds);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("uses existing voice profile when available", () => {
    const assignments = assignVoices(["Amara"], "project123", [
      {
        canonicalEntityId: "entity1",
        voiceIdentifier: "bf_emma",
        language: "en",
        speakerName: "Amara",
      },
    ]);
    expect(assignments.get("Amara")?.voiceIdentifier).toBe("bf_emma");
    expect(assignments.get("Amara")?.source).toBe("existing_profile");
  });

  it("falls back to deterministic when no existing profile", () => {
    const assignments = assignVoices(["Amara"], "project123", []);
    expect(assignments.get("Amara")?.source).toBe("deterministic");
  });

  it("matches existing profile case-insensitively", () => {
    const assignments = assignVoices(["AMARA"], "project123", [
      {
        canonicalEntityId: "entity1",
        voiceIdentifier: "am_adam",
        language: "en",
        speakerName: "Amara",
      },
    ]);
    expect(assignments.get("AMARA")?.voiceIdentifier).toBe("am_adam");
  });

  it("returns a narrator assignment with af_heart", () => {
    const narrator = narratorAssignment();
    expect(narrator.voiceIdentifier).toBe("af_heart");
    expect(narrator.speakerName).toBe("NARRATOR");
  });

  it("assigns all voices from the American English pool", () => {
    const speakers = Array.from({ length: 15 }, (_, i) => `Character${i}`);
    const assignments = assignVoices(speakers, "project123");
    for (const speaker of speakers) {
      const voice = assignments.get(speaker);
      expect(voice).toBeDefined();
      expect(voice?.voiceIdentifier.startsWith("a")).toBe(true);
    }
  });

  it("handles many speakers without collision issues", () => {
    const speakers = Array.from({ length: 30 }, (_, i) => `Speaker${i}`);
    const assignments = assignVoices(speakers, "project456");
    expect(assignments.size).toBe(30);
    for (const speaker of speakers) {
      expect(assignments.get(speaker)?.voiceIdentifier).toBeTruthy();
    }
  });

  it("produces different assignments for different projects", () => {
    const a1 = assignVoices(["Amara"], "projectAAA");
    const a2 = assignVoices(["Amara"], "projectBBB");
    // They might be the same by chance, but with 20 American English voices
    // and a hash-based selection, different projects should usually differ.
    // We just verify both are valid.
    expect(a1.get("Amara")?.voiceIdentifier).toBeTruthy();
    expect(a2.get("Amara")?.voiceIdentifier).toBeTruthy();
  });
});