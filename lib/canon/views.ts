import type { PreviousEpisode } from "@/lib/domain/screenplayValidation";

export type ViewPurpose = "season_planner" | "episode_writer" | "extractor" | "verifier" | "ui";

export type CanonViewInput = {
  purpose: ViewPurpose;
  bibleContext: string | null;
  narrativeAuthority: string | null;
  continuityContext: string | null;
  seasonPlan: unknown | null;
  episodePlan: unknown | null;
  continuityLedger: unknown | null;
  previousEpisode: { episodeNumber: number; title: string; synopsis: string } | null;
};

export type CanonView = {
  authority: string;
  seasonPlan: unknown | null;
  episodePlan: unknown | null;
  previousEpisode: { episodeNumber: number; title: string; synopsis: string } | null;
  hasAuthority: boolean;
};

const PURPOSE_LABELS: Record<ViewPurpose, string> = {
  season_planner: "Season Planning",
  episode_writer: "Episode Writing",
  extractor: "Canon Extraction",
  verifier: "Canon Verification",
  ui: "Narrative Overview",
};

function trimToContent(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripAuthorityHeader(text: string): string {
  const lines = text.split("\n");
  const withoutHeader = lines.filter(
    (line) =>
      !line.startsWith("NARRATIVE AUTHORITY.") &&
      !line.startsWith("The application owns canon."),
  );
  return withoutHeader.join("\n").trim();
}

export function buildCanonView(input: CanonViewInput): CanonView {
  const bible = trimToContent(input.bibleContext);
  const narrative = trimToContent(input.narrativeAuthority);
  const continuity = trimToContent(input.continuityContext);

  const sections: string[] = [];
  let hasAuthority = false;

  if (bible) {
    sections.push(
      "1. STORY BIBLE (highest precedence — follow character personalities, relationships, world rules, narrative direction, themes, and boundaries exactly):",
      bible,
    );
    hasAuthority = true;
  }

  if (narrative) {
    const body = stripAuthorityHeader(narrative);
    sections.push(
      "2. NARRATIVE CANON (application-owned established facts and rules — you may propose changes but cannot approve or commit them):",
      body,
    );
    hasAuthority = true;
  }

  if (continuity) {
    sections.push(
      "3. CONTINUITY CONTEXT (established facts from earlier approved episodes — never contradict):",
      continuity,
    );
    hasAuthority = true;
  }

  const header = hasAuthority
    ? `CANON AUTHORITY for ${PURPOSE_LABELS[input.purpose]} (precedence order — earlier sources override later on conflict):`
    : "";
  const authority = [header, ...sections].filter(Boolean).join("\n");

  return {
    authority,
    seasonPlan: input.seasonPlan,
    episodePlan: input.episodePlan,
    previousEpisode: input.previousEpisode,
    hasAuthority,
  };
}

export function buildCanonViewForEpisode(input: {
  bibleContext: string | null;
  narrativeAuthority: string | null;
  continuityContext: string | null;
  seasonPlan: unknown | null;
  episodePlan: unknown | null;
  continuityLedger: unknown | null;
  previousEpisode: { episodeNumber: number; title: string; synopsis: string } | null;
}): CanonView {
  return buildCanonView({
    purpose: "episode_writer",
    bibleContext: input.bibleContext,
    narrativeAuthority: input.narrativeAuthority,
    continuityContext: input.continuityContext,
    seasonPlan: input.seasonPlan,
    episodePlan: input.episodePlan,
    continuityLedger: input.continuityLedger,
    previousEpisode: input.previousEpisode,
  });
}

export type { PreviousEpisode };