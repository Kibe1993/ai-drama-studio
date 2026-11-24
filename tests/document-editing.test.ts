import { describe, expect, it } from "vitest";
import { toMarkdown, parseImport } from "@/lib/utils/documentExport";

describe("document export: toMarkdown", () => {
  it("converts a string directly", () => {
    expect(toMarkdown("hello world")).toBe("hello world");
  });

  it("converts a primitive to string", () => {
    expect(toMarkdown(42)).toBe("42");
    expect(toMarkdown(null)).toBe("null");
  });

  it("converts an object with string fields", () => {
    const result = toMarkdown({ title: "My Story", premise: "A test" });
    expect(result).toContain("## title");
    expect(result).toContain("My Story");
    expect(result).toContain("## premise");
    expect(result).toContain("A test");
  });

  it("skips null and undefined values", () => {
    const result = toMarkdown({ a: "keep", b: null, c: undefined, d: "also keep" });
    expect(result).toContain("keep");
    expect(result).toContain("also keep");
    expect(result).not.toContain("## b");
    expect(result).not.toContain("## c");
  });

  it("converts arrays of strings", () => {
    const result = toMarkdown({ themes: ["love", "loss", "redemption"] });
    expect(result).toContain("## themes");
    expect(result).toContain("- love");
    expect(result).toContain("- loss");
    expect(result).toContain("- redemption");
  });

  it("converts arrays of objects with title", () => {
    const result = toMarkdown({
      characters: [
        { title: "Ada", role: "protagonist", age: "30" },
        { title: "Father", role: "supporting", age: "55" },
      ],
    });
    expect(result).toContain("- **Ada**");
    expect(result).toContain("role: protagonist");
    expect(result).toContain("- **Father**");
    expect(result).toContain("role: supporting");
  });

  it("converts nested objects as JSON code blocks", () => {
    const result = toMarkdown({ metadata: { version: 1, author: "test" } });
    expect(result).toContain("## metadata");
    expect(result).toContain("```json");
    expect(result).toContain('"version": 1');
  });

  it("handles empty objects", () => {
    expect(toMarkdown({})).toBe("");
  });

  it("uses name or id as title when title is absent", () => {
    const result = toMarkdown({ items: [{ name: "Named", desc: "has name" }] });
    expect(result).toContain("- **Named**");
    expect(result).toContain("desc: has name");
  });
});

describe("document import: parseImport", () => {
  it("parses JSON content", () => {
    const result = parseImport('{"title":"Test","value":42}', "json");
    expect(result).toEqual({ title: "Test", value: 42 });
  });

  it("wraps markdown content with format metadata", () => {
    const result = parseImport("# Hello\n\nWorld", "markdown");
    expect(result.content).toBe("# Hello\n\nWorld");
    expect(result.format).toBe("markdown");
  });

  it("wraps plain text content with format metadata", () => {
    const result = parseImport("Just plain text", "text");
    expect(result.content).toBe("Just plain text");
    expect(result.format).toBe("text");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseImport("{invalid json", "json")).toThrow();
  });
});