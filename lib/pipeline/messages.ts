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
  "image.character_reference": "Generating character reference",
  "image.environment_reference": "Generating environment reference",
  "image.object_reference": "Generating object reference",
  "image.shot": "Generating shot image",
  "video.shot": "Generating shot video",
  "audio.dialogue": "Generating dialogue",
  "audio.narration": "Generating narration",
  "audio.sfx": "Generating sound effect",
  "audio.music": "Processing music",
  "media.validate": "Validating media",
  "assembly.generate": "Assembling timeline",
  "canon.extract": "Extracting canon facts",
  "image.comfyui": "Generating image via ComfyUI",
  "animation.2d": "Rendering 2D animation",
  "animation.3d": "Rendering 3D animation",
  "character.model": "Generating 3D character model",
  "character.rig": "Generating character rig",
  "audio.lipsync": "Generating lip sync",
  "audio.edit": "Processing audio",
  "render.remotion": "Rendering via Remotion",
  "video.veo": "Generating video via Google Veo",
  "tool.healthcheck": "Running tool health check",
};

export function stageMessage(job: Pick<JobRecord, "jobType" | "sceneNumber">, suffix = ""): string {
  const label =
    job.jobType === "video.scene" && job.sceneNumber
      ? `Generating scene ${job.sceneNumber}`
      : LABELS[job.jobType];
  return suffix ? `${label}. ${suffix}` : label;
}
