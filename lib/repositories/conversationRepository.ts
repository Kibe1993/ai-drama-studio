import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { conversationModel, type ConversationShape } from "@/lib/models/conversation";
import { ownedQuery } from "@/lib/repositories/ownership";
import type { ListCursor } from "@/lib/repositories/cursor";
import type { ChatAgentId, ConversationCreateInput, ConversationRecord } from "@/lib/assistant/types";

type ConversationDoc = ConversationShape & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: ConversationDoc): ConversationRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    provider: doc.provider as ChatAgentId,
    model: doc.model,
    projectId: doc.projectId?.toString() ?? null,
    lastMessageAt: doc.lastMessageAt.toISOString(),
    messageCount: doc.messageCount,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function model() {
  const connection = await connectDB();
  return conversationModel(connection);
}

export const conversationRepository = {
  async list(
    clerkUserId: string,
    cursor: ListCursor | null,
    limit: number,
    provider?: ChatAgentId,
    projectId?: string
  ): Promise<ConversationRecord[]> {
    const Conversation = await model();
    const filter: Record<string, unknown> = ownedQuery(clerkUserId);
    if (provider) filter.provider = provider;
    if (projectId) filter.projectId = new mongoose.Types.ObjectId(projectId);
    if (cursor) {
      const updatedAt = new Date(cursor.updatedAt);
      filter.$or = [
        { updatedAt: { $lt: updatedAt } },
        { updatedAt, _id: { $lt: cursor.id } },
      ];
    }
    const docs = await Conversation
      .find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit)
      .lean<ConversationDoc[]>();
    return docs.map(toRecord);
  },

  async findOwned(clerkUserId: string, id: string): Promise<ConversationRecord | null> {
    const Conversation = await model();
    const doc = await Conversation.findOne(ownedQuery(clerkUserId, id)).lean<ConversationDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async create(
    clerkUserId: string,
    input: ConversationCreateInput
  ): Promise<ConversationRecord> {
    const Conversation = await model();
    const doc = await Conversation.create({
      clerkUserId,
      title: input.title ?? "New Conversation",
      provider: input.provider,
      model: input.model,
      projectId: input.projectId ? new mongoose.Types.ObjectId(input.projectId) : null,
      lastMessageAt: new Date(),
      messageCount: 0,
    });
    return toRecord(doc as unknown as ConversationDoc);
  },

  async update(
    clerkUserId: string,
    id: string,
    patch: Partial<Pick<ConversationRecord, "title" | "model">>
  ): Promise<ConversationRecord | null> {
    const Conversation = await model();
    const doc = await Conversation.findOneAndUpdate(
      ownedQuery(clerkUserId, id),
      { $set: patch },
      { new: true }
    ).lean<ConversationDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async touch(clerkUserId: string, id: string): Promise<void> {
    const Conversation = await model();
    await Conversation.updateOne(ownedQuery(clerkUserId, id), {
      $set: { lastMessageAt: new Date() },
      $inc: { messageCount: 1 },
    });
  },

  async remove(clerkUserId: string, id: string): Promise<void> {
    const Conversation = await model();
    await Conversation.deleteOne(ownedQuery(clerkUserId, id));
  },
};