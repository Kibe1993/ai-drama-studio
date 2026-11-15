import { describe, expect, it } from "vitest";
import { assertCharacters } from "@/lib/providers/llm/stageTasks";
import {
  resolveCharacterName,
  buildCharacterNameResolver,
  type CharacterProfile,
} from "@/lib/validation/productionStages";
import type { ScreenplayScene } from "@/lib/validation/story";

function makeScreenplay(names: string[]): ScreenplayScene[] {
  return [
    {
      sceneNumber: 1,
      heading: "INT. KITCHEN - NIGHT",
      location: "Kitchen",
      timeOfDay: "Night",
      charactersPresent: names,
      visualDescription: "A dim kitchen.",
      action: "Characters talk.",
      dialogue: names.map((name) => ({ characterName: name, line: `I am ${name}.` })),
    },
  ];
}

function makeCharacter(name: string, aliases: string[] = []): CharacterProfile {
  return {
    name,
    role: "",
    ageRange: "",
    gender: "",
    personality: "",
    physicalDescription: "",
    clothing: "",
    distinguishingFeatures: "",
    background: "",
    relationships: [],
    aliases: aliases.map((alias) => ({ name: alias, type: "alias" as const, description: "" })),
    voiceManifestations: [],
  };
}

describe("Character Architecture", () => {
  describe("assertCharacters with aliases", () => {
    it("passes when a screenplay name is an alias of a character", () => {
      const screenplay = makeScreenplay(["Amara", "Phone Voice"]);
      const characters = [makeCharacter("Amara", ["Phone Voice"])];
      expect(() => assertCharacters(screenplay, characters)).not.toThrow();
    });

    it("fails when an alias is duplicated as a separate character", () => {
      const screenplay = makeScreenplay(["Amara", "Phone Voice"]);
      const characters = [makeCharacter("Amara", ["Phone Voice"]), makeCharacter("Phone Voice")];
      expect(() => assertCharacters(screenplay, characters)).toThrow(/Alias.*duplicates a character name/);
    });

    it("fails when the same alias is shared by two characters", () => {
      const screenplay = makeScreenplay(["Amara", "Kofi", "Shadow"]);
      const characters = [
        makeCharacter("Amara", ["Shadow"]),
        makeCharacter("Kofi", ["Shadow"]),
      ];
      expect(() => assertCharacters(screenplay, characters)).toThrow(/Alias.*shared by two characters/);
    });

    it("fails when a character is in the screenplay but not in the character list or aliases", () => {
      const screenplay = makeScreenplay(["Amara", "Unknown"]);
      const characters = [makeCharacter("Amara")];
      expect(() => assertCharacters(screenplay, characters)).toThrow(/omitted someone/);
    });

    it("passes when all screenplay names match characters or their aliases", () => {
      const screenplay = makeScreenplay(["Amara", "Kofi", "The Informant"]);
      const characters = [
        makeCharacter("Amara"),
        makeCharacter("Kofi", ["The Informant"]),
      ];
      expect(() => assertCharacters(screenplay, characters)).not.toThrow();
    });

    it("fails when a character has a name not in the screenplay", () => {
      const screenplay = makeScreenplay(["Amara"]);
      const characters = [makeCharacter("Amara"), makeCharacter("Ghost")];
      expect(() => assertCharacters(screenplay, characters)).toThrow(/added someone who is not/);
    });
  });

  describe("resolveCharacterName", () => {
    it("resolves a canonical name to itself", () => {
      const characters = [makeCharacter("Amara", ["Phone Voice"])];
      expect(resolveCharacterName("Amara", characters)).toBe("Amara");
    });

    it("resolves an alias to the canonical name", () => {
      const characters = [makeCharacter("Amara", ["Phone Voice"])];
      expect(resolveCharacterName("Phone Voice", characters)).toBe("Amara");
    });

    it("returns the original name when no match is found", () => {
      const characters = [makeCharacter("Amara")];
      expect(resolveCharacterName("Unknown", characters)).toBe("Unknown");
    });

    it("is case-insensitive", () => {
      const characters = [makeCharacter("Amara", ["Phone Voice"])];
      expect(resolveCharacterName("phone voice", characters)).toBe("Amara");
    });
  });

  describe("buildCharacterNameResolver", () => {
    it("builds a map from all names to canonical names", () => {
      const characters = [
        makeCharacter("Amara", ["Phone Voice", "The Stranger"]),
        makeCharacter("Kofi"),
      ];
      const resolver = buildCharacterNameResolver(characters);
      expect(resolver.get("amara")).toBe("Amara");
      expect(resolver.get("phone voice")).toBe("Amara");
      expect(resolver.get("the stranger")).toBe("Amara");
      expect(resolver.get("kofi")).toBe("Kofi");
    });

    it("handles characters with no aliases", () => {
      const characters = [makeCharacter("Amara")];
      const resolver = buildCharacterNameResolver(characters);
      expect(resolver.get("amara")).toBe("Amara");
      expect(resolver.size).toBe(1);
    });
  });
});