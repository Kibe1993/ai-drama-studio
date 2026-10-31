import mongoose from "mongoose";

export function isObjectId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value) && mongoose.Types.ObjectId.isValid(value);
}

/**
 * Every user-owned query goes through this. An empty id must not become a
 * filter that matches every document.
 */
export function ownedQuery(clerkUserId: string, id?: string): { clerkUserId: string; _id?: string } {
  if (!clerkUserId) {
    throw new Error("A user id is required");
  }
  return id ? { clerkUserId, _id: id } : { clerkUserId };
}
