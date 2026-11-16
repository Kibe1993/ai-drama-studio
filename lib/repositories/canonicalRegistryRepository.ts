import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { canonicalRegistryModel } from "@/lib/models/canonicalRegistry";
import { projectModel } from "@/lib/models/project";
import { ownedQuery } from "@/lib/repositories/ownership";
import { JobError } from "@/lib/pipeline/types";
import {
  canonicalEntityRegistrySchema,
  type CanonicalEntityRegistry,
  type CanonicalEntityRegistryRecord,
} from "@/lib/validation/canonicalRegistry";

type RegistryDoc = {
  _id: mongoose.Types.ObjectId;
  clerkUserId: string;
  projectId: mongoose.Types.ObjectId;
  entities: unknown[];
  lifecycles: unknown[];
  basedOnBibleVersion: number;
  basedOnPlanVersion: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: RegistryDoc): CanonicalEntityRegistryRecord {
  const parsed = canonicalEntityRegistrySchema.parse({
    entities: doc.entities ?? [],
    lifecycles: doc.lifecycles ?? [],
  });
  return {
    ...parsed,
    id: doc._id.toString(),
    clerkUserId: doc.clerkUserId,
    projectId: doc.projectId.toString(),
    basedOnBibleVersion: doc.basedOnBibleVersion,
    basedOnPlanVersion: doc.basedOnPlanVersion,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function models() {
  const connection = await connectDB();
  return { Registry: canonicalRegistryModel(connection), Project: projectModel(connection) };
}

export type CanonicalRegistryDraft = CanonicalEntityRegistry & {
  clerkUserId: string;
  projectId: string;
  basedOnBibleVersion: number;
  basedOnPlanVersion: number;
};

export const canonicalRegistryRepository = {
  async upsert(input: CanonicalRegistryDraft): Promise<CanonicalEntityRegistryRecord> {
    const { Registry, Project } = await models();
    if (!(await Project.exists(ownedQuery(input.clerkUserId, input.projectId)))) {
      throw new JobError("Project not found for canonical registry.", "not_found", false);
    }
    const latest = await Registry.findOne({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
    })
      .sort({ version: -1 })
      .lean<{ version: number } | null>();
    const doc = await Registry.create({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      entities: input.entities,
      lifecycles: input.lifecycles,
      basedOnBibleVersion: input.basedOnBibleVersion,
      basedOnPlanVersion: input.basedOnPlanVersion,
      version: (latest?.version ?? 0) + 1,
    });
    return toRecord(doc.toObject() as unknown as RegistryDoc);
  },

  async findLatest(clerkUserId: string, projectId: string): Promise<CanonicalEntityRegistryRecord | null> {
    const { Registry, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Registry.findOne({ clerkUserId, projectId })
      .sort({ version: -1 })
      .lean<RegistryDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};