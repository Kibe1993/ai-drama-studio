import "server-only";
import { StudioError } from "@/lib/http/errors";
import type { TimelineRecord, TimelineClip, TimelineTrack } from "@/lib/validation/timeline";

export type ExportFormat = "edl" | "fcpxml" | "json";

export type AssetInfo = {
  assetId: string;
  fileName: string;
  durationSeconds: number;
  storageKey: string;
};

export type TimelineExportResult = {
  format: ExportFormat;
  content: string;
  fileName: string;
};

export type TimelineImportData = {
  tracks: Array<{
    kind: string;
    clips: Array<{
      assetId: string;
      startSeconds: number;
      durationSeconds: number;
      transition: string;
      title: string;
      volume: number;
    }>;
  }>;
  aspectRatio: string;
  outputResolution: string;
  frameRate: number;
};

function secondsToTimecode(seconds: number, fps: number): string {
  const totalFrames = Math.round(seconds * fps);
  const hours = Math.floor(totalFrames / (3600 * fps));
  const minutes = Math.floor((totalFrames % (3600 * fps)) / (60 * fps));
  const secs = Math.floor((totalFrames % (60 * fps)) / fps);
  const frames = totalFrames % fps;
  return [hours, minutes, secs, frames].map((n) => String(n).padStart(2, "0")).join(":");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getVideoClips(timeline: TimelineRecord): TimelineClip[] {
  return timeline.tracks
    .filter((t): t is TimelineTrack & { kind: "video" } => t.kind === "video")
    .flatMap((t) => t.clips);
}

function getAudioClips(timeline: TimelineRecord): Array<{ clip: TimelineClip; kind: string }> {
  return timeline.tracks
    .filter((t) => t.kind === "dialogue" || t.kind === "narration" || t.kind === "music" || t.kind === "sfx")
    .flatMap((t) => t.clips.map((clip) => ({ clip, kind: t.kind })));
}

export const timelineExportService = {
  async exportToEdl(timeline: TimelineRecord, assets: AssetInfo[], title: string): Promise<TimelineExportResult> {
    const fps = timeline.frameRate;
    const videoClips = getVideoClips(timeline);
    const assetMap = new Map(assets.map((a) => [a.assetId, a]));

    const lines: string[] = [
      `TITLE: ${title.toUpperCase()}`,
      "",
    ];

    let editNumber = 1;
    let timelinePosition = 0;

    for (const clip of videoClips) {
      const asset = assetMap.get(clip.assetId);
      const clipName = asset?.fileName ?? (clip.title || `clip_${clip.assetId}`);
      const sourceIn = secondsToTimecode(clip.trimStartSeconds, fps);
      const sourceOut = secondsToTimecode(clip.trimStartSeconds + clip.durationSeconds, fps);
      const recordIn = secondsToTimecode(timelinePosition, fps);
      const recordOut = secondsToTimecode(timelinePosition + clip.durationSeconds, fps);

      const num = String(editNumber).padStart(3, "0");
      lines.push(`${num}  AX       V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`);
      if (clip.transition) {
        lines.push(`* TRANSITION: ${clip.transition}`);
      }
      lines.push(`* FROM CLIP NAME: ${clipName}`);
      if (clip.sceneNumber) lines.push(`* COMMENT: Scene ${clip.sceneNumber}`);
      if (clip.shotNumber) lines.push(`* COMMENT: Shot ${clip.shotNumber}`);
      lines.push("");
      editNumber++;
      timelinePosition += clip.durationSeconds;
    }

    const audioClips = getAudioClips(timeline);
    for (const { clip, kind } of audioClips) {
      const asset = assetMap.get(clip.assetId);
      const clipName = asset?.fileName ?? (clip.title || `audio_${clip.assetId}`);
      const sourceIn = secondsToTimecode(clip.trimStartSeconds, fps);
      const sourceOut = secondsToTimecode(clip.trimStartSeconds + clip.durationSeconds, fps);
      const recordIn = secondsToTimecode(clip.startSeconds, fps);
      const recordOut = secondsToTimecode(clip.startSeconds + clip.durationSeconds, fps);

      const num = String(editNumber).padStart(3, "0");
      const track = kind === "dialogue" ? "A1" : kind === "narration" ? "A2" : kind === "music" ? "A3" : "A4";
      lines.push(`${num}  AX       ${track}   C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`);
      lines.push(`* FROM CLIP NAME: ${clipName}`);
      if (clip.volume !== 1) lines.push(`* AUDIO LEVEL: ${clip.volume.toFixed(2)}`);
      lines.push("");
      editNumber++;
    }

    return {
      format: "edl",
      content: lines.join("\n"),
      fileName: `${title.replace(/\s+/g, "_")}.edl`,
    };
  },

  async exportToFcpxml(timeline: TimelineRecord, assets: AssetInfo[], title: string): Promise<TimelineExportResult> {
    const fps = timeline.frameRate;
    const [width, height] = timeline.outputResolution.split("x").map(Number);
    const videoClips = getVideoClips(timeline);
    const assetMap = new Map(assets.map((a) => [a.assetId, a]));

    const assetRefs = assets.map((a) => `      <asset id="asset-${a.assetId}" name="${escapeXml(a.fileName)}" start="0s" duration="${a.durationSeconds}s" hasVideo="1" hasAudio="0">`).join("\n");

    const clipSpine: string[] = [];
    let offset = 0;
    for (const clip of videoClips) {
      const asset = assetMap.get(clip.assetId);
      const clipName = asset?.fileName ?? (clip.title || `clip_${clip.assetId}`);
      const start = secondsToTimecode(clip.trimStartSeconds, fps);
      const duration = secondsToTimecode(clip.durationSeconds, fps);
      const offsetTc = secondsToTimecode(offset, fps);
      clipSpine.push(`        <clip name="${escapeXml(clipName)}" offset="${offsetTc}s" ref="asset-${clip.assetId}" start="${start}s" duration="${duration}s"${clip.transition ? ` transition="${escapeXml(clip.transition)}"` : ""}${clip.sceneNumber ? ` scene="${clip.sceneNumber}"` : ""}${clip.shotNumber ? ` shot="${clip.shotNumber}"` : ""} />`);
      offset += clip.durationSeconds;
    }

    const fcpxml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="1/${fps}s" width="${width}" height="${height}"/>
${assetRefs}
  </resources>
  <event>
    <project name="${escapeXml(title)}">
      <sequence format="r1" tcStart="0s" tcFormat="NDF">
        <spine>
${clipSpine.join("\n")}
        </spine>
      </sequence>
    </project>
  </event>
</fcpxml>`;

    return {
      format: "fcpxml",
      content: fcpxml,
      fileName: `${title.replace(/\s+/g, "_")}.fcpxml`,
    };
  },

  async exportToJson(timeline: TimelineRecord, assets: AssetInfo[], title: string): Promise<TimelineExportResult> {
    const data = {
      title,
      exportedAt: new Date().toISOString(),
      timeline: {
        id: timeline.id,
        aspectRatio: timeline.aspectRatio,
        outputResolution: timeline.outputResolution,
        frameRate: timeline.frameRate,
        status: timeline.status,
        tracks: timeline.tracks.map((track) => ({
          kind: track.kind,
          clips: track.clips.map((clip) => ({
            assetId: clip.assetId,
            startSeconds: clip.startSeconds,
            durationSeconds: clip.durationSeconds,
            audioOffsetSeconds: clip.audioOffsetSeconds,
            transition: clip.transition,
            optional: clip.optional,
            title: clip.title,
            sceneNumber: clip.sceneNumber,
            shotNumber: clip.shotNumber,
            trimStartSeconds: clip.trimStartSeconds,
            trimEndSeconds: clip.trimEndSeconds,
            volume: clip.volume,
          })),
        })),
      },
      assets: assets.map((a) => ({
        assetId: a.assetId,
        fileName: a.fileName,
        durationSeconds: a.durationSeconds,
        storageKey: a.storageKey,
      })),
    };

    return {
      format: "json",
      content: JSON.stringify(data, null, 2),
      fileName: `${title.replace(/\s+/g, "_")}_timeline.json`,
    };
  },

  async exportTimeline(timeline: TimelineRecord, assets: AssetInfo[], title: string, format: ExportFormat): Promise<TimelineExportResult> {
    try {
      switch (format) {
        case "edl":
          return this.exportToEdl(timeline, assets, title);
        case "fcpxml":
          return this.exportToFcpxml(timeline, assets, title);
        case "json":
          return this.exportToJson(timeline, assets, title);
        default:
          throw new StudioError(`Unsupported export format: ${format}`, 400, "invalid_format");
      }
    } catch (cause) {
      if (cause instanceof StudioError) throw cause;
      throw new StudioError(
        cause instanceof Error ? cause.message : "Export failed",
        500,
        "timeline_export_failed",
      );
    }
  },

  async importFromJson(content: string): Promise<TimelineImportData> {
    try {
      const data = JSON.parse(content) as { timeline?: TimelineImportData };
      if (!data.timeline || !Array.isArray(data.timeline.tracks)) {
        throw new StudioError("Invalid timeline JSON: missing timeline.tracks", 400, "invalid_import");
      }
      return data.timeline;
    } catch (cause) {
      if (cause instanceof StudioError) throw cause;
      throw new StudioError(
        cause instanceof Error ? cause.message : "Import failed",
        500,
        "timeline_import_failed",
      );
    }
  },
};