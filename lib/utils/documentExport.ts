export function toMarkdown(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data);
  const obj = data as Record<string, unknown>;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      lines.push(`## ${key}`, "", value, "");
    } else if (Array.isArray(value)) {
      lines.push(`## ${key}`, "");
      for (const item of value) {
        if (typeof item === "string") {
          lines.push(`- ${item}`);
        } else if (item && typeof item === "object") {
          const itemObj = item as Record<string, unknown>;
          const title = itemObj.title ?? itemObj.name ?? itemObj.id ?? "Item";
          lines.push(`- **${title}**`);
          for (const [k, v] of Object.entries(itemObj)) {
            if (k === "title" || k === "name" || k === "id") continue;
            if (typeof v === "string" && v) lines.push(`  - ${k}: ${v}`);
          }
        }
      }
      lines.push("");
    } else if (typeof value === "object") {
      lines.push(`## ${key}`, "", "```json", JSON.stringify(value, null, 2), "```", "");
    }
  }
  return lines.join("\n");
}

export function parseImport(content: string, format: "markdown" | "json" | "text"): Record<string, unknown> {
  if (format === "json") {
    return JSON.parse(content);
  }
  return { content, format };
}