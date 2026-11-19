import { connectDB } from "@/lib/db/connect";
import mongoose from "mongoose";
import {
  canonExtractionOutboxModel,
  type CanonExtractionOutboxShape,
  type OutboxStatus,
} from "@/lib/models/canonExtractionOutbox";

function isDuplicateKey(error: unknown): boolean {
  return error instanceof Error && error.message.includes("E11000");
}

type OutboxDoc = CanonExtractionOutboxShape & { _id: mongoose.Types.ObjectId };

export type OutboxRecord = OutboxDoc;

export const canonExtractionOutboxRepository = {
  async enqueue(input: {
    clerkUserId: string;
    projectId: string;
    episodeId: string;
    storyId: string;
    commitBatchId: string;
  }): Promise<{ enqueued: true } | { enqueued: false; reason: "duplicate" }> {
    const connection = await connectDB();
    const Outbox = canonExtractionOutboxModel(connection);
    try {
      await Outbox.create({
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
        episodeId: input.episodeId,
        storyId: input.storyId,
        commitBatchId: input.commitBatchId,
        status: "pending" as OutboxStatus,
        error: null,
        dispatchedAt: null,
        completedAt: null,
      });
      return { enqueued: true };
    } catch (error) {
      if (isDuplicateKey(error)) {
        return { enqueued: false, reason: "duplicate" };
      }
      throw error;
    }
  },

  async claimPending(input: {
    clerkUserId: string;
    limit?: number;
  }): Promise<OutboxRecord[]> {
    const connection = await connectDB();
    const Outbox = canonExtractionOutboxModel(connection);
    const now = new Date();
    const docs = await Outbox.find({
      clerkUserId: input.clerkUserId,
      status: "pending",
    })
      .sort({ createdAt: 1 })
      .limit(input.limit ?? 10)
      .lean<OutboxDoc[]>();

    const claimed: OutboxRecord[] = [];
    for (const doc of docs) {
      const updated = await Outbox.findOneAndUpdate(
        { _id: doc._id, status: "pending" },
        { $set: { status: "dispatched" as OutboxStatus, dispatchedAt: now } },
        { new: true },
      ).lean<OutboxDoc | null>();
      if (updated) {
        claimed.push(updated);
      }
    }
    return claimed;
  },

  async markCompleted(input: {
    clerkUserId: string;
    commitBatchId: string;
  }): Promise<void> {
    const connection = await connectDB();
    const Outbox = canonExtractionOutboxModel(connection);
    await Outbox.updateOne(
      { clerkUserId: input.clerkUserId, commitBatchId: input.commitBatchId },
      {
        $set: {
          status: "completed" as OutboxStatus,
          completedAt: new Date(),
        },
      },
    );
  },

  async markFailed(input: {
    clerkUserId: string;
    commitBatchId: string;
    error: string;
  }): Promise<void> {
    const connection = await connectDB();
    const Outbox = canonExtractionOutboxModel(connection);
    await Outbox.updateOne(
      { clerkUserId: input.clerkUserId, commitBatchId: input.commitBatchId },
      {
        $set: {
          status: "failed" as OutboxStatus,
          error: input.error,
        },
      },
    );
  },

  async findPending(input: {
    clerkUserId: string;
    projectId: string;
  }): Promise<OutboxRecord[]> {
    const connection = await connectDB();
    const Outbox = canonExtractionOutboxModel(connection);
    const docs = await Outbox.find({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      status: { $in: ["pending", "dispatched"] as OutboxStatus[] },
    })
      .sort({ createdAt: 1 })
      .lean<OutboxDoc[]>();
    return docs;
  },
};