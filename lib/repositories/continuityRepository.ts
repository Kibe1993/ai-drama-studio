import { connectDB } from "@/lib/db/connect";
import { canonicalEntityModel } from "@/lib/models/canonicalEntity";
import { storyEventModel } from "@/lib/models/storyEvent";
import type { CharacterResult, RunRecord, SceneItem } from "@/lib/pipeline/types";

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

async function models() {
  const connection = await connectDB();
  return { Entity: canonicalEntityModel(connection), Event: storyEventModel(connection) };
}

function appearance(run: RunRecord, storyId: string) {
  return {
    productionRunId: run.id,
    episodeId: run.episode?.id ?? null,
    episodeNumber: run.episode?.number ?? 1,
    storyId,
  };
}

export const continuityRepository = {
  async persistCharacters(clerkUserId: string, run: RunRecord, storyId: string, profiles: NonNullable<CharacterResult["profiles"]>) {
    const { Entity } = await models();
    for (const character of profiles) {
      await Entity.updateOne(
        { clerkUserId, projectId: run.projectId, entityType: "character", normalizedName: normalize(character.name) },
        {
          $setOnInsert: {
            clerkUserId, projectId: run.projectId, entityType: "character",
            normalizedName: normalize(character.name), name: character.name, profile: character,
            status: "pending_review",
          },
          $addToSet: { appearances: appearance(run, storyId) },
        },
        { upsert: true, runValidators: true }
      );
    }
  },

  async persistSceneCanon(clerkUserId: string, run: RunRecord, storyId: string, scenes: SceneItem[]) {
    const { Entity, Event } = await models();
    for (const scene of scenes) {
      const locationName = scene.location?.trim();
      if (locationName) {
        await Entity.updateOne(
          { clerkUserId, projectId: run.projectId, entityType: "location", normalizedName: normalize(locationName) },
          {
            $setOnInsert: {
              clerkUserId, projectId: run.projectId, entityType: "location",
              normalizedName: normalize(locationName), name: locationName,
              description: scene.visualDescription ?? "", status: "pending_review",
            },
            $addToSet: { appearances: appearance(run, storyId) },
          },
          { upsert: true, runValidators: true }
        );
      }
      await Event.updateOne(
        { clerkUserId, productionRunId: run.id, sceneNumber: scene.sceneNumber },
        {
          $set: {
            title: scene.title,
            description: scene.action ?? scene.visualDescription ?? scene.title,
            characterNames: scene.charactersPresent ?? [],
            locationName: locationName ?? "",
          },
          $setOnInsert: {
            clerkUserId,
            projectId: run.projectId,
            productionRunId: run.id,
            episodeId: run.episode?.id ?? null,
            episodeNumber: run.episode?.number ?? 1,
            storyId,
            sceneNumber: scene.sceneNumber,
            status: "pending_review",
          },
        },
        { upsert: true, runValidators: true }
      );
    }
  },

  async approveCharactersForRun(clerkUserId: string, projectId: string, runId: string) {
    const { Entity } = await models();
    await Entity.updateMany(
      { clerkUserId, projectId, entityType: "character", "appearances.productionRunId": runId },
      { $set: { status: "approved" } }
    );
  },

  async approveScenesForRun(clerkUserId: string, projectId: string, runId: string) {
    const { Entity, Event } = await models();
    await Promise.all([
      Entity.updateMany(
        { clerkUserId, projectId, entityType: "location", "appearances.productionRunId": runId },
        { $set: { status: "approved" } }
      ),
      Event.updateMany({ clerkUserId, projectId, productionRunId: runId }, { $set: { status: "approved" } }),
    ]);
  },

  async syncSceneEvent(clerkUserId: string, projectId: string, runId: string, scene: { sceneNumber: number; title: string; action: string; visualDescription: string; charactersPresent: string[]; location: string }) {
    const { Event } = await models();
    await Event.updateOne(
      { clerkUserId, projectId, productionRunId: runId, sceneNumber: scene.sceneNumber },
      { $set: {
        title: scene.title,
        description: scene.action || scene.visualDescription,
        characterNames: scene.charactersPresent,
        locationName: scene.location,
      } }
    );
  },

  async getPriorEpisodeContext(clerkUserId: string, projectId: string, beforeEpisodeNumber: number): Promise<string | undefined> {
    if (beforeEpisodeNumber < 2) return undefined;
    const { Entity, Event } = await models();
    const [entities, events] = await Promise.all([
      Entity.find({ clerkUserId, projectId, status: "approved", "appearances.episodeNumber": { $lt: beforeEpisodeNumber } })
        .sort({ entityType: 1, name: 1 }).limit(40).lean<Array<{ entityType: string; name: string; profile?: Record<string, unknown>; description?: string }>>(),
      Event.find({ clerkUserId, projectId, status: "approved", episodeNumber: { $lt: beforeEpisodeNumber } })
        .sort({ episodeNumber: 1, sceneNumber: 1 }).limit(30).lean<Array<{ episodeNumber: number; title: string; description: string }>>(),
    ]);
    const facts = [
      ...entities.map((entity) => entity.entityType === "character"
        ? `Character ${entity.name}: ${[entity.profile?.role, entity.profile?.physicalDescription, entity.profile?.clothing].filter(Boolean).join("; ")}`
        : `Location ${entity.name}: ${entity.description ?? ""}`),
      ...events.map((event) => `Earlier episode ${event.episodeNumber} event: ${event.title} — ${event.description}`),
    ].filter((value) => !value.endsWith(": "));
    return facts.length ? facts.join("\n") : undefined;
  },
};
