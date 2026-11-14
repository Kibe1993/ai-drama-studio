import "server-only";
import type { ProviderCapability, ProviderKind, CapabilityRequirement } from "@/lib/providers/media/capability";
import { capabilitySatisfies } from "@/lib/providers/media/capability";
import type { ImageProvider } from "@/lib/providers/media/image/types";
import type { VideoProvider } from "@/lib/providers/media/video/types";
import type { AudioProvider } from "@/lib/providers/media/audio/types";
import { MockImageProvider } from "@/lib/providers/media/image/mock";
import { MockVideoProvider } from "@/lib/providers/media/video/mock";
import { MockAudioProvider } from "@/lib/providers/media/audio/mock";

export type ProviderRegistryDeps = {
  imageProviders?: ImageProvider[];
  videoProviders?: VideoProvider[];
  audioProviders?: AudioProvider[];
};

export class ProviderRegistry {
  private readonly image: ImageProvider[];
  private readonly video: VideoProvider[];
  private readonly audio: AudioProvider[];

  constructor(deps: ProviderRegistryDeps = {}) {
    const mockImage = new MockImageProvider();
    const mockVideo = new MockVideoProvider();
    const mockAudio = new MockAudioProvider();
    this.image = [...(deps.imageProviders ?? []), mockImage];
    this.video = [...(deps.videoProviders ?? []), mockVideo];
    this.audio = [...(deps.audioProviders ?? []), mockAudio];
  }

  selectImage(
    requirement: CapabilityRequirement,
    model: string,
    isCreatorInitiated: boolean
  ): ImageProvider {
    return this.selectOne(this.image, requirement, model, isCreatorInitiated);
  }

  selectVideo(
    requirement: CapabilityRequirement,
    model: string,
    isCreatorInitiated: boolean
  ): VideoProvider {
    return this.selectOne(this.video, requirement, model, isCreatorInitiated);
  }

  selectAudio(
    requirement: CapabilityRequirement,
    model: string,
    isCreatorInitiated: boolean
  ): AudioProvider {
    return this.selectOne(this.audio, requirement, model, isCreatorInitiated);
  }

  listImage(): ImageProvider[] { return this.image; }
  listVideo(): VideoProvider[] { return this.video; }
  listAudio(): AudioProvider[] { return this.audio; }

  private selectOne<T extends { capabilities: ProviderCapability; id: string }>(
    adapters: T[],
    requirement: CapabilityRequirement,
    model: string,
    isCreatorInitiated: boolean
  ): T {
    const eligible = adapters.filter((adapter) => {
      if (!capabilitySatisfies(adapter.capabilities, requirement)) return false;
      if (model && !adapter.capabilities.supportedModels.includes(model) && !adapter.capabilities.isMock) return false;
      if (adapter.capabilities.isPaid && !isCreatorInitiated) return false;
      return true;
    });

    if (eligible.length === 0) {
      throw new Error("no_provider_available");
    }

    const nonMock = eligible.filter((a) => !a.capabilities.isMock);
    if (nonMock.length > 0 && isCreatorInitiated) {
      return nonMock[0];
    }
    const mock = eligible.find((a) => a.capabilities.isMock);
    if (mock) return mock;
    return eligible[0];
  }
}

export function createProviderRegistry(deps?: ProviderRegistryDeps): ProviderRegistry {
  return new ProviderRegistry(deps);
}

export function isProviderKind(value: string): value is ProviderKind {
  return value === "image" || value === "video" || value === "audio";
}