export type KokoroLanguageCode = "a" | "b" | "e" | "f" | "h" | "i" | "p" | "j" | "z";

export type KokoroVoiceGender = "female" | "male";

export type KokoroVoice = {
  id: string;
  language: KokoroLanguageCode;
  languageName: string;
  gender: KokoroVoiceGender;
};

export const KOKORO_LANGUAGE_NAMES: Record<KokoroLanguageCode, string> = {
  a: "American English",
  b: "British English",
  e: "Spanish",
  f: "French",
  h: "Hindi",
  i: "Italian",
  p: "Portuguese",
  j: "Japanese",
  z: "Mandarin Chinese",
};

export const KOKORO_VOICES: readonly KokoroVoice[] = [
  { id: "af_heart", language: "a", languageName: "American English", gender: "female" },
  { id: "af_alloy", language: "a", languageName: "American English", gender: "female" },
  { id: "af_aoede", language: "a", languageName: "American English", gender: "female" },
  { id: "af_bella", language: "a", languageName: "American English", gender: "female" },
  { id: "af_jessica", language: "a", languageName: "American English", gender: "female" },
  { id: "af_kore", language: "a", languageName: "American English", gender: "female" },
  { id: "af_nicole", language: "a", languageName: "American English", gender: "female" },
  { id: "af_nova", language: "a", languageName: "American English", gender: "female" },
  { id: "af_river", language: "a", languageName: "American English", gender: "female" },
  { id: "af_sarah", language: "a", languageName: "American English", gender: "female" },
  { id: "af_sky", language: "a", languageName: "American English", gender: "female" },
  { id: "am_adam", language: "a", languageName: "American English", gender: "male" },
  { id: "am_echo", language: "a", languageName: "American English", gender: "male" },
  { id: "am_eric", language: "a", languageName: "American English", gender: "male" },
  { id: "am_fenrir", language: "a", languageName: "American English", gender: "male" },
  { id: "am_liam", language: "a", languageName: "American English", gender: "male" },
  { id: "am_michael", language: "a", languageName: "American English", gender: "male" },
  { id: "am_onyx", language: "a", languageName: "American English", gender: "male" },
  { id: "am_puck", language: "a", languageName: "American English", gender: "male" },
  { id: "am_santa", language: "a", languageName: "American English", gender: "male" },
  { id: "bf_alice", language: "b", languageName: "British English", gender: "female" },
  { id: "bf_emma", language: "b", languageName: "British English", gender: "female" },
  { id: "bf_isabella", language: "b", languageName: "British English", gender: "female" },
  { id: "bf_lily", language: "b", languageName: "British English", gender: "female" },
  { id: "bm_daniel", language: "b", languageName: "British English", gender: "male" },
  { id: "bm_fable", language: "b", languageName: "British English", gender: "male" },
  { id: "bm_george", language: "b", languageName: "British English", gender: "male" },
  { id: "bm_lewis", language: "b", languageName: "British English", gender: "male" },
  { id: "ef_dora", language: "e", languageName: "Spanish", gender: "female" },
  { id: "em_alex", language: "e", languageName: "Spanish", gender: "male" },
  { id: "em_santa", language: "e", languageName: "Spanish", gender: "male" },
  { id: "ff_siwis", language: "f", languageName: "French", gender: "female" },
  { id: "hf_alpha", language: "h", languageName: "Hindi", gender: "female" },
  { id: "hf_beta", language: "h", languageName: "Hindi", gender: "female" },
  { id: "hm_omega", language: "h", languageName: "Hindi", gender: "male" },
  { id: "hm_psi", language: "h", languageName: "Hindi", gender: "male" },
  { id: "if_sara", language: "i", languageName: "Italian", gender: "female" },
  { id: "im_nicola", language: "i", languageName: "Italian", gender: "male" },
  { id: "jf_alpha", language: "j", languageName: "Japanese", gender: "female" },
  { id: "jf_gongitsune", language: "j", languageName: "Japanese", gender: "female" },
  { id: "jf_nezumi", language: "j", languageName: "Japanese", gender: "female" },
  { id: "jf_tebukuro", language: "j", languageName: "Japanese", gender: "female" },
  { id: "jm_kumo", language: "j", languageName: "Japanese", gender: "male" },
  { id: "pf_dora", language: "p", languageName: "Portuguese", gender: "female" },
  { id: "pm_alex", language: "p", languageName: "Portuguese", gender: "male" },
  { id: "pm_santa", language: "p", languageName: "Portuguese", gender: "male" },
  { id: "zf_xiaobei", language: "z", languageName: "Mandarin Chinese", gender: "female" },
  { id: "zf_xiaoni", language: "z", languageName: "Mandarin Chinese", gender: "female" },
  { id: "zf_xiaoxiao", language: "z", languageName: "Mandarin Chinese", gender: "female" },
  { id: "zf_xiaoyi", language: "z", languageName: "Mandarin Chinese", gender: "female" },
  { id: "zm_yunjian", language: "z", languageName: "Mandarin Chinese", gender: "male" },
  { id: "zm_yunxi", language: "z", languageName: "Mandarin Chinese", gender: "male" },
  { id: "zm_yunxia", language: "z", languageName: "Mandarin Chinese", gender: "male" },
  { id: "zm_yunyang", language: "z", languageName: "Mandarin Chinese", gender: "male" },
] as const;

const VOICE_IDS = new Set(KOKORO_VOICES.map((v) => v.id));

export function isKokoroVoice(voiceId: string): boolean {
  return VOICE_IDS.has(voiceId);
}

export function kokoroVoice(voiceId: string): KokoroVoice | undefined {
  return KOKORO_VOICES.find((v) => v.id === voiceId);
}

export function voicesByLanguage(language: KokoroLanguageCode): KokoroVoice[] {
  return KOKORO_VOICES.filter((v) => v.language === language);
}

export function voicesByLanguageAndGender(
  language: KokoroLanguageCode,
  gender: KokoroVoiceGender
): KokoroVoice[] {
  return KOKORO_VOICES.filter((v) => v.language === language && v.gender === gender);
}

const DEFAULT_NARRATOR_VOICE = "af_heart";

export function defaultNarratorVoice(): string {
  return DEFAULT_NARRATOR_VOICE;
}

export function languageCodeFromString(value: string): KokoroLanguageCode | undefined {
  const lower = value.trim().toLowerCase();
  const map: Record<string, KokoroLanguageCode> = {
    "en": "a",
    "en-us": "a",
    "english": "a",
    "en-gb": "b",
    "british": "b",
    "es": "e",
    "spanish": "e",
    "fr": "f",
    "french": "f",
    "hi": "h",
    "hindi": "h",
    "it": "i",
    "italian": "i",
    "pt": "p",
    "portuguese": "p",
    "ja": "j",
    "japanese": "j",
    "zh": "z",
    "chinese": "z",
    "mandarin": "z",
  };
  return map[lower];
}