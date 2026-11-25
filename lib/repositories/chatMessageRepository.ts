import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { chatMessageModel, type ChatMessageShape } from "@/lib/models/chatMessage";
import { ownedQuery } from "@/lib/repositories/ownership";
import type { ChatAgentId, ChatRole, MessageRecord, ToolCall, TokenUsage } from "@/lib/assistant/types";

type ChatMessageDoc = ChatMessageShape & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: ChatMessageDoc): MessageRecord {
  return {
    id: doc._id.toString(),
    conversationId: doc.conversationId.toString(),
    role: doc.role as ChatRole,
    content: doc.content,
    provider: doc.provider as ChatAgentId,
    model: doc.model,
    toolCalls: doc.toolCalls?.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.args,
      result: tc.result,
      status: tc.status as ToolCall["status"],
    })),
    usage: doc.usage
      ? {
          promptTokens: doc.usage.promptTokens,
          completionTokens: doc.usage.completionTokens,
          totalTokens: doc.usage.totalTokens,
        }
      : undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function model() {
  const connection = await connectDB();
  return chatMessageModel(connection);
}

export type MessageCreateInput = {
  role: ChatRole;
  content: string;
  provider: ChatAgentId;
  model: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
};

export const chatMessageRepository = {
  async listForConversation(
    clerkUserId: string,
    conversationId: string
  ): Promise<MessageRecord[]> {
    const ChatMessage = await model();
    const docs = await ChatMessage
      .find({
        ...ownedQuery(clerkUserId),
        conversationId: new mongoose.Types.ObjectId(conversationId),
      })
      .sort({ createdAt: 1 })
      .lean<ChatMessageDoc[]>();
    return docs.map(toRecord);
  },

  async create(
    clerkUserId: string,
    conversationId: string,
    input: MessageCreateInput
  ): Promise<MessageRecord> {
    const ChatMessage = await model();
    const doc = await ChatMessage.create({
      clerkUserId,
      conversationId: new mongoose.Types.ObjectId(conversationId),
      role: input.role,
      content: input.content,
      provider: input.provider,
      model: input.model,
      toolCalls: input.toolCalls ?? [],
      usage: input.usage ?? null,
    });
    return toRecord(doc as unknown as ChatMessageDoc);
  },

  async removeForConversation(clerkUserId: string, conversationId: string): Promise<void> {
    const ChatMessage = await model();
    await ChatMessage.deleteMany({
      ...ownedQuery(clerkUserId),
      conversationId: new mongoose.Types.ObjectId(conversationId),
    });
  },
};