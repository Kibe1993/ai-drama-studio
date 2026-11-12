import { z } from "zod";
import { JobError } from "@/lib/pipeline/types";
import { parseStructured } from "@/lib/providers/llm/parse";
import type { StoryCallOptions, TokenUsage } from "@/lib/providers/llm/types";
import {
  STORY_BIBLE_SECTIONS,
  storyBibleCharactersSchema,
  storyBibleCanonSchema,
  storyBibleContentSchema,
  storyBibleGuidelinesSchema,
  storyBibleIdentitySchema,
  storyBibleNarrativeSchema,
  storyBibleWorldSchema,
  type StoryBibleContent,
  type StoryBibleSection,
  type StoryBibleSectionValue,
} from "@/lib/validation/storyBible";

export type StoryBibleTaskInput = {
  mode: "generate" | "regenerate" | "revise" | "section";
  title?: string;
  idea: string;
  creativeDirection?: string;
  instruction?: string;
  freshInterpretation?: boolean;
  section?: StoryBibleSection;
  current?: Partial<Record<StoryBibleSection, unknown>>;
  approved?: Partial<Record<StoryBibleSection, unknown>>;
  contextSections?: Partial<Record<StoryBibleSection, unknown>>;
  creatorDecisions?: string[];
  project?: {
    productionType: string;
    productionMode: string;
    genre: string;
    language: string;
    tone: string;
  };
};

export type StoryBibleTaskResult =
  | { mode: "complete"; content: StoryBibleContent }
  | { mode: "patch"; patch: Partial<StoryBibleContent> }
  | { mode: "section"; section: StoryBibleSection; value: StoryBibleSectionValue };

export type StoryBibleTaskTransport = {
  label: string;
  request(system: string, prompt: string, schema: Record<string, unknown>, signal: AbortSignal): Promise<{ text: string; usage?: TokenUsage }>;
};

type JsonSchema = Record<string, unknown>;
const str = (maxLength = 1200): JsonSchema => ({ type: "string", minLength: 1, maxLength });
const optionalStr = (maxLength = 600): JsonSchema => ({ type: "string", maxLength });
const strings = (maxItems = 6, maxLength = 400): JsonSchema => ({
  type: "array", items: str(maxLength), maxItems,
});
const obj = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
  type: "object", additionalProperties: false, properties, required,
});
const objects = (item: JsonSchema, minItems?: number, maxItems?: number): JsonSchema => ({
  type: "array",
  items: item,
  ...(minItems ? { minItems } : {}),
  ...(maxItems ? { maxItems } : {}),
});
// These caps keep a small local model from filling the generous validation
// limits; Zod still accepts any schema-valid richer content from other providers.
const identityJson = obj({
  title: str(120),
  genres: objects(str(80), 1, 3),
  subgenres: strings(4, 80),
  centralPremise: str(1500),
  narrativeConcept: str(1200),
  toneAndAtmosphere: str(600),
  targetAudience: str(400),
  centralConflict: str(800),
});
const worldJson = obj({
  description: str(800),
  geographyAndLocations: objects(obj({ name: str(80), description: str(300), storyFunction: str(180) }), 2, 3),
  socialStructuresAndCultures: strings(4, 250), historyAndPastEvents: strings(4, 250), rules: strings(4, 250),
  definingSystems: objects(obj({ name: str(80), description: str(300), limitations: strings(3, 180), consequences: strings(3, 180) }), 0, 2),
});
const charactersJson = obj({
  characters: objects(obj({
    name: str(80), storyRole: { type: "string", enum: ["protagonist", "antagonist", "supporting", "recurring"] },
    roleDescription: str(300), physicalDescription: optionalStr(400), personality: str(400), background: str(500),
    motivations: strings(3, 250), fearsAndWeaknesses: strings(3, 250), abilitiesAndLimitations: strings(3, 250),
    relationships: objects(obj({ characterName: str(80), relationship: str(250), tensionOrChange: str(300) }), 0, 4),
    secrets: strings(2, 250), developmentPotential: str(400),
  }), 2, 3),
  relationshipDynamics: strings(4, 250),
});
const narrativeJson = obj({
  mainStoryline: str(1000), majorConflicts: strings(4, 300), longTermDirection: str(800), subplots: strings(4, 300),
  unresolvedMysteries: strings(4, 300), potentialFutureRevelations: strings(3, 300), majorNarrativeQuestions: strings(3, 250),
  serializedEndingGuidance: str(500),
});
const guidelinesJson = obj({
  mainThemes: strings(4, 250), secondaryThemes: strings(3, 250), storytellingStyle: str(600),
  boundaries: strings(5, 250), mustRemainConsistent: strings(6, 250),
});
const canonJson = obj({
  confirmedFacts: strings(8, 300), proposedDetails: strings(5, 300), unresolvedQuestions: strings(5, 300),
  hiddenInformation: strings(4, 300),
  characterKnowledge: objects(obj({ characterName: str(80), knows: strings(3, 250), believes: strings(3, 250) }), 0, 4),
  audienceKnowledge: strings(5, 300),
});

export const STORY_BIBLE_CONTENT_RESPONSE_SCHEMA = obj({
  identity: identityJson,
  world: worldJson,
  characters: charactersJson,
  narrative: narrativeJson,
  guidelines: guidelinesJson,
  canon: canonJson,
});

const SECTION_SCHEMAS: Record<StoryBibleSection, JsonSchema> = {
  identity: identityJson,
  world: worldJson,
  characters: charactersJson,
  narrative: narrativeJson,
  guidelines: guidelinesJson,
  canon: canonJson,
};
const SECTION_VALIDATORS: Record<StoryBibleSection, z.ZodTypeAny> = {
  identity: storyBibleIdentitySchema,
  world: storyBibleWorldSchema,
  characters: storyBibleCharactersSchema,
  narrative: storyBibleNarrativeSchema,
  guidelines: storyBibleGuidelinesSchema,
  canon: storyBibleCanonSchema,
};

export function storyBibleSectionSchema(section: StoryBibleSection): z.ZodTypeAny {
  return SECTION_VALIDATORS[section];
}

const SECTION_GUIDANCE: Record<StoryBibleSection, string> = {
  identity:
    "Write only the series identity. Keep it to a title, genres, a premise and concept, tone, audience, and the central conflict. Do not invent character biographies or detailed world history here; later sections own those.",
  world:
    "Write only the world section. Describe 2-3 locations, at most 4 cultural notes, 4 past events, 4 rules, and 2 defining systems. Every rule should state what it permits, forbids, and causes. Keep every list item under 250 characters and stop adding items when the schema limit is reached. Reuse the established premise, conflict, and tone; do not add new major characters.",
  characters:
    "Write only the characters section. Include 2-3 major characters (at least 2) with distinct roles, wants, fears, contradictions, and relationships. Keep every profile concise: each list has at most 3 items, each item is under 250 characters, and background and development stay under 500 characters. Reuse established names, locations, and world rules; do not invent a replacement setting.",
  narrative:
    "Write only the narrative section. Build the serialized story engine (main storyline, conflicts, long-term direction, subplots, mysteries, future revelations) directly from the established world and characters. Keep every list to at most 4 items and each item under 300 characters. Do not contradict or replace them and do not resolve mysteries prematurely.",
  guidelines:
    "Write only the guidelines section. Derive themes, style, boundaries, and consistency rules from the established premise, world, characters, and narrative. Keep each list to at most 4-6 short items under 250 characters and make each rule actionable.",
  canon:
    "Write only the canon section. Separate facts already supported by earlier sections from proposals, open questions, and hidden information. Keep each list to at most 8 short items under 300 characters. Do not promote a guess to confirmed fact, and track who knows what.",
};

const patchSchema = z.object({
  identity: storyBibleIdentitySchema.optional(),
  world: storyBibleWorldSchema.optional(),
  characters: storyBibleCharactersSchema.optional(),
  narrative: storyBibleNarrativeSchema.optional(),
  guidelines: storyBibleGuidelinesSchema.optional(),
  canon: storyBibleCanonSchema.optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "Revision must update at least one section");

export function storyBibleResponseSchema(input: StoryBibleTaskInput): JsonSchema {
  if (input.mode === "section") {
    if (!input.section) throw new JobError("A Story Bible section is required.", "invalid_input", false);
    return SECTION_SCHEMAS[input.section];
  }
  if (input.mode === "revise") return obj({ patch: obj({
    identity: identityJson, world: worldJson, characters: charactersJson,
    narrative: narrativeJson, guidelines: guidelinesJson, canon: canonJson,
  }, [] ) });
  return obj({ content: STORY_BIBLE_CONTENT_RESPONSE_SCHEMA });
}

const COMPLETE_CONTENT_SHAPE = JSON.stringify({
  content: {
    identity: {
      title: "",
      genres: [""],
      subgenres: [""],
      centralPremise: "",
      narrativeConcept: "",
      toneAndAtmosphere: "",
      targetAudience: "",
      centralConflict: "",
    },
    world: {
      description: "",
      geographyAndLocations: [{ name: "", description: "", storyFunction: "" }],
      socialStructuresAndCultures: [""],
      historyAndPastEvents: [""],
      rules: [""],
      definingSystems: [{ name: "", description: "", limitations: [""], consequences: [""] }],
    },
    characters: {
      characters: [{
        name: "",
        storyRole: "protagonist",
        roleDescription: "",
        physicalDescription: "",
        personality: "",
        background: "",
        motivations: [""],
        fearsAndWeaknesses: [""],
        abilitiesAndLimitations: [""],
        relationships: [{ characterName: "", relationship: "", tensionOrChange: "" }],
        secrets: [""],
        developmentPotential: "",
      }],
      relationshipDynamics: [""],
    },
    narrative: {
      mainStoryline: "",
      majorConflicts: [""],
      longTermDirection: "",
      subplots: [""],
      unresolvedMysteries: [""],
      potentialFutureRevelations: [""],
      majorNarrativeQuestions: [""],
      serializedEndingGuidance: "",
    },
    guidelines: {
      mainThemes: [""],
      secondaryThemes: [""],
      storytellingStyle: "",
      boundaries: [""],
      mustRemainConsistent: [""],
    },
    canon: {
      confirmedFacts: [""],
      proposedDetails: [""],
      unresolvedQuestions: [""],
      hiddenInformation: [""],
      characterKnowledge: [{ characterName: "", knows: [""], believes: [""] }],
      audienceKnowledge: [""],
    },
  },
});

// Providers without schema enforcement (Groq uses json_object for the Story
// Bible) only see the prompt, so the exact section keys must be spelled out or
// they substitute synonyms such as "locations" for "geographyAndLocations".
function shapeExample(schema: JsonSchema): unknown {
  if (schema.type === "object") {
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    return Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, shapeExample(value)])
    );
  }
  if (schema.type === "array") {
    const items = schema.items as JsonSchema | undefined;
    return items ? [shapeExample(items)] : [];
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  return "";
}

function promptFor(input: StoryBibleTaskInput): { system: string; prompt: string } {
  const common = [
    "Develop a detailed series bible, not a short pitch or generic list.",
    "Make the world, locations, history, rules, consequences, character motives, relationships, conflicts, and long-term story direction causally connected and internally consistent.",
    "Give major characters distinct goals, fears, contradictions, relationships, and credible development potential. Include supporting characters and antagonists where the idea supports them; do not add a crowd of interchangeable names.",
    "Make world rules operational: explain what they permit, what they forbid, who benefits, who is harmed, and what happens when a rule is broken.",
    "Support a long-running serialized story. Leave room for future seasons and do not force a final ending.",
    "Separate established truth from proposal. Put only explicit or logically entailed facts in confirmedFacts. Put new creative inventions in proposedDetails. Keep mysteries unresolved in unresolvedQuestions and do not state a guessed solution as fact.",
    "Character knowledge and audience knowledge are different. Do not give every character knowledge they have not earned.",
    "Stay inside every field limit: descriptions and world-system entries at most 700 characters; character background at most 900; personality and developmentPotential at most 700; centralPremise at most 2000; narrativeConcept and mainStoryline at most 1800; longTermDirection at most 1500; toneAndAtmosphere, storytellingStyle, and serializedEndingGuidance at most 800; targetAudience at most 500; each list item at most 400 characters. Use complete sentences and never omit a required field to add more detail.",
    "Respect the creator's language and requested direction. Do not include markdown or commentary; return only the requested JSON.",
    "Never repeat a phrase, sentence, or list item. Write each field once, keep it concise, and stop when the schema limit is reached.",
    "When the task is a single section, stay inside that section, reuse the established names and facts supplied below, and do not repeat or regenerate other sections.",
  ];
  const modeText = input.mode === "generate"
    ? "Create a complete first proposal from the creator's idea. Do not assume the creator has pre-written world or character details."
    : input.mode === "regenerate"
      ? input.freshInterpretation
        ? "Create a fresh interpretation because the creator explicitly requested it. Preserve only the explicit creator instructions and any approved canon facts provided below."
        : "Regenerate the complete proposal while treating the current draft, approved bible, and recorded creator decisions as constraints. Preserve their established identities and facts; deepen and improve the proposal without casually replacing accepted choices."
      : input.mode === "revise"
        ? "Apply the natural-language revision as a minimal patch. Return only the sections that need to change. Never include unchanged sections in the patch. Preserve the current draft and approved decisions outside the requested change."
        : input.current
          ? `Regenerate only the ${input.section} section. Return the requested section and no other section. Preserve every unrelated decision; the application merges this section into the current proposal.`
          : `Generate the ${input.section} section for this new Story Bible. Return the requested section and no other section. Stay consistent with any sections already generated.`;
  const context = [
    `Mode: ${input.mode}`,
    `Working title: ${input.title?.trim() || "Let the story concept determine a compelling title"}`,
    `Production category: ${input.project?.productionType ?? "unspecified"}`,
    `Production mode: ${input.project?.productionMode ?? "serialized"}`,
    `Genre direction: ${input.project?.genre ?? "derive from idea"}`,
    `Language: ${input.project?.language ?? "en"}`,
    `Tone: ${input.project?.tone ?? "derive from idea"}`,
    `Creator idea: ${input.idea}`,
    input.creativeDirection ? `Creator's standing creative direction: ${input.creativeDirection}` : "",
    input.instruction ? `Current requested change: ${input.instruction}` : "",
    input.creatorDecisions?.length ? `Previously recorded creator decisions (preserve unless explicitly contradicted by the current request):\n${JSON.stringify(input.creatorDecisions)}` : "",
    input.approved ? `Previously approved canon (immutable in this operation):\n${JSON.stringify(input.approved)}` : "",
    input.current ? `Current draft to preserve and develop:\n${JSON.stringify(input.current)}` : "",
    input.contextSections ? `Established sections (stay consistent with them, reuse their names and facts, but do not repeat them):\n${JSON.stringify(input.contextSections)}` : "",
    input.mode === "section" && input.section ? `Section guidance:\n${SECTION_GUIDANCE[input.section]}` : "",
    modeText,
  ].filter(Boolean);
  const schemaInstruction = input.mode === "revise"
    ? "Return exactly {\"patch\": { ... }}. patch may contain only the changed keys from identity, world, characters, narrative, guidelines, canon and must contain at least one key. Each included value must be a complete valid section."
    : input.mode === "section" && input.section
    ? `Return only the ${input.section} section as one JSON object. Follow the section guidance above. Do not wrap it in "section" or "value" keys. Arrays of strings must contain plain strings, not objects. Every array item and every required text field must be non-empty.\nUse exactly these keys and nesting; do not rename, replace, or omit any of them:\n${JSON.stringify(shapeExample(SECTION_SCHEMAS[input.section]))}`
    : `Return exactly the JSON shape below. Every key shown must be present. Nested values must be JSON objects and arrays, not JSON-encoded strings. Replace every placeholder with real content and never leave a required text value empty. Every array item and every required text field must be non-empty. geographyAndLocations needs at least two entries; characters needs at least two entries.\n${COMPLETE_CONTENT_SHAPE}`;
  return {
    system: common.join(" "),
    prompt: [...context, "", "Required output contract:", schemaInstruction].join("\n"),
  };
}

function unwrapSection(section: StoryBibleSection, parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== section) return parsed;
  const value = record[section];
  return value && typeof value === "object" && !Array.isArray(value) ? value : parsed;
}

export async function requestStoryBible(
  transport: StoryBibleTaskTransport,
  input: StoryBibleTaskInput,
  options: StoryCallOptions = {}
): Promise<{ result: StoryBibleTaskResult; usage?: TokenUsage }> {
  const instructions = promptFor(input);
  // The outer signal only backstops provider transports, which enforce their own
  // timeouts. Sections keep a larger default because one small local model can
  // legitimately need more than the single-call budget.
  const defaultTimeoutMs = input.mode === "section" ? 360_000 : 90_000;
  const response = await transport.request(
    instructions.system,
    instructions.prompt,
    storyBibleResponseSchema(input),
    options.signal ?? AbortSignal.timeout(defaultTimeoutMs)
  );
  if (input.mode === "section") {
    const section = input.section;
    if (!section) throw new JobError("A Story Bible section is required.", "invalid_input", false);
    const parsed = parseStructured(
      transport.label,
      response.text,
      SECTION_VALIDATORS[section],
      `Story Bible ${section}`,
      (value) => unwrapSection(section, value)
    );
    return { result: { mode: "section", section, value: parsed as StoryBibleSectionValue }, usage: response.usage };
  }
  if (input.mode === "revise") {
    const parsed = parseStructured(transport.label, response.text, z.object({ patch: patchSchema }), "Story Bible revision");
    return { result: { mode: "patch", patch: parsed.patch as Partial<StoryBibleContent> }, usage: response.usage };
  }
  const parsed = parseStructured(transport.label, response.text, z.object({ content: storyBibleContentSchema }), "Story Bible");
  return { result: { mode: "complete", content: parsed.content as StoryBibleContent }, usage: response.usage };
}

export function mergeStoryBibleResult(current: StoryBibleContent | null, result: StoryBibleTaskResult): StoryBibleContent {
  if (result.mode === "complete") return result.content;
  if (!current) throw new JobError("A complete Story Bible is required before revising sections.", "dependency", false);
  if (result.mode === "patch") return storyBibleContentSchema.parse({ ...current, ...result.patch });
  return storyBibleContentSchema.parse({ ...current, [result.section]: result.value });
}

// A small model can overshoot a schema string length and keep writing
// JSON-looking tokens inside the string. Those fragments pass length checks but
// are not usable content, so they fail the section instead of being saved.
const JSON_ARTIFACTS = /(?:\}\s*){3,}|"\s*:\s*"/;

function hasJsonArtifacts(value: unknown): boolean {
  if (typeof value === "string") return JSON_ARTIFACTS.test(value);
  if (Array.isArray(value)) return value.some(hasJsonArtifacts);
  if (value && typeof value === "object") return Object.values(value).some(hasJsonArtifacts);
  return false;
}

export function validateStoryBibleTaskResult(input: StoryBibleTaskInput, value: unknown): StoryBibleTaskResult {
  if (input.mode === "section") {
    const section = input.section;
    if (!section) throw new JobError("A Story Bible section is required.", "invalid_input", false);
    const parsed = z.object({ mode: z.literal("section"), section: z.literal(section), value: SECTION_VALIDATORS[section] }).safeParse(value);
    if (!parsed.success) throw new JobError("The provider returned an invalid Story Bible section.", "invalid_schema", false);
    if (hasJsonArtifacts(parsed.data.value)) {
      throw new JobError("The provider returned a section with corrupted JSON fragments.", "invalid_schema", false);
    }
    return parsed.data as unknown as StoryBibleTaskResult;
  }
  if (input.mode === "revise") {
    const parsed = z.object({ mode: z.literal("patch"), patch: patchSchema }).safeParse(value);
    if (!parsed.success) throw new JobError("The provider returned an invalid Story Bible revision.", "invalid_schema", false);
    if (hasJsonArtifacts(parsed.data.patch)) {
      throw new JobError("The provider returned a revision with corrupted JSON fragments.", "invalid_schema", false);
    }
    return parsed.data as unknown as StoryBibleTaskResult;
  }
  const parsed = z.object({ mode: z.literal("complete"), content: storyBibleContentSchema }).safeParse(value);
  if (!parsed.success) throw new JobError("The provider returned an incomplete Story Bible.", "invalid_schema", false);
  return parsed.data as StoryBibleTaskResult;
}

export function isStoryBibleSection(value: string): value is StoryBibleSection {
  return (STORY_BIBLE_SECTIONS as readonly string[]).includes(value);
}
