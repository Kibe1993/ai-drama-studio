import { describe, expect, it } from "vitest";
import {
  KOKORO_VOICES,
  KOKORO_LANGUAGE_NAMES,
  isKokoroVoice,
  kokoroVoice,
  voicesByLanguage,
  voicesByLanguageAndGender,
  defaultNarratorVoice,
  languageCodeFromString,
} from "@/lib/providers/media/audio/kokoroVoices";

describe("kokoro voice catalog", () => {
  it("contains 54 voices", () => {
    expect(KOKORO_VOICES).toHaveLength(54);
  });

  it("has af_heart as the first voice", () => {
    expect(KOKORO_VOICES[0].id).toBe("af_heart");
  });

  it("classifies American English voices correctly", () => {
    const american = voicesByLanguage("a");
    expect(american.length).toBe(20);
    const females = voicesByLanguageAndGender("a", "female");
    const males = voicesByLanguageAndGender("a", "male");
    expect(females.length).toBe(11);
    expect(males.length).toBe(9);
  });

  it("classifies British English voices correctly", () => {
    const british = voicesByLanguage("b");
    expect(british.length).toBe(8);
    expect(voicesByLanguageAndGender("b", "female").length).toBe(4);
    expect(voicesByLanguageAndGender("b", "male").length).toBe(4);
  });

  it("includes all 9 languages", () => {
    const languages = new Set(KOKORO_VOICES.map((v) => v.language));
    expect(languages.size).toBe(9);
    expect(languages.has("a")).toBe(true);
    expect(languages.has("b")).toBe(true);
    expect(languages.has("e")).toBe(true);
    expect(languages.has("f")).toBe(true);
    expect(languages.has("h")).toBe(true);
    expect(languages.has("i")).toBe(true);
    expect(languages.has("p")).toBe(true);
    expect(languages.has("j")).toBe(true);
    expect(languages.has("z")).toBe(true);
  });

  it("validates voice IDs", () => {
    expect(isKokoroVoice("af_heart")).toBe(true);
    expect(isKokoroVoice("am_adam")).toBe(true);
    expect(isKokoroVoice("zf_xiaobei")).toBe(true);
    expect(isKokoroVoice("invalid_voice")).toBe(false);
    expect(isKokoroVoice("")).toBe(false);
  });

  it("looks up a voice by ID", () => {
    const voice = kokoroVoice("af_heart");
    expect(voice).toBeDefined();
    expect(voice?.language).toBe("a");
    expect(voice?.gender).toBe("female");
    expect(voice?.languageName).toBe("American English");
  });

  it("returns the default narrator voice", () => {
    expect(defaultNarratorVoice()).toBe("af_heart");
  });

  it("maps language names to codes", () => {
    expect(languageCodeFromString("en")).toBe("a");
    expect(languageCodeFromString("EN-US")).toBe("a");
    expect(languageCodeFromString("english")).toBe("a");
    expect(languageCodeFromString("en-gb")).toBe("b");
    expect(languageCodeFromString("es")).toBe("e");
    expect(languageCodeFromString("fr")).toBe("f");
    expect(languageCodeFromString("zh")).toBe("z");
    expect(languageCodeFromString("unknown")).toBeUndefined();
  });

  it("has language names for all codes", () => {
    for (const voice of KOKORO_VOICES) {
      expect(KOKORO_LANGUAGE_NAMES[voice.language]).toBe(voice.languageName);
    }
  });

  it("every voice ID follows the language+gender pattern", () => {
    for (const voice of KOKORO_VOICES) {
      expect(voice.id[0]).toBe(voice.language);
      expect(voice.id[1]).toBe(voice.gender === "female" ? "f" : "m");
    }
  });
});