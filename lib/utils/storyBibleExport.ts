import { STORY_BIBLE_SECTIONS, type StoryBibleContent, type StoryBibleRecord, type StoryBibleSection } from "@/lib/validation/storyBible";

const SECTION_LABELS: Record<StoryBibleSection, string> = {
  identity: "Series identity",
  world: "World and setting",
  characters: "Characters and relationships",
  narrative: "Narrative direction",
  guidelines: "Creative guidelines",
  canon: "Canon and knowledge",
};

export function storyBibleToMarkdown(bible: StoryBibleRecord): string {
  const lines: string[] = [];
  lines.push("# Story Bible", "");
  if (bible.content?.identity.title) {
    lines.push(`**${bible.content.identity.title}**`, "");
  }
  lines.push(`Approved version: ${bible.approvedVersion || "none"} · draft revision ${bible.draftRevision}`, "");
  if (bible.content) {
    for (const section of STORY_BIBLE_SECTIONS) {
      const value = bible.content[section];
      lines.push(`## ${SECTION_LABELS[section]}`, "");
      lines.push(...renderValue(value, 0));
      lines.push("");
    }
  }
  if (bible.premise || bible.worldRules.length || bible.themes.length || bible.boundaries.length || bible.canonFacts.length) {
    lines.push("## Legacy fields", "");
    if (bible.premise) { lines.push("### Premise", "", bible.premise, ""); }
    if (bible.worldRules.length) { lines.push("### World rules", ""); for (const r of bible.worldRules) lines.push(`- ${r}`); lines.push(""); }
    if (bible.themes.length) { lines.push("### Themes", ""); for (const t of bible.themes) lines.push(`- ${t}`); lines.push(""); }
    if (bible.boundaries.length) { lines.push("### Boundaries", ""); for (const b of bible.boundaries) lines.push(`- ${b}`); lines.push(""); }
    if (bible.canonFacts.length) { lines.push("### Canon facts", ""); for (const c of bible.canonFacts) lines.push(`- ${c}`); lines.push(""); }
  }
  return lines.join("\n");
}

function renderValue(value: unknown, depth: number): string[] {
  if (value === null || value === undefined) return ["_Not specified_"];
  if (typeof value === "string") return [value || "_Not specified_"];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) {
    if (value.length === 0) return ["_None specified_"];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === "string") out.push(`- ${item}`);
      else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const title = String(obj.title ?? obj.name ?? obj.characterName ?? "Item");
        out.push(`- **${title}**`);
        for (const [k, v] of Object.entries(obj)) {
          if (k === "title" || k === "name" || k === "characterName") continue;
          out.push(...renderField(k, v, depth + 1));
        }
      } else out.push(`- ${String(item)}`);
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(...renderField(k, v, depth));
    }
    return out;
  }
  return [String(value)];
}

function renderField(key: string, value: unknown, depth: number): string[] {
  const label = key.replace(/[A-Z]/g, (l) => ` ${l.toLowerCase()}`);
  const indent = "  ".repeat(depth);
  if (value === null || value === undefined || value === "") return [`${indent}- **${label}**: _Not specified_`];
  if (typeof value === "string") return [`${indent}- **${label}**: ${value}`];
  if (typeof value === "number" || typeof value === "boolean") return [`${indent}- **${label}**: ${String(value)}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}- **${label}**: _None specified_`];
    const out: string[] = [`${indent}- **${label}**:`];
    for (const item of value) {
      if (typeof item === "string") out.push(`${indent}  - ${item}`);
      else out.push(...renderValue([item], depth + 1).map((l) => `${indent}  ${l}`));
    }
    return out;
  }
  if (value && typeof value === "object") {
    return [`${indent}- **${label}**:`, ...renderValue(value, depth + 1).map((l) => `${indent}  ${l}`)];
  }
  return [`${indent}- **${label}**: ${String(value)}`];
}

export function storyBibleFilename(projectTitle: string, ext: "json" | "md"): string {
  const safe = projectTitle.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "story-bible";
  return `${safe}-story-bible.${ext}`;
}