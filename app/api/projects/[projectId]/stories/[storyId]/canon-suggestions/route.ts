import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { jsonData, StudioError } from "@/lib/http/errors";
import { liveCanonExtractionService } from "@/lib/pipeline/live";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { projectRepository } from "@/lib/repositories/projectRepository";

type Context = { params: Promise<{ projectId: string; storyId: string }> };

/** Get the canon suggestions stored on an approved story. */
export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`canon-suggestions:${actor.userId}`);
    const { storyId } = await context.params;
    const story = await storyRepository.findOwned(actor.userId, storyId);
    if (!story) throw new StudioError("Story not found.", 404, "not_found");
    return jsonData({ suggestions: story.canonSuggestions ?? null });
  });
}

/** Trigger the advisory post-hoc canon extraction on an approved screenplay. */
export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`canon-extract:${actor.userId}`);
    const { projectId, storyId } = await context.params;
    const body = (await readJson(request).catch(() => ({}))) as {
      episodeNumber?: number;
      seriesTitle?: string;
    };

    const story = await storyRepository.findOwned(actor.userId, storyId);
    if (!story) throw new StudioError("Story not found.", 404, "not_found");
    if (story.status !== "approved") throw new StudioError("Canon extraction requires an approved screenplay.", 400, "not_approved");

    const episodeNumber =
      typeof body.episodeNumber === "number" ? body.episodeNumber
      : story.plan?.episodeNumber ?? 1;

    const seriesTitle =
      typeof body.seriesTitle === "string" && body.seriesTitle.trim()
        ? body.seriesTitle
        : (await projectRepository.findOwned(actor.userId, projectId))?.title ?? story.title;

    const result = await liveCanonExtractionService().extractSuggestions({
      clerkUserId: actor.userId,
      storyId,
      episodeNumber,
      seriesTitle,
    });

    return jsonData(result);
  });
}

/** Accept or reject the canon suggestions. */
export function PATCH(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    assertRateLimit(`canon-review:${actor.userId}`);
    const { storyId } = await context.params;
    const body = (await readJson(request)) as { action?: string };
    if (body.action !== "accept" && body.action !== "reject") {
      throw new StudioError("Body must be { action: \"accept\" | \"reject\" }.", 400, "invalid_action");
    }

    const service = liveCanonExtractionService();
    const result = body.action === "accept"
      ? await service.acceptSuggestions({ clerkUserId: actor.userId, storyId })
      : await service.rejectSuggestions({ clerkUserId: actor.userId, storyId });

    return jsonData(result);
  });
}