import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { timelineModel } from "@/lib/models/timeline";
import type { TimelineRecord, ValidationResult } from "@/lib/validation/timeline";

type TimelineDoc = TimelineRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  episodeId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: TimelineDoc): TimelineRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    episodeId: doc.episodeId.toString(),
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export const timelineRepository = {
  async create(
    clerkUserId: string,
    input: Omit<TimelineRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt">
  ): Promise<TimelineRecord> {
    const Timeline = timelineModel(await connectDB());
    const created = await Timeline.create({ ...input, clerkUserId });
    return toRecord(created.toObject() as unknown as TimelineDoc);
  },

  async findByEpisode(
    clerkUserId: string,
    episodeId: string
  ): Promise<TimelineRecord | null> {
    const Timeline = timelineModel(await connectDB());
    const doc = await Timeline.findOne({ clerkUserId, episodeId }).lean<TimelineDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async findOwned(
    clerkUserId: string,
    timelineId: string
  ): Promise<TimelineRecord | null> {
    const Timeline = timelineModel(await connectDB());
    const doc = await Timeline.findOne({ clerkUserId, _id: timelineId }).lean<TimelineDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async updateValidation(
    clerkUserId: string,
    timelineId: string,
    validation: ValidationResult
  ): Promise<TimelineRecord | null> {
    const Timeline = timelineModel(await connectDB());
    const doc = await Timeline.findOneAndUpdate(
      { clerkUserId, _id: timelineId },
      { validation, status: "under_review" },
      { new: true }
    ).lean<TimelineDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async approve(
    clerkUserId: string,
    timelineId: string
  ): Promise<TimelineRecord | null> {
    const Timeline = timelineModel(await connectDB());
    const doc = await Timeline.findOneAndUpdate(
      { clerkUserId, _id: timelineId },
      { status: "approved" },
      { new: true }
    ).lean<TimelineDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async markStale(
    clerkUserId: string,
    timelineId: string
  ): Promise<TimelineRecord | null> {
    const Timeline = timelineModel(await connectDB());
    const doc = await Timeline.findOneAndUpdate(
      { clerkUserId, _id: timelineId },
      { status: "stale" },
      { new: true }
    ).lean<TimelineDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};