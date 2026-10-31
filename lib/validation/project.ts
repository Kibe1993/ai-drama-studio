import { z } from "zod";
import {
  ASPECT_RATIOS,
  GENRES,
  LANGUAGES,
  VISUAL_STYLES,
} from "@/lib/domain/projectCatalog";

const genreIds = GENRES.map((item) => item.id) as [
  (typeof GENRES)[number]["id"],
  ...(typeof GENRES)[number]["id"][],
];
const languageIds = LANGUAGES.map((item) => item.id) as [
  (typeof LANGUAGES)[number]["id"],
  ...(typeof LANGUAGES)[number]["id"][],
];
const styleIds = VISUAL_STYLES.map((item) => item.id) as [
  (typeof VISUAL_STYLES)[number]["id"],
  ...(typeof VISUAL_STYLES)[number]["id"][],
];
const ratioIds = ASPECT_RATIOS.map((item) => item.id) as [
  (typeof ASPECT_RATIOS)[number]["id"],
  ...(typeof ASPECT_RATIOS)[number]["id"][],
];
export const projectInputSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(120),
  originalStoryIdea: z.string().trim().max(8000).default(""),
  genre: z.enum(genreIds),
  language: z.enum(languageIds),
  visualStyle: z.enum(styleIds),
  tone: z.string().trim().min(1).max(80).default("dramatic"),
  targetDurationSeconds: z.union([z.literal(60), z.literal(120), z.literal(180)]),
  aspectRatio: z.enum(ratioIds),
});

export const projectUpdateSchema = projectInputSchema;

export const accountUpdateSchema = z.object({
  language: z.enum(languageIds),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/);
