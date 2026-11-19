import { Schema, model, type Connection } from "mongoose";

const canonFactSchema = new Schema({
  clerkUserId: { type: String, required: true, trim: true, index: true },
  projectId: { type: String, required: true, trim: true, index: true },
  sequence: { type: Number, required: true, min: 1 },
  episode: { type: Number, required: true, min: 0, max: 200 },
  operation: { type: String, required: true, enum: ["add", "modify", "retract", "reinterpret"] },
  kind: {
    type: String,
    required: true,
    enum: ["entity", "relationship", "event", "thread", "fact", "knowledge", "rule"],
  },
  targetId: { type: String, required: true, trim: true },
  commitBatchId: { type: String, trim: true, index: true },
  entry: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
}, { minimize: false });

canonFactSchema.index({ clerkUserId: 1, projectId: 1, sequence: 1 }, { unique: true });
canonFactSchema.index({ clerkUserId: 1, projectId: 1, id: 1 }, { unique: true });
canonFactSchema.index({ clerkUserId: 1, projectId: 1, commitBatchId: 1 }, { sparse: true });

export function canonFactModel(connection: Connection) {
  return connection.models.StudioCanonFact
    ?? model("StudioCanonFact", canonFactSchema, "canonFacts", { connection });
}