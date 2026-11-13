import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { continuityLedgerModel } from "@/lib/models/continuityLedger";
import { projectModel } from "@/lib/models/project";
import { ownedQuery } from "@/lib/repositories/ownership";
import { JobError } from "@/lib/pipeline/types";
import {
  continuityLedgerSchema,
  type ContinuityLedger,
  type ContinuityLedgerRecord,
} from "@/lib/validation/continuityLedger";

type LedgerDoc = {
  _id: mongoose.Types.ObjectId;
  clerkUserId: string;
  projectId: mongoose.Types.ObjectId;
  events: unknown[];
  characterStates: unknown[];
  locationStates: unknown[];
  objectStates: unknown[];
  revealedSecrets: string[];
  unresolvedThreads: unknown[];
  consequences: string[];
  timelineNotes: string;
  asOfEpisode: number;
  basedOnPlanVersion: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: LedgerDoc): ContinuityLedgerRecord {
  const parsed = continuityLedgerSchema.parse({
    events: doc.events ?? [],
    characterStates: doc.characterStates ?? [],
    locationStates: doc.locationStates ?? [],
    objectStates: doc.objectStates ?? [],
    revealedSecrets: doc.revealedSecrets ?? [],
    unresolvedThreads: doc.unresolvedThreads ?? [],
    consequences: doc.consequences ?? [],
    timelineNotes: doc.timelineNotes ?? "",
  });
  return {
    ...parsed,
    id: doc._id.toString(),
    clerkUserId: doc.clerkUserId,
    projectId: doc.projectId.toString(),
    asOfEpisode: doc.asOfEpisode,
    basedOnPlanVersion: doc.basedOnPlanVersion,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function models() {
  const connection = await connectDB();
  return { Ledger: continuityLedgerModel(connection), Project: projectModel(connection) };
}

export type ContinuityLedgerDraft = ContinuityLedger & {
  clerkUserId: string;
  projectId: string;
  asOfEpisode: number;
  basedOnPlanVersion: number;
};

export const continuityLedgerRepository = {
  /** Insert a new ledger version for a project. */
  async upsert(input: ContinuityLedgerDraft): Promise<ContinuityLedgerRecord> {
    const { Ledger, Project } = await models();
    if (!(await Project.exists(ownedQuery(input.clerkUserId, input.projectId)))) {
      throw new JobError("Project not found for continuity ledger.", "not_found", false);
    }
    const latest = await Ledger.findOne({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
    })
      .sort({ version: -1 })
      .lean<{ version: number } | null>();
    const doc = await Ledger.create({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      events: input.events,
      characterStates: input.characterStates,
      locationStates: input.locationStates,
      objectStates: input.objectStates,
      revealedSecrets: input.revealedSecrets,
      unresolvedThreads: input.unresolvedThreads,
      consequences: input.consequences,
      timelineNotes: input.timelineNotes,
      asOfEpisode: input.asOfEpisode,
      basedOnPlanVersion: input.basedOnPlanVersion,
      version: (latest?.version ?? 0) + 1,
    });
    return toRecord(doc.toObject() as unknown as LedgerDoc);
  },

  /** Find the latest ledger for a project. */
  async findLatest(clerkUserId: string, projectId: string): Promise<ContinuityLedgerRecord | null> {
    const { Ledger, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Ledger.findOne({ clerkUserId, projectId })
      .sort({ version: -1 })
      .lean<LedgerDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};
