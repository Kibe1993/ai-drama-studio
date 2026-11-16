const HONORIFICS = new Set([
  "dr", "doctor", "mr", "mrs", "ms", "miss", "prof", "professor", "sir", "lady",
]);

export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentTokens(value: string): string[] {
  return normalizeName(value).split(" ").filter((token) => token.length > 0 && !HONORIFICS.has(token));
}

export function includesText(haystack: string, needle: string): boolean {
  const left = haystack.toLocaleLowerCase();
  const right = needle.trim().toLocaleLowerCase();
  return right.length > 0 && left.includes(right);
}

export function extractDates(text: string): string[] {
  return text.match(/\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/g) ?? [];
}

export function windowAround(text: string, phrase: string, radius = 80): string {
  const haystack = text.toLocaleLowerCase();
  const needle = phrase.toLocaleLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) return "";
  return haystack.slice(Math.max(0, index - radius), index + needle.length + radius);
}

export function slugId(kind: string, name: string): string {
  const slug = normalizeName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unnamed";
  return `${kind}:${slug}`.slice(0, 160);
}
