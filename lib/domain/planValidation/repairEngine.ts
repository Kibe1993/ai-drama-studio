import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type {
  RichValidationFinding,
  RepairAttempt,
} from "@/lib/validation/seasonPlanValidation";


export const MAX_REPAIR_ATTEMPTS = 3;
export const REPAIR_TIMEOUT_MS = 90_000;

export interface RepairContext {
  plan: SeasonPlan;
  bible: StoryBibleContent | null;
  finding: RichValidationFinding;
}

export interface RepairResult {
  repairedPlan: SeasonPlan | null;
  attempt: RepairAttempt;
  affectedEpisodes: number[];
}

export function identifyAffectedEpisodes(finding: RichValidationFinding): number[] {
  if (finding.episodeNumber) return [finding.episodeNumber];
  return [];
}

export function buildRepairInstruction(
  finding: RichValidationFinding,
  episode: EpisodePlanItem | null,
  _plan: SeasonPlan,
): { instruction: string; targetEpisode: number | null } {
  const targetEpisode = finding.episodeNumber ?? null;
  const parts: string[] = [
    "Repair the following validation finding in the season plan.",
    "",
    `Finding: ${finding.message}`,
    `Category: ${finding.category}`,
    `Severity: ${finding.severity}`,
  ];

  if (finding.explanation) parts.push(`Explanation: ${finding.explanation}`);
  if (finding.evidence && finding.evidence.length > 0) parts.push(`Evidence: ${finding.evidence.join("; ")}`);
  if (finding.recommendation) parts.push(`Recommendation: ${finding.recommendation}`);

  if (targetEpisode && episode) {
    parts.push(
      "",
      `Target: Episode ${targetEpisode} — "${episode.workingTitle}"`,
      `Current narrative purpose: ${episode.narrativePurpose}`,
      `Current starting situation: ${episode.startingSituation}`,
      `Current central conflict: ${episode.centralConflict}`,
      `Current ending: ${episode.endingOrCliffhanger}`,
      "",
      "Rules:",
      "1. Modify ONLY the affected episode unless dependent episodes genuinely require changes.",
      "2. Preserve all unrelated approved content.",
      "3. Do not change the Story Bible or canonical facts.",
      "4. Keep the same episode number and working title unless the finding is about the title.",
      "5. Ensure the repair addresses the specific finding, not just the general area.",
    );
  } else {
    parts.push(
      "",
      "Target: Season-level field",
      "",
      "Rules:",
      "1. Modify only the affected season-level field.",
      "2. Preserve all episode-level content.",
      "3. Do not change the Story Bible or canonical facts.",
    );
  }

  return { instruction: parts.join("\n"), targetEpisode };
}

export function applyEpisodeRepair(
  plan: SeasonPlan,
  repairedEpisode: EpisodePlanItem,
): SeasonPlan {
  const episodeProgression = plan.episodeProgression.map((ep) =>
    ep.episodeNumber === repairedEpisode.episodeNumber ? repairedEpisode : ep
  );
  return { ...plan, episodeProgression };
}

export function applySeasonLevelRepair(
  plan: SeasonPlan,
  finding: RichValidationFinding,
  repairedFields: Partial<SeasonPlan>,
): SeasonPlan {
  return { ...plan, ...repairedFields };
}

export function shouldAttemptRepair(
  finding: RichValidationFinding,
  attemptCount: number,
): boolean {
  if (attemptCount >= MAX_REPAIR_ATTEMPTS) return false;
  if (finding.severity === "low") return false;
  return true;
}

export function createRepairAttempt(
  attempt: number,
  finding: RichValidationFinding,
  status: "success" | "failed" | "skipped",
  message: string,
  provider?: string,
  model?: string,
): RepairAttempt {
  return {
    attempt,
    findingId: finding.findingId,
    episodeNumber: finding.episodeNumber,
    provider: provider ?? "",
    model: model ?? "",
    status,
    message,
    repairedAt: new Date().toISOString(),
  };
}

export function isRepairIsolated(
  originalPlan: SeasonPlan,
  repairedPlan: SeasonPlan,
  targetEpisode: number,
): boolean {
  for (const originalEp of originalPlan.episodeProgression) {
    if (originalEp.episodeNumber === targetEpisode) continue;
    const repairedEp = repairedPlan.episodeProgression.find(
      (e) => e.episodeNumber === originalEp.episodeNumber
    );
    if (!repairedEp) return false;
    if (JSON.stringify(originalEp) !== JSON.stringify(repairedEp)) return false;
  }
  return true;
}

export function selectFindingsForRepair(
  findings: RichValidationFinding[],
): RichValidationFinding[] {
  return findings
    .filter((f) => f.severity === "blocking" || f.severity === "high")
    .sort((a, b) => {
      const rank = { blocking: 4, high: 3, medium: 2, low: 1 };
      return rank[b.severity] - rank[a.severity];
    });
}