import type { JobRecord, JobType } from "@/lib/pipeline/types";

const LABELS: Record<JobType, string> = {
  "story.draft": "Developing story draft",
  "story.generate": "Developing story",
  "storyBible.generate": "Developing Story Bible",
  "seasonPlan.generate": "Developing season plan",
  "episodeSuggest.generate": "Developing episode idea",
  "character.extract": "Creating characters",
  "scene.breakdown": "Preparing scenes",
  "video.scene": "Generating scene",
  "render.final": "Rendering final video",
};

export function stageMessage(job: Pick<JobRecord, "jobType" | "sceneNumber">, suffix = ""): string {
  const label =
    job.jobType === "video.scene" && job.sceneNumber
      ? `Generating scene ${job.sceneNumber}`
      : LABELS[job.jobType];
  return suffix ? `${label}. ${suffix}` : label;
}
