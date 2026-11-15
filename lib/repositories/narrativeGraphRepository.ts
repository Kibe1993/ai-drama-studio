import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connect";
import { narrativeGraphModel } from "@/lib/models/narrativeGraph";
import { projectModel } from "@/lib/models/project";
import type { NarrativeGraphRecord } from "@/lib/validation/narrativeGraph";
import { narrativeGraphSchema } from "@/lib/validation/narrativeGraph";

type GraphDoc = NarrativeGraphRecord & {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(doc: GraphDoc): NarrativeGraphRecord {
  const parsed = narrativeGraphSchema.safeParse({
    nodes: doc.nodes ?? [],
    edges: doc.edges ?? [],
    asOfEpisode: doc.asOfEpisode ?? 0,
    basedOnPlanVersion: doc.basedOnPlanVersion ?? 0,
    version: doc.version ?? 1,
  });
  return {
    ...(parsed.success ? parsed.data : { nodes: [], edges: [], asOfEpisode: 0, basedOnPlanVersion: 0, version: 1 }),
    id: doc._id.toString(),
    clerkUserId: doc.clerkUserId,
    projectId: doc.projectId.toString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function models() {
  const connection = await connectDB();
  return { Graph: narrativeGraphModel(connection), Project: projectModel(connection) };
}

export const narrativeGraphRepository = {
  async upsert(
    clerkUserId: string,
    projectId: string,
    input: {
      nodes: NarrativeGraphRecord["nodes"];
      edges: NarrativeGraphRecord["edges"];
      asOfEpisode: number;
      basedOnPlanVersion: number;
    }
  ): Promise<NarrativeGraphRecord | null> {
    const { Graph, Project } = await models();
    if (!(await Project.exists({ clerkUserId, _id: projectId }))) return null;
    const latest = await Graph.findOne({ clerkUserId, projectId })
      .sort({ version: -1 })
      .lean<GraphDoc | null>();
    const version = (latest?.version ?? 0) + 1;
    const doc = await Graph.create({
      clerkUserId,
      projectId,
      nodes: input.nodes,
      edges: input.edges,
      asOfEpisode: input.asOfEpisode,
      basedOnPlanVersion: input.basedOnPlanVersion,
      version,
    });
    return toRecord(doc.toObject() as unknown as GraphDoc);
  },

  async findLatest(clerkUserId: string, projectId: string): Promise<NarrativeGraphRecord | null> {
    const { Graph } = await models();
    const doc = await Graph.findOne({ clerkUserId, projectId })
      .sort({ version: -1 })
      .lean<GraphDoc | null>();
    return doc ? toRecord(doc) : null;
  },
};