import { z } from "zod";
import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { createAudioProductionService } from "@/lib/services/audioProductionService";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const createVoiceProfileSchema = z.object({
  projectId: objectId,
  canonicalEntityId: objectId,
  voiceDescription: z.string().trim().max(500).default(""),
  preferredProvider: z.string().trim().max(80).default(""),
  voiceIdentifier: z.string().trim().max(160).default(""),
  language: z.string().trim().max(20).default("en"),
  accent: z.string().trim().max(80).default(""),
  speakingStyle: z.string().trim().max(300).default(""),
  emotionalCharacteristics: z.string().trim().max(400).default(""),
  status: z.enum(["draft", "approved"]).default("draft"),
  idempotencyKey: z.string().trim().min(8).max(180),
});

type Context = { params: Promise<{ projectId: string; entityId: string }> };

export function POST(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const body = createVoiceProfileSchema.parse(await readJson(request));
    const service = createAudioProductionService();
    const profile = await service.createVoiceProfile(actor, body);
    return jsonData({ profile }, 201);
  });
}

export function GET(request: Request, context: Context) {
  return logged(request, async () => {
    const actor = await readActor();
    const { projectId } = await context.params;
    const service = createAudioProductionService();
    const profiles = await service.listVoiceProfiles(actor, projectId);
    return jsonData({ profiles });
  });
}