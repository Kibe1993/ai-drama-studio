import type { StoryBibleContent } from "@/lib/validation/storyBible";

export type RevisionDiagnostic = {
  code: string;
  message: string;
  section?: string;
  field?: string;
};

export type RevisionValidationResult = {
  passed: boolean;
  diagnostics: RevisionDiagnostic[];
};

function ok(): RevisionValidationResult {
  return { passed: true, diagnostics: [] };
}


const MERGED_SENTENCE = /\.[a-z]/;
const DOUBLE_PUNCT = /\.[A-Z][a-z]/;

function detectMergedText(value: unknown, path: string, section: string, field: string, diagnostics: RevisionDiagnostic[]): void {
  if (typeof value === "string") {
    if (MERGED_SENTENCE.test(value) && !DOUBLE_PUNCT.test(value)) {
      const match = value.match(MERGED_SENTENCE);
      if (match && match.index !== undefined) {
        const fragment = value.slice(Math.max(0, match.index - 20), match.index + 30);
        diagnostics.push({
          code: "merged_text",
          message: `Text appears to contain merged sentences without spacing: "...${fragment}..."`,
          section,
          field: `${path}`,
        });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      detectMergedText(value[i], `${path}[${i}]`, section, field, diagnostics);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      detectMergedText(child, path ? `${path}.${key}` : key, section, field, diagnostics);
    }
  }
}

function validateTextIntegrity(content: StoryBibleContent): RevisionDiagnostic[] {
  const diagnostics: RevisionDiagnostic[] = [];
  for (const section of Object.keys(content) as (keyof StoryBibleContent)[]) {
    detectMergedText(content[section], "", section, section, diagnostics);
  }
  return diagnostics;
}

function validateCanonConsistency(
  original: StoryBibleContent | null,
  revised: StoryBibleContent,
): RevisionDiagnostic[] {
  const diagnostics: RevisionDiagnostic[] = [];
  if (!original) return diagnostics;

  const originalConfirmed = new Set(original.canon.confirmedFacts.map((f) => f.toLowerCase().trim()));
  const revisedConfirmed = new Set(revised.canon.confirmedFacts.map((f) => f.toLowerCase().trim()));
  const originalProposed = new Set(original.canon.proposedDetails.map((d) => d.toLowerCase().trim()));
  const revisedProposed = new Set(revised.canon.proposedDetails.map((d) => d.toLowerCase().trim()));

  for (const fact of originalConfirmed) {
    if (!revisedConfirmed.has(fact) && !revisedProposed.has(fact)) {
      diagnostics.push({
        code: "lost_confirmed_fact",
        message: `An established confirmed fact was removed without authorization: "${fact.slice(0, 80)}"`,
        section: "canon",
        field: "confirmedFacts",
      });
    }
  }

  for (const proposed of originalProposed) {
    if (revisedConfirmed.has(proposed)) {
      diagnostics.push({
        code: "unauthorized_promotion",
        message: `A proposed detail was promoted to confirmed canon without explicit authorization: "${proposed.slice(0, 80)}"`,
        section: "canon",
        field: "confirmedFacts",
      });
    }
  }

  const originalQuestions = new Set(original.canon.unresolvedQuestions.map((q) => q.toLowerCase().trim()));
  const revisedConfirmedArray = revised.canon.confirmedFacts.map((f) => f.toLowerCase().trim());
  for (const question of originalQuestions) {
    for (const confirmed of revisedConfirmedArray) {
      if (confirmed.includes(question.slice(0, 40)) || question.includes(confirmed.slice(0, 40))) {
        diagnostics.push({
          code: "question_resolved",
          message: `An unresolved question appears to have been answered as confirmed fact: "${question.slice(0, 80)}"`,
          section: "canon",
          field: "confirmedFacts",
        });
        break;
      }
    }
  }

  return diagnostics;
}

function validateCharacterKnowledge(
  original: StoryBibleContent | null,
  revised: StoryBibleContent,
): RevisionDiagnostic[] {
  const diagnostics: RevisionDiagnostic[] = [];
  if (!original) return diagnostics;
  const originalKnown = original.canon.characterKnowledge.map((k) => ({
    name: k.characterName,
    key: k.characterName.toLowerCase().trim(),
  }));
  if (originalKnown.length === 0) return diagnostics;
  const revisedKnownNames = new Set(
    revised.canon.characterKnowledge.map((k) => k.characterName.toLowerCase().trim()),
  );
  for (const { name, key } of originalKnown) {
    if (!revisedKnownNames.has(key)) {
      diagnostics.push({
        code: "missing_character_knowledge",
        message: `Character knowledge record was lost for: ${name}`,
        section: "canon",
        field: "characterKnowledge",
      });
    }
  }
  return diagnostics;
}

function validateRevisionPreservation(
  original: StoryBibleContent | null,
  revised: StoryBibleContent,
): RevisionDiagnostic[] {
  const diagnostics: RevisionDiagnostic[] = [];
  if (!original) return diagnostics;

  const originalNames = new Set(original.characters.characters.map((c) => c.name.toLowerCase().trim()));
  const revisedNames = new Set(revised.characters.characters.map((c) => c.name.toLowerCase().trim()));
  for (const name of originalNames) {
    if (!revisedNames.has(name)) {
      diagnostics.push({
        code: "lost_character",
        message: `An established character was removed: "${name}"`,
        section: "characters",
        field: "characters",
      });
    }
  }

  const originalBoundaries = new Set(original.guidelines.boundaries.map((b) => b.toLowerCase().trim()));
  const revisedBoundaries = new Set(revised.guidelines.boundaries.map((b) => b.toLowerCase().trim()));
  for (const boundary of originalBoundaries) {
    if (!revisedBoundaries.has(boundary)) {
      diagnostics.push({
        code: "lost_boundary",
        message: `An established narrative boundary was removed: "${boundary.slice(0, 80)}"`,
        section: "guidelines",
        field: "boundaries",
      });
    }
  }

  const originalConsistent = new Set(original.guidelines.mustRemainConsistent.map((c) => c.toLowerCase().trim()));
  const revisedConsistent = new Set(revised.guidelines.mustRemainConsistent.map((c) => c.toLowerCase().trim()));
  for (const item of originalConsistent) {
    if (!revisedConsistent.has(item)) {
      diagnostics.push({
        code: "lost_consistency_constraint",
        message: `An established consistency constraint was removed: "${item.slice(0, 80)}"`,
        section: "guidelines",
        field: "mustRemainConsistent",
      });
    }
  }

  return diagnostics;
}

export type RevisionValidationOptions = {
  original?: StoryBibleContent | null;
  requiredCharacters?: string[];
  skipCanonCheck?: boolean;
  skipPreservationCheck?: boolean;
  skipCharacterKnowledgeCheck?: boolean;
};

export function validateStoryBibleRevision(
  revised: StoryBibleContent,
  options: RevisionValidationOptions = {},
): RevisionValidationResult {
  const allDiagnostics: RevisionDiagnostic[] = [];
  const isRevision = options.original != null;

  allDiagnostics.push(...validateTextIntegrity(revised));

  if (!options.skipCanonCheck) {
    allDiagnostics.push(...validateCanonConsistency(options.original ?? null, revised));
  }

  if (isRevision && !options.skipCharacterKnowledgeCheck) {
    allDiagnostics.push(...validateCharacterKnowledge(options.original ?? null, revised));
  }

  if (!options.skipPreservationCheck) {
    allDiagnostics.push(...validateRevisionPreservation(options.original ?? null, revised));
  }

  if (allDiagnostics.length === 0) return ok();
  return { passed: false, diagnostics: allDiagnostics };
}

export function hasMergedText(value: string): boolean {
  return MERGED_SENTENCE.test(value) && !DOUBLE_PUNCT.test(value);
}