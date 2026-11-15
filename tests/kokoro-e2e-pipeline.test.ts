import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { projectModel } from "@/lib/models/project";
import { audioSegmentModel } from "@/lib/models/audioSegment";
import { mediaAssetModel } from "@/lib/models/mediaAsset";
import { KokoroAudioProvider } from "@/lib/providers/media/audio/kokoro";
import { createStorageProvider } from "@/lib/providers/storage/registry";
import { createTtsOrchestrationService } from "@/lib/services/ttsOrchestrationService";
import { audioSegmentRepository } from "@/lib/repositories/audioSegmentRepository";

const KOKORO_PYTHON = "C:\\AI-Drama-Studio-Kokoro\\.venv\\Scripts\\python.exe";
const kokoroAvailable = existsSync(KOKORO_PYTHON);

const TEST_USER = "user_kokoro_e2e_test";
const objectId = () => new mongoose.Types.ObjectId().toString();

describe.skipIf(!kokoroAvailable)("Kokoro end-to-end pipeline (real DB + real Kokoro)", () => {
  let projectId: string;
  let runId: string;
  let storyId: string;
  let segmentId: string;
  const createdAssetIds: string[] = [];

  beforeAll(async () => {
    const connection = await connectDB();
    const Project = projectModel(connection);
    const AudioSegment = audioSegmentModel(connection);

    projectId = objectId();
    runId = objectId();
    storyId = objectId();

    await Project.create({
      _id: projectId,
      clerkUserId: TEST_USER,
      title: "Kokoro E2E Test Project",
      originalStoryIdea: "Test.",
      genre: "thriller",
      language: "en",
      visualStyle: "realistic",
      tone: "dramatic",
      targetDurationSeconds: 60,
      aspectRatio: "16:9",
      status: "draft",
      workflowMode: "guided",
      productionType: "fictional_drama",
      productionMode: "standalone",
    });

    const seg = await AudioSegment.create({
      clerkUserId: TEST_USER,
      projectId,
      runId,
      storyId,
      sceneNumber: 1,
      sequence: 0,
      speakerType: "character",
      speakerName: "Amara",
      voiceIdentifier: "af_heart",
      text: "I will not let them take this from us.",
      kind: "dialogue",
      status: "pending",
      mediaAssetId: null,
      durationSeconds: null,
      error: null,
      attempts: 0,
      idempotencyKey: `kokoro-e2e-${Date.now()}`,
    });
    segmentId = (seg._id as mongoose.Types.ObjectId).toString();
  });

  afterAll(async () => {
    const connection = await connectDB();
    const Project = projectModel(connection);
    const AudioSegment = audioSegmentModel(connection);
    const Asset = mediaAssetModel(connection);

    await Project.deleteOne({ clerkUserId: TEST_USER, _id: projectId });
    await AudioSegment.deleteMany({ clerkUserId: TEST_USER, runId });
    if (createdAssetIds.length > 0) {
      await Asset.deleteMany({ clerkUserId: TEST_USER, _id: { $in: createdAssetIds } });
    }
  });

  it("generates audio through the full TTS orchestration pipeline", async () => {
    const audioProvider = new KokoroAudioProvider();
    const storage = createStorageProvider();
    const ttsService = createTtsOrchestrationService({ audioProvider, storage });

    const result = await ttsService.generateSegmentAudio(
      { userId: TEST_USER },
      segmentId,
      { projectId, episodeId: null, sceneId: null }
    );

    expect(result.status).toBe("completed");
    expect(result.mediaAssetId).not.toBeNull();
    expect(result.durationSeconds).toBeGreaterThan(0);
    expect(result.error).toBeNull();

    if (result.mediaAssetId) createdAssetIds.push(result.mediaAssetId);
  }, 180_000);

  it("verifies the audio segment is persisted as completed in the database", async () => {
    const segment = await audioSegmentRepository.findById(TEST_USER, segmentId);
    expect(segment).not.toBeNull();
    expect(segment!.status).toBe("completed");
    expect(segment!.mediaAssetId).not.toBeNull();
    expect(segment!.durationSeconds).toBeGreaterThan(0);
  });

  it("verifies the media asset record exists with correct metadata", async () => {
    const connection = await connectDB();
    const Asset = mediaAssetModel(connection);
    const segment = await audioSegmentRepository.findById(TEST_USER, segmentId);
    expect(segment?.mediaAssetId).not.toBeNull();

    const asset = await Asset.findOne({
      clerkUserId: TEST_USER,
      _id: segment!.mediaAssetId,
    }).lean();

    expect(asset).not.toBeNull();
    expect(asset!.mimeType).toBe("audio/wav");
    expect(asset!.byteSize).toBeGreaterThan(44);
    expect(asset!.storageProvider).toBe("local");
    expect(asset!.storageVerified).toBe(true);
    expect(asset!.sha256).toMatch(/^[a-f\d]{64}$/);
  });

  it("verifies the audio file is physically stored in local storage", async () => {
    const connection = await connectDB();
    const Asset = mediaAssetModel(connection);
    const segment = await audioSegmentRepository.findById(TEST_USER, segmentId);

    const asset = await Asset.findOne({
      clerkUserId: TEST_USER,
      _id: segment!.mediaAssetId,
    }).lean();

    expect(asset).not.toBeNull();
    const head = await createStorageProvider().head(asset!.storageKey as string);
    expect(head).not.toBeNull();
    expect(head!.byteSize).toBe(asset!.byteSize);
    expect(head!.sha256).toBe(asset!.sha256);
  });

  it("returns the completed segment on a second call without regenerating", async () => {
    const audioProvider = new KokoroAudioProvider();
    const storage = createStorageProvider();
    const ttsService = createTtsOrchestrationService({ audioProvider, storage });

    const result = await ttsService.generateSegmentAudio(
      { userId: TEST_USER },
      segmentId,
      { projectId, episodeId: null, sceneId: null }
    );

    expect(result.status).toBe("completed");
    expect(result.mediaAssetId).not.toBeNull();
  });
});