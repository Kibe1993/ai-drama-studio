import { describe, expect, it } from "vitest";
import { buildFFmpegArgs, buildConcatList, type RenderPlan } from "@/lib/providers/media/ffmpeg/commandBuilder";
import {
  PRESET_VERTICAL_9_16,
  PRESET_LANDSCAPE_16_9,
  PRESET_SQUARE_1_1,
  RENDER_PRESETS,
  getPreset,
} from "@/lib/providers/media/ffmpeg/presets";
import { createRenderService } from "@/lib/services/renderService";

describe("render presets", () => {
  it("exports three presets with correct dimensions", () => {
    expect(PRESET_VERTICAL_9_16.width).toBe(1080);
    expect(PRESET_VERTICAL_9_16.height).toBe(1920);
    expect(PRESET_VERTICAL_9_16.frameRate).toBe(30);

    expect(PRESET_LANDSCAPE_16_9.width).toBe(1920);
    expect(PRESET_LANDSCAPE_16_9.height).toBe(1080);
    expect(PRESET_LANDSCAPE_16_9.frameRate).toBe(30);

    expect(PRESET_SQUARE_1_1.width).toBe(1080);
    expect(PRESET_SQUARE_1_1.height).toBe(1080);
    expect(PRESET_SQUARE_1_1.frameRate).toBe(30);
  });

  it("all presets use libx264 and yuv420p", () => {
    for (const preset of Object.values(RENDER_PRESETS)) {
      expect(preset.videoCodec).toBe("libx264");
      expect(preset.pixelFormat).toBe("yuv420p");
    }
  });

  it("getPreset returns preset by id", () => {
    expect(getPreset("vertical_9_16")?.id).toBe("vertical_9_16");
    expect(getPreset("nonexistent")).toBeUndefined();
  });
});

describe("ffmpeg command builder", () => {
  const basePlan: RenderPlan = {
    preset: PRESET_LANDSCAPE_16_9,
    videoInputs: [{ path: "/tmp/worker/video_0.mp4", durationSeconds: 5 }],
    outputPath: "/tmp/worker/output.mp4",
    concatListPath: "/tmp/worker/concat.txt",
  };

  it("returns a string array (not a shell string)", () => {
    const args = buildFFmpegArgs(basePlan);
    expect(Array.isArray(args)).toBe(true);
    for (const arg of args) {
      expect(typeof arg).toBe("string");
    }
  });

  it("includes -y and -hide_banner flags", () => {
    const args = buildFFmpegArgs(basePlan);
    expect(args[0]).toBe("-y");
    expect(args[1]).toBe("-hide_banner");
  });

  it("uses libx264 codec with fast preset and faststart", () => {
    const args = buildFFmpegArgs(basePlan);
    const codecIdx = args.indexOf("-c:v");
    expect(args[codecIdx + 1]).toBe("libx264");
    const presetIdx = args.indexOf("-preset");
    expect(args[presetIdx + 1]).toBe("fast");
    const movflagsIdx = args.indexOf("-movflags");
    expect(args[movflagsIdx + 1]).toBe("+faststart");
  });

  it("scales to preset dimensions", () => {
    const args = buildFFmpegArgs({
      ...basePlan,
      preset: PRESET_VERTICAL_9_16,
    });
    const filterIdx = args.indexOf("-filter_complex");
    const filter = args[filterIdx + 1] as string;
    expect(filter).toContain("scale=1080:1920");
  });

  it("uses concat demuxer for multiple video inputs", () => {
    const args = buildFFmpegArgs({
      ...basePlan,
      videoInputs: [
        { path: "/tmp/worker/v0.mp4", durationSeconds: 3 },
        { path: "/tmp/worker/v1.mp4", durationSeconds: 4 },
      ],
    });
    const concatIdx = args.indexOf("-f");
    expect(args[concatIdx + 1]).toBe("concat");
    expect(args).toContain("-safe");
    expect(args).toContain("0");
  });

  it("rejects paths with null bytes", () => {
    expect(() =>
      buildFFmpegArgs({
        ...basePlan,
        videoInputs: [{ path: "/tmp/evil\0.mp4", durationSeconds: 5 }],
      })
    ).toThrow();
  });

  it("rejects paths with shell metacharacters", () => {
    expect(() =>
      buildFFmpegArgs({
        ...basePlan,
        videoInputs: [{ path: "/tmp/evil;rm -rf /", durationSeconds: 5 }],
      })
    ).toThrow();
  });

  it("includes audio mixing with amix when audio inputs are present", () => {
    const args = buildFFmpegArgs({
      ...basePlan,
      audioInputs: [
        { path: "/tmp/worker/audio_0.bin", volume: 0.8, kind: "dialogue" },
        { path: "/tmp/worker/audio_1.bin", volume: 0.3, kind: "music" },
      ],
    });
    const filterIdx = args.indexOf("-filter_complex");
    const filter = args[filterIdx + 1] as string;
    expect(filter).toContain("amix");
    expect(filter).toContain("volume=0.8");
    expect(filter).toContain("volume=0.3");
  });

  it("disables audio when no audio inputs", () => {
    const args = buildFFmpegArgs(basePlan);
    expect(args).toContain("-an");
  });
});

describe("concat list builder", () => {
  it("builds a concat demuxer file list", () => {
    const list = buildConcatList([
      { path: "/tmp/v0.mp4", durationSeconds: 3 },
      { path: "/tmp/v1.mp4", durationSeconds: 4 },
    ]);
    expect(list).toContain("file '/tmp/v0.mp4'");
    expect(list).toContain("file '/tmp/v1.mp4'");
  });

  it("rejects paths with null bytes", () => {
    expect(() =>
      buildConcatList([{ path: "/tmp/evil\0.mp4", durationSeconds: 3 }])
    ).toThrow();
  });
});

describe("render service logic", () => {
  const service = createRenderService();

  it("rejects invalid timeline ID", () => {
    expect(
      service.triggerRender(
        { userId: "user1" },
        "not-an-object-id",
        "landscape_16_9"
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("cancel rejects invalid render job ID", () => {
    expect(
      service.cancel({ userId: "user1" }, "not-an-object-id")
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("getStatus rejects invalid render job ID", () => {
    expect(
      service.getStatus({ userId: "user1" }, "not-an-object-id")
    ).rejects.toMatchObject({ code: "not_found" });
  });
});