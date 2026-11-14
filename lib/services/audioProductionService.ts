import "server-only";
import { StudioError } from "@/lib/http/errors";
import { voiceProfileRepository } from "@/lib/repositories/voiceProfileRepository";
import type { VoiceProfileRecord } from "@/lib/validation/voiceProfile";

function assertObjectId(value: string): void {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new StudioError("Resource not found", 404, "not_found");
  }
}

export type DialogueLine = {
  speaker: string;
  text: string;
  emotionalDelivery?: string;
};

export type MusicAssociation = {
  assetId: string;
  volume: number;
  startSeconds: number;
  endSeconds: number;
  licensing: string;
  mood?: string;
};

export function createAudioProductionService() {
  return {
    async createVoiceProfile(
      actor: { userId: string },
      input: Omit<VoiceProfileRecord, "id" | "clerkUserId" | "createdAt" | "updatedAt">
    ): Promise<VoiceProfileRecord> {
      assertObjectId(input.canonicalEntityId);
      return voiceProfileRepository.create(actor.userId, input);
    },

    async getApprovedVoiceProfile(
      actor: { userId: string },
      canonicalEntityId: string
    ): Promise<VoiceProfileRecord> {
      assertObjectId(canonicalEntityId);
      const profile = await voiceProfileRepository.findApprovedForCharacter(actor.userId, canonicalEntityId);
      if (!profile) {
        throw new StudioError("No approved voice profile for this character", 409, "voice_profile_required");
      }
      return profile;
    },

    async listVoiceProfiles(actor: { userId: string }, projectId: string): Promise<VoiceProfileRecord[]> {
      return voiceProfileRepository.listByProject(actor.userId, projectId);
    },

    async approveVoiceProfile(actor: { userId: string }, profileId: string): Promise<VoiceProfileRecord> {
      assertObjectId(profileId);
      const profile = await voiceProfileRepository.approve(actor.userId, profileId);
      if (!profile) throw new StudioError("Voice profile not found", 404, "not_found");
      return profile;
    },

    validateDialogueFromScreenplay(
      lines: DialogueLine[],
      approvedScreenplayLines: DialogueLine[]
    ): { valid: boolean; invalidLines: DialogueLine[] } {
      const approvedTexts = new Set(approvedScreenplayLines.map((l) => l.text.trim()));
      const invalidLines = lines.filter((l) => !approvedTexts.has(l.text.trim()));
      return { valid: invalidLines.length === 0, invalidLines };
    },

    validateMusicLicensing(association: MusicAssociation): void {
      if (!association.licensing || association.licensing.trim().length === 0) {
        throw new StudioError("Music licensing information is required", 422, "unlicensed_music");
      }
      const lower = association.licensing.toLowerCase();
      if (lower.includes("unlicensed") || lower.includes("copyright unknown")) {
        throw new StudioError("Unlicensed copyrighted music is not allowed", 422, "unlicensed_music");
      }
    },

    detectDurationMismatch(
      dialogueDurationSeconds: number,
      shotVideoDurationSeconds: number
    ): { mismatch: boolean; difference: number } {
      const difference = dialogueDurationSeconds - shotVideoDurationSeconds;
      return {
        mismatch: Math.abs(difference) > 0.5,
        difference,
      };
    },
  };
}

export type AudioProductionService = ReturnType<typeof createAudioProductionService>;