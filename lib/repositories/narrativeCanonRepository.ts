import mongoose from "mongoose";
import { VersionConflict } from "@/lib/domain/narrativeControl/store";
import { connectDB } from "@/lib/db/connect";
import { narrativeCanonModel } from "@/lib/models/narrativeCanon";
import { projectModel } from "@/lib/models/project";
import { ownedQuery } from "@/lib/repositories/ownership";
import { JobError } from "@/lib/pipeline/types";
import { canonStateSchema, type CanonState } from "@/lib/validation/narrativeControl";

type CanonDoc = {
  _id: mongoose.Types.ObjectId;
  clerkUserId: string;
  projectId: string;
  version: number;
  reason: string;
  state: unknown;
};

async function models() {
  const connection = await connectDB();
  return { Canon: narrativeCanonModel(connection), Project: projectModel(connection) };
}

function readState(doc: CanonDoc): CanonState {
  return canonStateSchema.parse(doc.state);
}

/**
 * Append-only canon versions in the existing Mongo database.
 * A commit whose expected version is not the latest version is rejected.
 */
export const narrativeCanonRepository = {
  async latest(clerkUserId: string, projectId: string): Promise<CanonState | null> {
    const { Canon, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Canon.findOne({ clerkUserId, projectId }).sort({ version: -1 }).lean<CanonDoc | null>();
    return doc ? readState(doc) : null;
  },

  async at(clerkUserId: string, projectId: string, version: number): Promise<CanonState | null> {
    const { Canon, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Canon.findOne({ clerkUserId, projectId, version }).lean<CanonDoc | null>();
    return doc ? readState(doc) : null;
  },

  async commit(input: {
    clerkUserId: string;
    projectId: string;
    expectedVersion: number;
    state: CanonState;
    reason: string;
  }): Promise<CanonState> {
    const { Canon, Project } = await models();
    if (!(await Project.exists(ownedQuery(input.clerkUserId, input.projectId)))) {
      throw new JobError("Project not found for narrative canon.", "not_found", false);
    }
    const latest = await Canon.findOne({ clerkUserId: input.clerkUserId, projectId: input.projectId })
      .sort({ version: -1 })
      .lean<{ version: number } | null>();
    const actual = latest?.version ?? 0;
    if (actual !== input.expectedVersion) {
      throw new VersionConflict(`Canon version ${input.expectedVersion} is stale. The current version is ${actual}.`);
    }
    const next = canonStateSchema.parse({
      ...input.state,
      projectId: input.projectId,
      version: actual + 1,
      revisionLog: [
        ...(input.state.revisionLog ?? []),
        { version: actual + 1, reason: input.reason, changeIds: ["commit"] },
      ],
    });
    await Canon.create({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      version: next.version,
      basedOnBibleVersion: next.basedOnBibleVersion,
      basedOnPlanVersion: next.basedOnPlanVersion,
      reason: input.reason,
      state: next,
    });
    const { markStaleCanonArtifacts } = await import("@/lib/repositories/artifactProvenanceRepository");
    await markStaleCanonArtifacts({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      canonVersion: next.version,
      reason: input.reason,
    });
    return next;
  },
};
