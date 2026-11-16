import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { narrativeRegistryModel } from "@/lib/models/narrativeRegistry";
import { projectModel } from "@/lib/models/project";
import { ownedQuery } from "@/lib/repositories/ownership";
import { JobError } from "@/lib/pipeline/types";
import {
  narrativeRegistrySchema,
  type NarrativeRegistry,
} from "@/lib/validation/narrativeEngine";

type RegistryDoc = {
  _id: mongoose.Types.ObjectId;
  clerkUserId: string;
  projectId: mongoose.Types.ObjectId;
  schemaVersion: number;
  seasonId: string;
  entities: unknown[];
  events: unknown[];
  relationships: unknown[];
  threads: unknown[];
  episodeStates: unknown[];
  causalLinks: unknown[];
  basedOnBibleVersion: number;
  basedOnPlanVersion: number;
  registryVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: RegistryDoc): NarrativeRegistry & { registryVersion: number } {
  const parsed = narrativeRegistrySchema.parse({
    schemaVersion: doc.schemaVersion,
    seasonId: doc.seasonId,
    entities: doc.entities ?? [],
    events: doc.events ?? [],
    relationships: doc.relationships ?? [],
    threads: doc.threads ?? [],
    episodeStates: doc.episodeStates ?? [],
    causalLinks: doc.causalLinks ?? [],
  });
  return { ...parsed, registryVersion: doc.registryVersion };
}

async function models() {
  const connection = await connectDB();
  return { Registry: narrativeRegistryModel(connection), Project: projectModel(connection) };
}

export type NarrativeRegistryDraft = NarrativeRegistry & {
  clerkUserId: string;
  projectId: string;
  basedOnBibleVersion: number;
  basedOnPlanVersion: number;
};

export const narrativeRegistryRepository = {
  async upsert(input: NarrativeRegistryDraft): Promise<NarrativeRegistry & { registryVersion: number }> {
    const { Registry, Project } = await models();
    if (!(await Project.exists(ownedQuery(input.clerkUserId, input.projectId)))) {
      throw new JobError("Project not found for narrative registry.", "not_found", false);
    }
    const latest = await Registry.findOne({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
    })
      .sort({ registryVersion: -1 })
      .lean<{ registryVersion: number } | null>();
    const doc = await Registry.create({
      clerkUserId: input.clerkUserId,
      projectId: input.projectId,
      schemaVersion: input.schemaVersion,
      seasonId: input.seasonId,
      entities: input.entities,
      events: input.events,
      relationships: input.relationships,
      threads: input.threads,
      episodeStates: input.episodeStates,
      causalLinks: input.causalLinks,
      basedOnBibleVersion: input.basedOnBibleVersion,
      basedOnPlanVersion: input.basedOnPlanVersion,
      registryVersion: (latest?.registryVersion ?? 0) + 1,
    });
    return toRecord(doc.toObject() as unknown as RegistryDoc);
  },

  async findLatest(clerkUserId: string, projectId: string): Promise<(NarrativeRegistry & { registryVersion: number }) | null> {
    const { Registry, Project } = await models();
    if (!(await Project.exists(ownedQuery(clerkUserId, projectId)))) return null;
    const doc = await Registry.findOne({ clerkUserId, projectId })
      .sort({ registryVersion: -1 })
      .lean<RegistryDoc | null>();
    if (!doc) return null;
    return toRecord(doc);
  },
};