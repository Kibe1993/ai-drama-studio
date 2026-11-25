import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { errorResponse, jsonData } from "@/lib/http/errors";
import { z } from "zod";
import { timelineRepository } from "@/lib/repositories/timelineRepository";
import { mediaAssetRepository } from "@/lib/repositories/mediaAssetRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { timelineExportService, type ExportFormat, type AssetInfo } from "@/lib/services/timelineExportService";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, episodeId } = await context.params;
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "json") as ExportFormat;
    if (!["edl", "fcpxml", "json"].includes(format)) {
      return errorResponse(400, "invalid_format", "Format must be one of: edl, fcpxml, json");
    }

    const timeline = await timelineRepository.findByEpisode(actor.userId, episodeId);
    if (!timeline) return errorResponse(404, "timeline_not_found", "No timeline for this episode");

    const episode = await episodeRepository.findOwned(actor.userId, projectId, episodeId);
    const title = episode?.title ?? `Episode_${episodeId}`;

    const assetIds = new Set<string>();
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        assetIds.add(clip.assetId);
      }
    }

    const assets: AssetInfo[] = [];
    for (const assetId of assetIds) {
      const asset = await mediaAssetRepository.findOwned(actor.userId, assetId);
      if (asset) {
        assets.push({
          assetId: asset.id,
          fileName: asset.fileName,
          durationSeconds: asset.durationSeconds ?? 0,
          storageKey: asset.storageKey,
        });
      }
    }

    const result = await timelineExportService.exportTimeline(timeline, assets, title, format);
    return jsonData(result);
  });
}

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId, episodeId } = await context.params;
    const parsed = z.object({
      format: z.enum(["edl", "fcpxml", "json"]),
      title: z.string().max(200).optional(),
    }).safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }

    const timeline = await timelineRepository.findByEpisode(actor.userId, episodeId);
    if (!timeline) return errorResponse(404, "timeline_not_found", "No timeline for this episode");

    const episode = await episodeRepository.findOwned(actor.userId, projectId, episodeId);
    const title = parsed.data.title ?? episode?.title ?? `Episode_${episodeId}`;

    const assetIds = new Set<string>();
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        assetIds.add(clip.assetId);
      }
    }

    const assets: AssetInfo[] = [];
    for (const assetId of assetIds) {
      const asset = await mediaAssetRepository.findOwned(actor.userId, assetId);
      if (asset) {
        assets.push({
          assetId: asset.id,
          fileName: asset.fileName,
          durationSeconds: asset.durationSeconds ?? 0,
          storageKey: asset.storageKey,
        });
      }
    }

    const result = await timelineExportService.exportTimeline(timeline, assets, title, parsed.data.format);
    return jsonData(result);
  });
}