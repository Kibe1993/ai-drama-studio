import { Schema, type Connection, type Model } from "mongoose";

export type ConversationShape = {
  clerkUserId: string;
  title: string;
  provider: string;
  model: string;
  projectId: Schema.Types.ObjectId | null;
  lastMessageAt: Date;
  messageCount: number;
};

const ConversationSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    title: { type: String, required: true, default: "New Conversation", maxlength: 200 },
    provider: { type: String, enum: ["openai", "gemini", "deepseek", "groq"], required: true },
    model: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, default: null },
    lastMessageAt: { type: Date, default: Date.now },
    messageCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "conversations" }
);

ConversationSchema.index({ clerkUserId: 1, updatedAt: -1, _id: -1 });
ConversationSchema.index({ clerkUserId: 1, provider: 1, updatedAt: -1 });
ConversationSchema.index({ clerkUserId: 1, projectId: 1, updatedAt: -1 });

export function conversationModel(connection: Connection): Model<ConversationShape> {
  return (
    (connection.models.StudioConversation as Model<ConversationShape> | undefined) ??
    connection.model<ConversationShape>("StudioConversation", ConversationSchema)
  );
}