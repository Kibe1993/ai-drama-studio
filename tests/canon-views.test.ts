import { describe, expect, it } from "vitest";
import { buildCanonView, buildCanonViewForEpisode, type CanonViewInput } from "@/lib/canon/views";
import { storyUserPrompt } from "@/lib/providers/llm/prompt";
import type { StoryPrompt } from "@/lib/providers/llm/types";

const baseInput: Omit<CanonViewInput, "purpose"> = {
  bibleContext: "Characters: Alice, Bob. World: modern city.",
  narrativeAuthority: "NARRATIVE AUTHORITY. The application owns canon.\nPriority 2 — Approved canonical facts:\n- Alice is dead.",
  continuityContext: "Prior episode: Alice was seen alive.",
  seasonPlan: { seasonObjective: "Find the truth" },
  episodePlan: { episodeNumber: 2 },
  continuityLedger: { events: [] },
  previousEpisode: { episodeNumber: 1, title: "Pilot", synopsis: "Alice appears." },
};

describe("Canon views", () => {
  it("builds a unified authority with explicit precedence order", () => {
    const view = buildCanonView({ ...baseInput, purpose: "episode_writer" });
    expect(view.hasAuthority).toBe(true);
    expect(view.authority).toContain("CANON AUTHORITY for Episode Writing");
    expect(view.authority).toContain("1. STORY BIBLE (highest precedence");
    expect(view.authority).toContain("2. NARRATIVE CANON (application-owned");
    expect(view.authority).toContain("3. CONTINUITY CONTEXT (established facts");
    const bibleIdx = view.authority.indexOf("1. STORY BIBLE");
    const canonIdx = view.authority.indexOf("2. NARRATIVE CANON");
    const continuityIdx = view.authority.indexOf("3. CONTINUITY CONTEXT");
    expect(bibleIdx).toBeLessThan(canonIdx);
    expect(canonIdx).toBeLessThan(continuityIdx);
  });

  it("strips the NARRATIVE AUTHORITY header from narrativeAuthority content", () => {
    const view = buildCanonView({ ...baseInput, purpose: "episode_writer" });
    expect(view.authority).not.toContain("NARRATIVE AUTHORITY. The application owns canon.");
    expect(view.authority).toContain("Alice is dead.");
  });

  it("passes through seasonPlan, episodePlan, and previousEpisode as supporting context", () => {
    const view = buildCanonView({ ...baseInput, purpose: "episode_writer" });
    expect(view.seasonPlan).toEqual({ seasonObjective: "Find the truth" });
    expect(view.episodePlan).toEqual({ episodeNumber: 2 });
    expect(view.previousEpisode).toEqual({ episodeNumber: 1, title: "Pilot", synopsis: "Alice appears." });
  });

  it("omits sections when sources are null or empty", () => {
    const view = buildCanonView({
      purpose: "episode_writer",
      bibleContext: null,
      narrativeAuthority: null,
      continuityContext: null,
      seasonPlan: null,
      episodePlan: null,
      continuityLedger: null,
      previousEpisode: null,
    });
    expect(view.hasAuthority).toBe(false);
    expect(view.authority).toBe("");
  });

  it("includes only available authority sections", () => {
    const view = buildCanonView({
      purpose: "episode_writer",
      bibleContext: "Bible content here.",
      narrativeAuthority: null,
      continuityContext: null,
      seasonPlan: null,
      episodePlan: null,
      continuityLedger: null,
      previousEpisode: null,
    });
    expect(view.hasAuthority).toBe(true);
    expect(view.authority).toContain("1. STORY BIBLE");
    expect(view.authority).not.toContain("2. NARRATIVE CANON");
    expect(view.authority).not.toContain("3. CONTINUITY CONTEXT");
  });

  it("handles whitespace-only inputs as null", () => {
    const view = buildCanonView({
      purpose: "episode_writer",
      bibleContext: "   ",
      narrativeAuthority: "  ",
      continuityContext: "",
      seasonPlan: null,
      episodePlan: null,
      continuityLedger: null,
      previousEpisode: null,
    });
    expect(view.hasAuthority).toBe(false);
  });

  it("buildCanonViewForEpisode defaults to episode_writer purpose", () => {
    const view = buildCanonViewForEpisode({
      bibleContext: "Bible.",
      narrativeAuthority: null,
      continuityContext: null,
      seasonPlan: null,
      episodePlan: null,
      continuityLedger: null,
      previousEpisode: null,
    });
    expect(view.hasAuthority).toBe(true);
    expect(view.authority).toContain("CANON AUTHORITY for Episode Writing");
  });

  it("uses purpose-specific label in header", () => {
    const view = buildCanonView({ ...baseInput, purpose: "season_planner" });
    expect(view.authority).toContain("CANON AUTHORITY for Season Planning");
  });
});

describe("Prompt assembly with unified authority", () => {
  const basePrompt: StoryPrompt = {
    title: "Test Episode",
    idea: "A test story.",
    genre: "Drama",
    language: "en",
    visualStyle: "realistic",
    tone: "serious",
    targetDurationSeconds: 120,
    aspectRatio: "16:9",
  };

  it("uses the authority field when present instead of separate labels", () => {
    const prompt = storyUserPrompt({
      ...basePrompt,
      authority: "CANON AUTHORITY for Episode Writing (precedence order):\n1. STORY BIBLE: Bible content.",
    });
    expect(prompt).toContain("CANON AUTHORITY for Episode Writing");
    expect(prompt).toContain("1. STORY BIBLE: Bible content.");
    expect(prompt).not.toContain("Story Bible (authoritative");
    expect(prompt).not.toContain("NARRATIVE AUTHORITY.");
  });

  it("falls back to separate labels when authority is absent", () => {
    const prompt = storyUserPrompt({
      ...basePrompt,
      bibleContext: "Bible content.",
      narrativeAuthority: "NARRATIVE AUTHORITY. The application owns canon.",
      continuityContext: "Continuity content.",
    });
    expect(prompt).toContain("Story Bible (authoritative");
    expect(prompt).toContain("NARRATIVE AUTHORITY.");
    expect(prompt).toContain("Continuity context");
  });

  it("falls back to separate labels when authority is whitespace", () => {
    const prompt = storyUserPrompt({
      ...basePrompt,
      authority: "   ",
      bibleContext: "Bible content.",
    });
    expect(prompt).toContain("Story Bible (authoritative");
  });

  it("labels continuityLedger as reference, not authoritative, in new path", () => {
    const prompt = storyUserPrompt({
      ...basePrompt,
      authority: "CANON AUTHORITY: Bible content.",
      continuityLedger: { events: ["event1"] },
    });
    expect(prompt).toContain("reference — do not contradict");
    expect(prompt).not.toContain("never contradict it");
  });

  it("preserves continuityLedger label in fallback path", () => {
    const prompt = storyUserPrompt({
      ...basePrompt,
      continuityLedger: { events: ["event1"] },
    });
    expect(prompt).toContain("Established canon from earlier approved episodes");
  });
});