import "server-only";
import { createHash } from "node:crypto";
import {
  KOKORO_VOICES,
  defaultNarratorVoice,
  voicesByLanguageAndGender,
  type KokoroLanguageCode,
  type KokoroVoiceGender,
} from "@/lib/providers/media/audio/kokoroVoices";

export type VoiceAssignment = {
  speakerName: string;
  voiceIdentifier: string;
  language: string;
  gender: KokoroVoiceGender;
  source: "existing_profile" | "deterministic";
};

export type ExistingVoiceProfile = {
  canonicalEntityId: string;
  voiceIdentifier: string;
  language: string;
  speakerName: string;
};

const DEFAULT_LANGUAGE: KokoroLanguageCode = "a";

function hashIndex(value: string, max: number): number {
  const hash = createHash("sha256").update(value.toLowerCase()).digest("hex");
  const num = parseInt(hash.slice(0, 8), 16);
  return num % max;
}

function inferGender(name: string): KokoroVoiceGender {
  const lower = name.toLowerCase().trim();
  const femaleHints = [
    "woman", "girl", "lady", "queen", "princess", "mother", "sister", "aunt",
    "daughter", "wife", "grandmother", "grandma", "miss", "ms", "mrs",
    "she", "her", "female",
  ];
  const maleHints = [
    "man", "boy", "lord", "king", "prince", "father", "brother", "uncle",
    "son", "husband", "grandfather", "grandpa", "mr", "he", "him", "male",
  ];
  if (femaleHints.some((hint) => lower.includes(hint))) return "female";
  if (maleHints.some((hint) => lower.includes(hint))) return "male";
  return "female";
}

function deterministicVoice(speakerName: string, projectId: string): { voiceIdentifier: string; gender: KokoroVoiceGender } {
  const gender = inferGender(speakerName);
  const pool = voicesByLanguageAndGender(DEFAULT_LANGUAGE, gender);
  if (pool.length === 0) {
    const fallback = KOKORO_VOICES.filter((v) => v.language === DEFAULT_LANGUAGE);
    const voice = fallback[hashIndex(`${projectId}:${speakerName}`, fallback.length)];
    return { voiceIdentifier: voice.id, gender: voice.gender };
  }
  const voice = pool[hashIndex(`${projectId}:${speakerName}`, pool.length)];
  return { voiceIdentifier: voice.id, gender };
}

export function assignVoices(
  speakerNames: string[],
  projectId: string,
  existingProfiles: ExistingVoiceProfile[] = []
): Map<string, VoiceAssignment> {
  const assignments = new Map<string, VoiceAssignment>();
  const profileByName = new Map<string, ExistingVoiceProfile>();
  for (const profile of existingProfiles) {
    profileByName.set(profile.speakerName.toLowerCase(), profile);
  }

  for (const name of speakerNames) {
    const existing = profileByName.get(name.toLowerCase());
    if (existing && existing.voiceIdentifier) {
      assignments.set(name, {
        speakerName: name,
        voiceIdentifier: existing.voiceIdentifier,
        language: existing.language || "en",
        gender: existing.voiceIdentifier.startsWith("af") || existing.voiceIdentifier.startsWith("bf") ? "female" : "male",
        source: "existing_profile",
      });
      continue;
    }

    const { voiceIdentifier, gender } = deterministicVoice(name, projectId);
    assignments.set(name, {
      speakerName: name,
      voiceIdentifier,
      language: "en",
      gender,
      source: "deterministic",
    });
  }

  return assignments;
}

export function narratorAssignment(): VoiceAssignment {
  return {
    speakerName: "NARRATOR",
    voiceIdentifier: defaultNarratorVoice(),
    language: "en",
    gender: "female",
    source: "deterministic",
  };
}