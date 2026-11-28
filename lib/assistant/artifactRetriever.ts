import "server-only";
import { canonicalEntityRepository } from "@/lib/repositories/canonicalEntityRepository";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { continuityLedgerRepository } from "@/lib/repositories/continuityLedgerRepository";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import type { TaskType, TaskClassification } from "@/lib/assistant/taskClassifier";

export type ArtifactSummary = {
  source: string;
  content: string;
};

async function safeFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function truncate(text: string, max = 2000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

async function retrieveCharacterArtifacts(
  clerkUserId: string,
  projectId: string,
  referencedEntities: string[],
): Promise<ArtifactSummary[]> {
  const summaries: ArtifactSummary[] = [];

  const entities = await safeFetch(() =>
    canonicalEntityRepository.listByProject(clerkUserId, projectId, "character"),
  );

  if (entities && entities.length > 0) {
    const filtered = referencedEntities.length > 0
      ? entities.filter((e) =>
          referencedEntities.some((ref) => e.name.toLowerCase().includes(ref.toLowerCase())),
        )
      : entities.slice(0, 10);

    if (filtered.length > 0) {
      const content = filtered
        .map((e) => `- ${e.name}${e.description ? `: ${truncate(e.description, 500)}` : ""}`)
        .join("\n");
      summaries.push({ source: "characters", content });
    }
  }

  return summaries;
}

async function retrieveSceneArtifacts(
  clerkUserId: string,
  projectId: string,
): Promise<ArtifactSummary[]> {
  const summaries: ArtifactSummary[] = [];

  const bible = await safeFetch(() =>
    storyBibleRepository.findOwned(clerkUserId, projectId),
  );

  if (bible) {
    const parts: string[] = [];
    if (bible.premise) parts.push(`Premise: ${truncate(bible.premise, 500)}`);
    if (bible.worldRules && bible.worldRules.length > 0) {
      parts.push(`World rules: ${bible.worldRules.map((r) => truncate(r, 200)).join("; ")}`);
    }
    if (parts.length > 0) {
      summaries.push({ source: "story_bible", content: parts.join("\n") });
    }
  }

  const canon = await safeFetch(() =>
    narrativeCanonRepository.latest(clerkUserId, projectId),
  );

  if (canon) {
    const content = `Canon version ${canon.version}: ${truncate(JSON.stringify(canon).slice(0, 1500), 1500)}`;
    summaries.push({ source: "narrative_canon", content });
  }

  return summaries;
}

async function retrieveContinuityArtifacts(
  clerkUserId: string,
  projectId: string,
): Promise<ArtifactSummary[]> {
  const summaries: ArtifactSummary[] = [];

  const ledger = await safeFetch(() =>
    continuityLedgerRepository.findLatest(clerkUserId, projectId),
  );

  if (ledger) {
    const parts: string[] = [`As of episode ${ledger.asOfEpisode ?? "?"}`];
    if (ledger.events && ledger.events.length > 0) {
      parts.push(`Events: ${ledger.events.slice(0, 10).map((e) => truncate(e.event, 200)).join("; ")}`);
    }
    if (ledger.unresolvedThreads && ledger.unresolvedThreads.length > 0) {
      parts.push(`Unresolved: ${ledger.unresolvedThreads.slice(0, 5).map((t) => truncate(t.thread, 200)).join("; ")}`);
    }
    summaries.push({ source: "continuity_ledger", content: parts.join("\n") });
  }

  const canon = await safeFetch(() =>
    narrativeCanonRepository.latest(clerkUserId, projectId),
  );

  if (canon) {
    summaries.push({
      source: "narrative_canon",
      content: `Canon v${canon.version}: ${truncate(JSON.stringify(canon).slice(0, 1500), 1500)}`,
    });
  }

  return summaries;
}

async function retrieveGeneralArtifacts(
  clerkUserId: string,
  projectId: string,
): Promise<ArtifactSummary[]> {
  const summaries: ArtifactSummary[] = [];

  const bible = await safeFetch(() =>
    storyBibleRepository.findOwned(clerkUserId, projectId),
  );

  if (bible) {
    const parts: string[] = [];
    if (bible.premise) parts.push(`Premise: ${truncate(bible.premise, 500)}`);
    if (bible.themes && bible.themes.length > 0) {
      parts.push(`Themes: ${bible.themes.join(", ")}`);
    }
    if (parts.length > 0) {
      summaries.push({ source: "story_bible", content: parts.join("\n") });
    }
  }

  return summaries;
}

export async function retrieveArtifacts(
  clerkUserId: string,
  projectId: string,
  classification: TaskClassification,
): Promise<ArtifactSummary[]> {
  switch (classification.type) {
    case "character_development":
      return retrieveCharacterArtifacts(clerkUserId, projectId, classification.referencedEntities);
    case "scene_development":
      return retrieveSceneArtifacts(clerkUserId, projectId);
    case "continuity_review":
      return retrieveContinuityArtifacts(clerkUserId, projectId);
    case "general_conversation":
      return retrieveGeneralArtifacts(clerkUserId, projectId);
    case "technical_development":
      return [];
    default:
      return retrieveGeneralArtifacts(clerkUserId, projectId);
  }
}

export function shouldRetrieveArtifacts(taskType: TaskType): boolean {
  return taskType !== "technical_development";
}