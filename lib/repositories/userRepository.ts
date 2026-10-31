import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { connectDB } from "@/lib/db/connect";
import { userModel } from "@/lib/models/user";

export async function upsertStudioUser(actor: RequestAuth): Promise<void> {
  const connection = await connectDB();
  const User = userModel(connection);
  await User.updateOne(
    { clerkUserId: actor.userId },
    {
      $set: {
        email: actor.email,
        name: actor.name,
        avatar: actor.imageUrl,
      },
      $setOnInsert: {
        clerkUserId: actor.userId,
        preferences: { language: "en" },
        subscription: { plan: "free", status: "active" },
        usageCounters: {
          storyGenerations: 0,
          imageGenerations: 0,
          videoGenerations: 0,
          audioGenerations: 0,
          renderJobs: 0,
        },
      },
    },
    { upsert: true }
  );
}

export async function readPreferences(clerkUserId: string): Promise<{ language: string }> {
  const connection = await connectDB();
  const User = userModel(connection);
  const user = await User.findOne({ clerkUserId }).lean<{ preferences?: { language?: string } }>();
  return { language: user?.preferences?.language || "en" };
}

export async function updateLanguage(clerkUserId: string, language: string): Promise<void> {
  const connection = await connectDB();
  const User = userModel(connection);
  await User.updateOne({ clerkUserId }, { $set: { "preferences.language": language } });
}
