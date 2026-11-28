import "server-only";
import { connectDB } from "@/lib/db/connect";
import { chatMessageModel } from "@/lib/models/chatMessage";
import { conversationModel } from "@/lib/models/conversation";
import { ownedQuery } from "@/lib/repositories/ownership";
import { projectMemoryRepository, type ProjectMemoryRecord } from "@/lib/repositories/projectMemoryRepository";
import mongoose from "mongoose";

export type RetrievalResult = {
  source: "conversation_history" | "conversation_summary" | "project_memory" | "cross_conversation";
  conversationId: string | null;
  content: string;
  relevance: number;
  createdAt: string;
};

type LeanChatMessage = {
  _id: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  content: string;
  createdAt?: Date;
  score?: number;
};

type LeanConversation = {
  _id: mongoose.Types.ObjectId;
  title: string;
  summary: { text: string | null } | null;
};

export const memoryRetrievalService = {
  async searchHistory(
    clerkUserId: string,
    conversationId: string,
    query: string,
    limit = 5,
  ): Promise<RetrievalResult[]> {
    const connection = await connectDB();
    const ChatMessage = chatMessageModel(connection);
    const docs = await ChatMessage.find(
      {
        ...ownedQuery(clerkUserId),
        conversationId: new mongoose.Types.ObjectId(conversationId),
        $text: { $search: query },
      },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean<LeanChatMessage[]>();

    return docs.map((doc) => ({
      source: "conversation_history" as const,
      conversationId,
      content: doc.content,
      relevance: doc.score ?? 1,
      createdAt: doc.createdAt?.toISOString() ?? new Date().toISOString(),
    }));
  },

  async searchProjectMemory(
    clerkUserId: string,
    projectId: string,
    query: string,
    limit = 5,
  ): Promise<ProjectMemoryRecord[]> {
    return projectMemoryRepository.search(clerkUserId, projectId, query, limit);
  },

  async searchAcrossConversations(
    clerkUserId: string,
    projectId: string | null,
    query: string,
    limit = 5,
  ): Promise<RetrievalResult[]> {
    const connection = await connectDB();
    const Conversation = conversationModel(connection);
    const ChatMessage = chatMessageModel(connection);

    const convFilter: Record<string, unknown> = ownedQuery(clerkUserId);
    if (projectId) convFilter.projectId = new mongoose.Types.ObjectId(projectId);
    const conversations = await Conversation.find(convFilter).limit(50).lean<LeanConversation[]>();

    const convIds = conversations.map((c) => c._id);
    if (convIds.length === 0) return [];

    const docs = await ChatMessage.find(
      {
        ...ownedQuery(clerkUserId),
        conversationId: { $in: convIds },
        $text: { $search: query },
      },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean<LeanChatMessage[]>();

    return docs.map((doc) => ({
      source: "cross_conversation" as const,
      conversationId: doc.conversationId?.toString() ?? null,
      content: doc.content,
      relevance: doc.score ?? 1,
      createdAt: doc.createdAt?.toISOString() ?? new Date().toISOString(),
    }));
  },

  async getConversationSummaries(
    clerkUserId: string,
    projectId: string | null,
  ): Promise<Array<{ conversationId: string; title: string; summary: string }>> {
    const connection = await connectDB();
    const Conversation = conversationModel(connection);
    const filter: Record<string, unknown> = {
      ...ownedQuery(clerkUserId),
      "summary.text": { $ne: null },
    };
    if (projectId) filter.projectId = new mongoose.Types.ObjectId(projectId);
    const docs = await Conversation.find(filter).limit(20).lean<LeanConversation[]>();
    return docs.map((d) => ({
      conversationId: d._id.toString(),
      title: d.title,
      summary: d.summary?.text ?? "",
    }));
  },

  async retrieve(
    clerkUserId: string,
    params: {
      conversationId: string | null;
      projectId: string | null;
      query: string;
      limit?: number;
    },
  ): Promise<RetrievalResult[]> {
    const limit = params.limit ?? 5;
    const results: RetrievalResult[] = [];

    if (params.conversationId) {
      const history = await this.searchHistory(clerkUserId, params.conversationId, params.query, limit);
      results.push(...history);
    }

    if (params.projectId) {
      const memories = await this.searchProjectMemory(clerkUserId, params.projectId, params.query, limit);
      for (const m of memories) {
        results.push({
          source: "project_memory",
          conversationId: m.conversationId,
          content: `[${m.category}] ${m.key}: ${m.value} (${m.status})`,
          relevance: 1,
          createdAt: m.updatedAt,
        });
      }

      const crossConv = await this.searchAcrossConversations(clerkUserId, params.projectId, params.query, limit);
      results.push(...crossConv);
    }

    return results.slice(0, limit * 3);
  },
};