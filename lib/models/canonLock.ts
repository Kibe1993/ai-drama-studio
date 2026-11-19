import { Schema, type Connection, type Model } from "mongoose";

export type CanonLockShape = {
  clerkUserId: string;
  projectId: string;
  fencingToken: number;
  jobId: string;
  acquiredAt: Date;
  expiresAt: Date;
};

const canonLockSchema = new Schema(
  {
    clerkUserId: { type: String, required: true, trim: true },
    projectId: { type: String, required: true, trim: true },
    fencingToken: { type: Number, required: true, min: 1 },
    jobId: { type: String, required: true, trim: true },
    acquiredAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "canonLocks" },
);

canonLockSchema.index({ clerkUserId: 1, projectId: 1 }, { unique: true });

export function canonLockModel(connection: Connection): Model<CanonLockShape> {
  return (
    (connection.models.StudioCanonLock as Model<CanonLockShape> | undefined) ??
    connection.model<CanonLockShape>("StudioCanonLock", canonLockSchema)
  );
}