import { Schema, type Connection, type Model } from "mongoose";

const relationshipSchema = new Schema(
  {
    characterName: { type: String, required: true, maxlength: 80 },
    relationship: { type: String, required: true, maxlength: 300 },
    tensionOrChange: { type: String, required: true, maxlength: 300 },
  },
  { _id: false }
);

const characterStateSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    currentLocation: { type: String, required: true, maxlength: 200 },
    currentObjective: { type: String, required: true, maxlength: 400 },
    knowledge: { type: [String], default: [] },
    beliefs: { type: [String], default: [] },
    motivations: { type: [String], default: [] },
    emotionalState: { type: String, required: true, maxlength: 300 },
    physicalState: { type: String, default: "", maxlength: 300 },
    relationships: { type: [relationshipSchema], default: [] },
  },
  { _id: false }
);

const continuityEventSchema = new Schema(
  {
    episodeNumber: { type: Number, required: true, min: 1, max: 100 },
    event: { type: String, required: true, maxlength: 400 },
    consequence: { type: String, required: true, maxlength: 400 },
    affectedCharacters: { type: [String], default: [] },
    revealedInformation: { type: [String], default: [] },
  },
  { _id: false }
);

const locationStateSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    currentState: { type: String, required: true, maxlength: 400 },
    lastSeenEpisode: { type: Number, required: true, min: 1, max: 100 },
  },
  { _id: false }
);

const objectStateSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    ownership: { type: String, required: true, maxlength: 200 },
    condition: { type: String, required: true, maxlength: 300 },
    lastSeenEpisode: { type: Number, required: true, min: 1, max: 100 },
  },
  { _id: false }
);

const unresolvedThreadSchema = new Schema(
  {
    thread: { type: String, required: true, maxlength: 400 },
    introducedInEpisode: { type: Number, required: true, min: 1, max: 100 },
    status: { type: String, enum: ["open", "developing", "resolved"], default: "open" },
  },
  { _id: false }
);

const ContinuityLedgerSchema = new Schema(
  {
    clerkUserId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    events: { type: [continuityEventSchema], default: [] },
    characterStates: { type: [characterStateSchema], default: [] },
    locationStates: { type: [locationStateSchema], default: [] },
    objectStates: { type: [objectStateSchema], default: [] },
    revealedSecrets: { type: [String], default: [] },
    unresolvedThreads: { type: [unresolvedThreadSchema], default: [] },
    consequences: { type: [String], default: [] },
    timelineNotes: { type: String, default: "", maxlength: 800 },
    asOfEpisode: { type: Number, required: true, min: 0, default: 0 },
    basedOnPlanVersion: { type: Number, required: true, min: 0 },
    version: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true, collection: "continuityLedgers" }
);

ContinuityLedgerSchema.index({ clerkUserId: 1, projectId: 1, version: -1 });

export function continuityLedgerModel(connection: Connection): Model<Record<string, unknown>> {
  const existing = connection.models.StudioContinuityLedger;
  if (existing) return existing as unknown as Model<Record<string, unknown>>;
  return connection.model("StudioContinuityLedger", ContinuityLedgerSchema) as unknown as Model<Record<string, unknown>>;
}
