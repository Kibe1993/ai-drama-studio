import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { voiceProfileModel } from "@/lib/models/voiceProfile";
import type { VoiceProfileRecord } from "@/lib/validation/voiceProfile";

type ProfileDoc = VoiceProfileRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  canonicalEntityId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: ProfileDoc): VoiceProfileRecord {
  return {
    ...doc,
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    canonicalEntityId: doc.canonicalEntityId.toString(),
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export const voiceProfileRepository = {
  async create(
    clerkUserId: string,
    input: Omit<VoiceProfileRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt">
  ): Promise<VoiceProfileRecord> {
    const VoiceProfile = voiceProfileModel(await connectDB());
    const created = await VoiceProfile.create({ ...input, clerkUserId });
    return toRecord(created.toObject() as unknown as ProfileDoc);
  },

  async findApprovedForCharacter(
    clerkUserId: string,
    canonicalEntityId: string
  ): Promise<VoiceProfileRecord | null> {
    const VoiceProfile = voiceProfileModel(await connectDB());
    const doc = await VoiceProfile.findOne({
      clerkUserId,
      canonicalEntityId,
      status: "approved",
    }).lean<ProfileDoc | null>();
    return doc ? toRecord(doc) : null;
  },

  async listByProject(
    clerkUserId: string,
    projectId: string
  ): Promise<VoiceProfileRecord[]> {
    const VoiceProfile = voiceProfileModel(await connectDB());
    const docs = await VoiceProfile.find({ clerkUserId, projectId })
      .sort({ updatedAt: -1 })
      .lean<ProfileDoc[]>();
    return docs.map(toRecord);
  },

  async approve(
    clerkUserId: string,
    profileId: string
  ): Promise<VoiceProfileRecord | null> {
    const VoiceProfile = voiceProfileModel(await connectDB());
    const doc = await VoiceProfile.findOneAndUpdate(
      { clerkUserId, _id: profileId },
      { status: "approved" },
      { new: true }
    ).lean<ProfileDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};