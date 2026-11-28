import { Schema, type Connection, type Model } from "mongoose";

export type ChatMessageShape = {
  clerkUserId: string;
  conversationId: Schema.Types.ObjectId;
  role: string;
  content: string;
  provider: string;
  model: string;
  toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result: string;
    status: string;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
};

const ChatMessageSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    conversationId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ["user", "assistant", "tool", "system"], required: true },
    content: { type: String, default: "" },
    provider: { type: String, enum: ["openai", "gemini", "deepseek", "groq"], required: true },
    model: { type: String, default: "" },
    toolCalls: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        args: { type: Schema.Types.Mixed, required: true },
        result: { type: String, default: "" },
        status: {
          type: String,
          enum: ["pending", "success", "error", "awaiting_approval", "rejected"],
          default: "pending",
        },
      },
    ],
    usage: {
      promptTokens: { type: Number },
      completionTokens: { type: Number },
      totalTokens: { type: Number },
    },
  },
  { timestamps: true, collection: "chatMessages" }
);

ChatMessageSchema.index({ clerkUserId: 1, conversationId: 1, createdAt: 1 });
ChatMessageSchema.index({ clerkUserId: 1, conversationId: 1, role: 1 });

export function chatMessageModel(connection: Connection): Model<ChatMessageShape> {
  return (
    (connection.models.StudioChatMessage as Model<ChatMessageShape> | undefined) ??
    connection.model<ChatMessageShape>("StudioChatMessage", ChatMessageSchema)
  );
}