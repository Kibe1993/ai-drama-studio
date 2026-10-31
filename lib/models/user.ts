import { Schema, type Connection, type Model } from "mongoose";
import type { ProjectLanguage } from "@/lib/domain/projectCatalog";

export type StudioUserShape = {
  clerkUserId: string;
  email: string;
  name: string;
  avatar: string;
  preferences: { language: ProjectLanguage | string };
  subscription: { plan: "free"; status: "active" };
  usageCounters: {
    storyGenerations: number;
    imageGenerations: number;
    videoGenerations: number;
    audioGenerations: number;
    renderJobs: number;
  };
};

const UserSchema = new Schema(
  {
    clerkUserId: { type: String, required: true, unique: true },
    email: { type: String, default: "" },
    name: { type: String, default: "" },
    avatar: { type: String, default: "" },
    preferences: {
      language: { type: String, default: "en" },
    },
    subscription: {
      plan: { type: String, enum: ["free"], default: "free" },
      status: { type: String, enum: ["active"], default: "active" },
    },
    usageCounters: {
      storyGenerations: { type: Number, default: 0 },
      imageGenerations: { type: Number, default: 0 },
      videoGenerations: { type: Number, default: 0 },
      audioGenerations: { type: Number, default: 0 },
      renderJobs: { type: Number, default: 0 },
    },
  },
  { timestamps: true, collection: "users" }
);

export function userModel(connection: Connection): Model<StudioUserShape> {
  return (
    (connection.models.StudioUser as Model<StudioUserShape> | undefined) ??
    connection.model<StudioUserShape>("StudioUser", UserSchema)
  );
}
