import { z } from "zod";

const text = (max = 1200) => z.string().trim().min(1).max(max);
const optionalText = (max = 1200) => z.string().trim().max(max).default("");
const list = (maxItems: number, maxLength = 600) => z.array(text(maxLength)).max(maxItems);

export const storyBibleIdentitySchema = z.object({
  title: text(120),
  genres: z.array(text(80)).min(1).max(4),
  subgenres: z.array(text(80)).max(6),
  centralPremise: text(2000),
  narrativeConcept: text(1800),
  toneAndAtmosphere: text(1000),
  targetAudience: text(500),
  centralConflict: text(1200),
});

const locationSchema = z.object({ name: text(120), description: text(700), storyFunction: text(500) });
const worldSystemSchema = z.object({
  name: text(120),
  description: text(700),
  limitations: list(8, 400),
  consequences: list(8, 400),
});
const relationshipSchema = z.object({
  characterName: text(80),
  relationship: text(300),
  tensionOrChange: text(400),
});
const bibleCharacterSchema = z.object({
  name: text(80),
  storyRole: z.enum(["protagonist", "antagonist", "supporting", "recurring"]),
  roleDescription: text(400),
  physicalDescription: optionalText(600),
  personality: text(700),
  background: text(900),
  motivations: list(8, 400),
  fearsAndWeaknesses: list(8, 400),
  abilitiesAndLimitations: list(8, 400),
  relationships: z.array(relationshipSchema).max(12),
  secrets: list(6, 400),
  developmentPotential: text(700),
});

export const storyBibleWorldSchema = z.object({
  description: text(1800),
  geographyAndLocations: z.array(locationSchema).min(2).max(12),
  socialStructuresAndCultures: list(10, 700),
  historyAndPastEvents: list(12, 700),
  rules: list(16, 500),
  definingSystems: z.array(worldSystemSchema).max(8),
});

export const storyBibleCharactersSchema = z.object({
  characters: z.array(bibleCharacterSchema).min(2).max(16),
  relationshipDynamics: list(12, 500),
});

export const storyBibleNarrativeSchema = z.object({
  mainStoryline: text(1800),
  majorConflicts: list(10, 600),
  longTermDirection: text(1500),
  subplots: list(10, 600),
  unresolvedMysteries: list(10, 500),
  potentialFutureRevelations: list(10, 500),
  majorNarrativeQuestions: list(10, 400),
  serializedEndingGuidance: text(800),
});

export const storyBibleGuidelinesSchema = z.object({
  mainThemes: list(8, 400),
  secondaryThemes: list(10, 400),
  storytellingStyle: text(800),
  boundaries: list(16, 400),
  mustRemainConsistent: list(20, 400),
});

const knowledgeSchema = z.object({
  characterName: text(80),
  knows: list(10, 400),
  believes: list(10, 400),
});

export const storyBibleCanonSchema = z.object({
  confirmedFacts: list(40, 500),
  proposedDetails: list(30, 500),
  unresolvedQuestions: list(20, 400),
  hiddenInformation: list(16, 500),
  characterKnowledge: z.array(knowledgeSchema).max(16),
  audienceKnowledge: list(20, 400),
});

export const storyBibleContentSchema = z.object({
  identity: storyBibleIdentitySchema,
  world: storyBibleWorldSchema,
  characters: storyBibleCharactersSchema,
  narrative: storyBibleNarrativeSchema,
  guidelines: storyBibleGuidelinesSchema,
  canon: storyBibleCanonSchema,
});

export const STORY_BIBLE_SECTIONS = ["identity", "world", "characters", "narrative", "guidelines", "canon"] as const;
export type StoryBibleSection = (typeof STORY_BIBLE_SECTIONS)[number];
export type StoryBibleContent = z.infer<typeof storyBibleContentSchema>;
export type StoryBibleSectionValue = StoryBibleContent[StoryBibleSection];

// The original five fields remain first-class projections for old clients and
// snapshots. `content` is optional so existing manually-authored records parse.
export const storyBibleDraftSchema = z.object({
  premise: z.string().trim().max(2000).default(""),
  worldRules: z.array(z.string().trim().min(1).max(600)).max(20).default([]),
  themes: z.array(z.string().trim().min(1).max(600)).max(12).default([]),
  boundaries: z.array(z.string().trim().min(1).max(600)).max(20).default([]),
  canonFacts: z.array(z.string().trim().min(1).max(600)).max(60).default([]),
  content: storyBibleContentSchema.optional(),
  sourceIdea: z.string().trim().max(8000).optional().default(""),
  creativeDirection: z.string().trim().max(4000).optional().default(""),
  creatorDecisions: z.array(z.string().trim().min(1).max(1000)).max(40).optional().default([]),
});

export const storyBibleInputSchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
  idea: z.string().trim().min(1, "Add a story idea").max(8000),
  creativeDirection: z.string().trim().max(4000).optional().default(""),
});

export const storyBibleRevisionSchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
  freshInterpretation: z.boolean().optional().default(false),
});

export const storyBibleSectionRequestSchema = z.object({
  instruction: z.string().trim().max(1200).optional().default(""),
  freshInterpretation: z.boolean().optional().default(false),
});

export const storyBibleGenerationJobInputSchema = z.object({
  operation: z.enum(["generate", "regenerate", "revise", "section"]),
  expectedDraftRevision: z.number().int().nonnegative(),
  title: z.string().trim().max(120).default(""),
  idea: z.string().trim().min(1).max(8000),
  creativeDirection: z.string().trim().max(4000).default(""),
  instruction: z.string().trim().max(2000).default(""),
  section: z.enum(STORY_BIBLE_SECTIONS).optional(),
  freshInterpretation: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.operation === "section" && !value.section) {
    ctx.addIssue({ code: "custom", path: ["section"], message: "A section is required." });
  }
});
export type StoryBibleGenerationJobInput = z.infer<typeof storyBibleGenerationJobInputSchema>;

export const storyBibleApprovalSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  expectedDraftRevision: z.number().int().nonnegative(),
});

export type StoryBibleDraft = {
  premise: string;
  worldRules: string[];
  themes: string[];
  boundaries: string[];
  canonFacts: string[];
  content?: StoryBibleContent;
  sourceIdea?: string;
  creativeDirection?: string;
  creatorDecisions?: string[];
};
export type StoryBibleInput = z.infer<typeof storyBibleInputSchema>;
export type StoryBibleSnapshot = StoryBibleDraft & { version: number; createdAt: string };
export type StoryBibleGenerationStatus = "idle" | "queued" | "processing" | "failed";
export type StoryBibleRecord = {
  premise: string;
  worldRules: string[];
  themes: string[];
  boundaries: string[];
  canonFacts: string[];
  content?: StoryBibleContent;
  sourceIdea: string;
  creativeDirection: string;
  creatorDecisions: string[];
  id: string;
  clerkUserId: string;
  projectId: string;
  approvedVersion: number;
  draftRevision: number;
  /** The story draft this Bible was approved from, used to detect stale canon. */
  basedOnStoryId: string | null;
  approvedSnapshot: StoryBibleSnapshot | null;
  approvedSnapshots: StoryBibleSnapshot[];
  generationStatus: StoryBibleGenerationStatus;
  generationJobId: string | null;
  generationError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function legacyStoryBibleFields(content: StoryBibleContent) {
  return {
    premise: content.identity.centralPremise,
    worldRules: content.world.rules.slice(0, 20),
    themes: [...content.guidelines.mainThemes, ...content.guidelines.secondaryThemes].slice(0, 12),
    boundaries: content.guidelines.boundaries.slice(0, 20),
    canonFacts: content.canon.confirmedFacts.slice(0, 40),
  };
}
