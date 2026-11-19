import { connectDB } from "@/lib/db/connect";
import { canonLockModel, type CanonLockShape } from "@/lib/models/canonLock";

const DEFAULT_TIMEOUT_MS = 60_000;

function isDuplicateKey(error: unknown): boolean {
  return error instanceof Error && error.message.includes("E11000");
}

export type AcquireResult =
  | { acquired: true; fencingToken: number }
  | { acquired: false };

export const canonLockRepository = {
  async acquire(input: {
    clerkUserId: string;
    projectId: string;
    jobId: string;
    timeoutMs?: number;
  }): Promise<AcquireResult> {
    const connection = await connectDB();
    const Lock = canonLockModel(connection);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS));

    const takenOver = await Lock.findOneAndUpdate(
      {
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
        expiresAt: { $lt: now },
      },
      {
        $set: {
          jobId: input.jobId,
          acquiredAt: now,
          expiresAt,
        },
        $inc: { fencingToken: 1 },
      },
      { new: true },
    ).lean<CanonLockShape | null>();

    if (takenOver) {
      return { acquired: true, fencingToken: takenOver.fencingToken };
    }

    try {
      const created = await Lock.create({
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
        fencingToken: 1,
        jobId: input.jobId,
        acquiredAt: now,
        expiresAt,
      });
      return { acquired: true, fencingToken: created.fencingToken };
    } catch (error) {
      if (isDuplicateKey(error)) {
        return { acquired: false };
      }
      throw error;
    }
  },

  async renew(input: {
    clerkUserId: string;
    projectId: string;
    jobId: string;
    timeoutMs?: number;
  }): Promise<{ renewed: true; fencingToken: number } | { renewed: false }> {
    const connection = await connectDB();
    const Lock = canonLockModel(connection);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS));

    const doc = await Lock.findOneAndUpdate(
      {
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
        jobId: input.jobId,
        expiresAt: { $gt: now },
      },
      { $set: { expiresAt } },
      { new: true },
    ).lean<CanonLockShape | null>();

    if (!doc) return { renewed: false };
    return { renewed: true, fencingToken: doc.fencingToken };
  },

  async release(input: {
    clerkUserId: string;
    projectId: string;
    jobId: string;
  }): Promise<void> {
    const connection = await connectDB();
    const Lock = canonLockModel(connection);
    await Lock.deleteOne({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      jobId: input.jobId,
    });
  },

  async verify(input: {
    clerkUserId: string;
    projectId: string;
    jobId: string;
    fencingToken: number;
  }): Promise<boolean> {
    const connection = await connectDB();
    const Lock = canonLockModel(connection);
    const now = new Date();
    const doc = await Lock.findOne({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      jobId: input.jobId,
      fencingToken: input.fencingToken,
      expiresAt: { $gt: now },
    })
      .select({ fencingToken: 1 })
      .lean<{ fencingToken: number } | null>();
    return doc !== null;
  },
};