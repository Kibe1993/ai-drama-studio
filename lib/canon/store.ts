import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { canonFactModel } from "@/lib/canon/model";

import { projectModel } from "@/lib/models/project";
import { ownedQuery } from "@/lib/repositories/ownership";
import { JobError } from "@/lib/pipeline/types";
import {
  canonFactEntrySchema,
  type CanonFactEntry,
  type DerivedCanonState,
} from "@/lib/canon/schema";
import { reduceCanon, type ReduceMode } from "@/lib/canon/reduce";

export class CanonFactConflict extends Error {
  readonly code = "canon_fact_conflict";
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "CanonFactConflict";
  }
}

type FactDoc = {
  _id: mongoose.Types.ObjectId;
  clerkUserId: string;
  projectId: string;
  sequence: number;
  entry: unknown;
};

async function models() {
  const connection = await connectDB();
  return {
    CanonFact: canonFactModel(connection),
    Project: projectModel(connection),
    connection,
  };
}

function readEntry(doc: FactDoc): CanonFactEntry {
  return canonFactEntrySchema.parse(doc.entry);
}

function isDuplicateKey(error: unknown): boolean {
  return error instanceof Error && error.message.includes("E11000");
}

export const canonStore = {
  async getLatestSequence(clerkUserId: string, projectId: string): Promise<number> {
    const { CanonFact, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return 0;
    const doc = await CanonFact.findOne({ clerkUserId, projectId })
      .sort({ sequence: -1 })
      .lean<{ sequence: number } | null>();
    return doc?.sequence ?? 0;
  },

  async append(input: {
    clerkUserId: string;
    projectId: string;
    expectedSequence: number;
    entry: Omit<CanonFactEntry, "sequence" | "projectId" | "createdAt">;
  }): Promise<CanonFactEntry> {
    const { CanonFact, Project } = await models();
    if (!(await Project.exists(ownedQuery(input.clerkUserId, input.projectId)))) {
      throw new JobError("Project not found for canon fact.", "not_found", false);
    }

    const current = await this.getLatestSequence(input.clerkUserId, input.projectId);
    if (current + 1 !== input.expectedSequence) {
      throw new CanonFactConflict(
        `Expected next sequence ${input.expectedSequence} but current latest is ${current}.`,
      );
    }

    const now = new Date();
    const entry: CanonFactEntry = canonFactEntrySchema.parse({
      ...input.entry,
      projectId: input.projectId,
      sequence: input.expectedSequence,
      createdAt: now,
    });

    try {
      await CanonFact.create({
        clerkUserId: input.clerkUserId,
        projectId: input.projectId,
        sequence: entry.sequence,
        episode: entry.episode,
        operation: entry.operation,
        kind: entry.kind,
        targetId: entry.targetId,
        id: entry.id,
        commitBatchId: entry.commitBatchId,
        entry,
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new CanonFactConflict(
          `Canon fact id "${entry.id}" or sequence ${entry.sequence} already exists.`,
        );
      }
      throw error;
    }

    return entry;
  },

  async appendBatch(input: {
    clerkUserId: string;
    projectId: string;
    expectedSequence: number;
    commitBatchId: string;
    entries: Omit<CanonFactEntry, "sequence" | "projectId" | "createdAt" | "commitBatchId">[];
  }): Promise<CanonFactEntry[]> {
    const { CanonFact, Project } = await models();
    if (!(await Project.exists(ownedQuery(input.clerkUserId, input.projectId)))) {
      throw new JobError("Project not found for canon fact.", "not_found", false);
    }

    const existingDocs = await CanonFact.find({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      commitBatchId: input.commitBatchId,
    })
      .sort({ sequence: 1 })
      .lean<FactDoc[]>();

    if (existingDocs.length > 0) {
      if (existingDocs.length !== input.entries.length) {
        throw new CanonFactConflict(
          `commitBatchId "${input.commitBatchId}" exists with ${existingDocs.length} entries but retry supplies ${input.entries.length}.`,
        );
      }
      for (let i = 0; i < existingDocs.length; i += 1) {
        const existingEntry = readEntry(existingDocs[i]);
        if (existingEntry.id !== input.entries[i].id) {
          throw new CanonFactConflict(
            `commitBatchId "${input.commitBatchId}" entry ${i} has id "${existingEntry.id}" but retry supplies "${input.entries[i].id}".`,
          );
        }
      }
      return existingDocs.map(readEntry);
    }

    const current = await this.getLatestSequence(input.clerkUserId, input.projectId);
    if (current + 1 !== input.expectedSequence) {
      throw new CanonFactConflict(
        `Expected next sequence ${input.expectedSequence} but current latest is ${current}.`,
      );
    }

    const now = new Date();
    const prepared: CanonFactEntry[] = [];
    let sequence = input.expectedSequence;
    for (const partial of input.entries) {
      const entry: CanonFactEntry = canonFactEntrySchema.parse({
        ...partial,
        projectId: input.projectId,
        sequence,
        commitBatchId: input.commitBatchId,
        createdAt: now,
      });
      prepared.push(entry);
      sequence += 1;
    }

    const docs = prepared.map((entry) => ({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      sequence: entry.sequence,
      episode: entry.episode,
      operation: entry.operation,
      kind: entry.kind,
      targetId: entry.targetId,
      id: entry.id,
      commitBatchId: entry.commitBatchId,
      entry,
    }));

    try {
      await CanonFact.insertMany(docs, { ordered: true });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new CanonFactConflict(
          `Canon fact id or sequence already exists for commitBatchId "${input.commitBatchId}".`,
        );
      }
      throw error;
    }

    return prepared;
  },

  async list(clerkUserId: string, projectId: string): Promise<CanonFactEntry[]> {
    const { CanonFact, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return [];
    const docs = await CanonFact.find({ clerkUserId, projectId })
      .sort({ sequence: 1 })
      .lean<FactDoc[]>();
    return docs.map(readEntry);
  },

  async listAt(clerkUserId: string, projectId: string, upToSequence: number): Promise<CanonFactEntry[]> {
    const { CanonFact, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return [];
    const docs = await CanonFact.find({ clerkUserId, projectId, sequence: { $lte: upToSequence } })
      .sort({ sequence: 1 })
      .lean<FactDoc[]>();
    return docs.map(readEntry);
  },

  async latestState(
    clerkUserId: string,
    projectId: string,
    mode?: ReduceMode,
  ): Promise<DerivedCanonState> {
    const entries = await this.list(clerkUserId, projectId);
    return reduceCanon(projectId, entries, mode);
  },

  async stateAt(
    clerkUserId: string,
    projectId: string,
    upToSequence: number,
    mode?: ReduceMode,
  ): Promise<DerivedCanonState> {
    const entries = await this.listAt(clerkUserId, projectId, upToSequence);
    return reduceCanon(projectId, entries, mode);
  },
};