import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { audioSegmentModel } from "@/lib/models/audioSegment";
import { canonicalEntityModel } from "@/lib/models/canonicalEntity";
import { productionRunModel } from "@/lib/models/productionRun";
import { productionSceneModel } from "@/lib/models/productionScene";
import { renderJobModel } from "@/lib/models/renderJob";
import { shotProductionRecordModel } from "@/lib/models/shotProductionRecord";
import { storyModel } from "@/lib/models/story";
import { timelineModel } from "@/lib/models/timeline";

export interface StaleMarkResult {
  stories: number;
  characters: number;
  scenes: number;
  shots: number;
  audio: number;
  video: number;
  renders: number;
  timelines: number;
}

function projectIds(projectId: string): unknown[] {
  if (mongoose.isValidObjectId(projectId)) {
    return [projectId, new mongoose.Types.ObjectId(projectId)];
  }
  return [projectId];
}

/**
 * Mark saved production records whose canon version is older than the commit.
 * Records without a version are left alone so historical projects stay readable.
 * Nothing is deleted.
 */
export async function markStaleCanonArtifacts(input: {
  clerkUserId: string;
  projectId: string;
  canonVersion: number;
  reason: string;
}): Promise<StaleMarkResult> {
  const connection = await connectDB();
  const ids = projectIds(input.projectId);
  const stamp = { canonStale: true, canonStaleReason: input.reason.slice(0, 600) };
  const owned = {
    clerkUserId: input.clerkUserId,
    projectId: { $in: ids },
    sourceCanonVersion: { $lt: input.canonVersion },
  };
  const [stories, characters, scenes, shots, audio, renders, timelines] = await Promise.all([
    storyModel(connection).updateMany(owned, { $set: stamp }),
    canonicalEntityModel(connection).updateMany(owned, { $set: stamp }),
    productionSceneModel(connection).updateMany(owned, { $set: stamp }),
    shotProductionRecordModel(connection).updateMany(owned, { $set: stamp }),
    audioSegmentModel(connection).updateMany(owned, { $set: stamp }),
    renderJobModel(connection).updateMany(owned, { $set: stamp }),
    timelineModel(connection).updateMany(owned, { $set: { ...stamp, status: "stale" } }),
  ]);
  await productionRunModel(connection).updateMany(
    {
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      "stageResults.story.sourceCanonVersion": { $lt: input.canonVersion },
    },
    {
      $set: {
        "stageResults.canonStale": true,
        "stageResults.canonStaleReason": input.reason.slice(0, 600),
      },
    },
  );
  const sceneCount = scenes.modifiedCount ?? 0;
  return {
    stories: stories.modifiedCount ?? 0,
    characters: characters.modifiedCount ?? 0,
    scenes: sceneCount,
    shots: shots.modifiedCount ?? 0,
    audio: audio.modifiedCount ?? 0,
    video: sceneCount,
    renders: renders.modifiedCount ?? 0,
    timelines: timelines.modifiedCount ?? 0,
  };
}
