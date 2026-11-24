import { storyBibleDraftSchema, storyBibleContentSchema, STORY_BIBLE_SECTIONS, type StoryBibleDraft, type StoryBibleSection } from "@/lib/validation/storyBible";

const SECTION_LABELS: Record<string, StoryBibleSection> = {
  identity: "identity",
  world: "world",
  characters: "characters",
  narrative: "narrative",
  guidelines: "guidelines",
  canon: "canon",
  "series identity": "identity",
  "world and setting": "world",
  "characters and relationships": "characters",
  "narrative direction": "narrative",
  "creative guidelines": "guidelines",
  "canon and knowledge": "canon",
};

export type ImportResult = {
  draft: StoryBibleDraft;
  warnings: string[];
};

export function importStoryBible(content: string, format: "markdown" | "json" | "text"): ImportResult {
  if (format === "json") return importJson(content);
  if (format === "markdown") return importMarkdown(content);
  return importText(content);
}

function importJson(content: string): ImportResult {
  const parsed: unknown = JSON.parse(content);
  const result = storyBibleDraftSchema.safeParse(parsed);
  if (result.success) return { draft: result.data, warnings: [] };
  const contentResult = storyBibleContentSchema.safeParse(parsed);
  if (contentResult.success) {
    return {
      draft: { premise: "", worldRules: [], themes: [], boundaries: [], canonFacts: [], content: contentResult.data, sourceIdea: "", creativeDirection: "", creatorDecisions: [] },
      warnings: [],
    };
  }
  if (parsed && typeof parsed === "object" && "content" in (parsed as Record<string, unknown>)) {
    const outer = storyBibleDraftSchema.safeParse(parsed);
    if (outer.success) return { draft: outer.data, warnings: [] };
  }
  throw new Error(`Invalid JSON Story Bible: ${result.error.issues[0]?.message ?? "structure not recognized"}`);
}

function importMarkdown(content: string): ImportResult {
  const sections = parseMarkdownSections(content);
  const warnings: string[] = [];
  if (sections.size === 0) return importText(content);
  const contentObj: Record<string, unknown> = {};
  for (const [label, body] of sections) {
    const section = SECTION_LABELS[label.toLowerCase()];
    if (!section) continue;
    const parsed = parseSectionBody(body);
    if (parsed !== undefined) contentObj[section] = parsed;
  }
  const knownSections = Object.keys(contentObj).filter((k) => STORY_BIBLE_SECTIONS.includes(k as StoryBibleSection));
  if (knownSections.length === 0) return importText(content);
  const missing = STORY_BIBLE_SECTIONS.filter((s) => !knownSections.includes(s));
  if (missing.length > 0) warnings.push(`Missing sections: ${missing.join(", ")}. Only ${knownSections.join(", ")} were found.`);
  const contentResult = storyBibleContentSchema.safeParse(contentObj);
  if (contentResult.success) {
    return {
      draft: { premise: "", worldRules: [], themes: [], boundaries: [], canonFacts: [], content: contentResult.data, sourceIdea: content, creativeDirection: "", creatorDecisions: [] },
      warnings,
    };
  }
  const draftFields = extractLegacyFields(content);
  return {
    draft: { ...draftFields, sourceIdea: content, creativeDirection: "", creatorDecisions: [] },
    warnings: [...warnings, `Section validation failed: ${contentResult.error.issues[0]?.message ?? "partial content imported into legacy fields"}`],
  };
}

function importText(content: string): ImportResult {
  return {
    draft: { premise: content.trim(), worldRules: [], themes: [], boundaries: [], canonFacts: [], sourceIdea: content.trim(), creativeDirection: "", creatorDecisions: [] },
    warnings: ["Imported as plain text — content placed in premise field. Use JSON or structured Markdown for full six-section import."],
  };
}

function parseMarkdownSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split("\n");
  let currentHeader: string | null = null;
  let currentBody: string[] = [];
  for (const line of lines) {
    const headerMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headerMatch) {
      if (currentHeader) sections.set(currentHeader, currentBody.join("\n").trim());
      currentHeader = headerMatch[1];
      currentBody = [];
    } else if (currentHeader) {
      currentBody.push(line);
    }
  }
  if (currentHeader) sections.set(currentHeader, currentBody.join("\n").trim());
  return sections;
}

function parseSectionBody(body: string): unknown {
  const jsonBlockMatch = /```json\s*\n([\s\S]*?)\n```/.exec(body);
  if (jsonBlockMatch) {
    try { return JSON.parse(jsonBlockMatch[1]); } catch { /* fall through */ }
  }
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  const bulletLines = trimmed.split("\n").filter((l) => l.startsWith("- "));
  if (bulletLines.length > 0) return bulletLines.map((l) => l.slice(2).trim());
  return trimmed || undefined;
}

function extractLegacyFields(content: string): { premise: string; worldRules: string[]; themes: string[]; boundaries: string[]; canonFacts: string[] } {
  const sections = parseMarkdownSections(content);
  const get = (labels: string[]): string => {
    for (const label of labels) {
      const body = sections.get(label);
      if (body) return body;
    }
    return "";
  };
  return {
    premise: get(["Premise", "premise", "Identity", "identity"]) || content.trim().slice(0, 2000),
    worldRules: getList(sections, ["World rules", "world rules", "Rules", "rules"]),
    themes: getList(sections, ["Themes", "themes", "Main themes", "main themes"]),
    boundaries: getList(sections, ["Boundaries", "boundaries", "Story boundaries", "story boundaries"]),
    canonFacts: getList(sections, ["Canon facts", "canon facts", "Confirmed facts", "confirmed facts"]),
  };
}

function getList(sections: Map<string, string>, labels: string[]): string[] {
  for (const label of labels) {
    const body = sections.get(label);
    if (body) return body.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  }
  return [];
}