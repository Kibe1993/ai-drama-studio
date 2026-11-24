import { describe, expect, it } from "vitest";
import { buildFFmpegArgs, buildConcatList, type RenderPlan } from "@/lib/providers/media/ffmpeg/commandBuilder";
import { getPreset } from "@/lib/providers/media/ffmpeg/presets";

const preset = getPreset("landscape_16_9")!;

function makePlan(videos: { path: string; durationSeconds: number; transition?: string }[], overrides: Partial<RenderPlan> = {}): RenderPlan {
  return {
    preset,
    videoInputs: videos,
    outputPath: "/tmp/out.mp4",
    concatListPath: "/tmp/concat.txt",
    ...overrides,
  };
}

describe("FFmpeg command builder — transitions", () => {
  it("uses concat demuxer when no transitions", () => {
    const args = buildFFmpegArgs(makePlan([
      { path: "/tmp/v0.mp4", durationSeconds: 5 },
      { path: "/tmp/v1.mp4", durationSeconds: 3 },
    ]));
    const concatIndex = args.indexOf("-f");
    expect(concatIndex).toBeGreaterThan(-1);
    expect(args[concatIndex + 1]).toBe("concat");
  });

  it("uses individual inputs with xfade when transitions present", () => {
    const args = buildFFmpegArgs(makePlan([
      { path: "/tmp/v0.mp4", durationSeconds: 5 },
      { path: "/tmp/v1.mp4", durationSeconds: 3, transition: "fade" },
    ]));
    expect(args).not.toContain("concat");
    const filterComplex = args[args.indexOf("-filter_complex") + 1];
    expect(filterComplex).toContain("xfade");
    expect(filterComplex).toContain("transition=fade");
    expect(filterComplex).toContain("duration=0.5");
  });

  it("calculates xfade offset correctly", () => {
    const args = buildFFmpegArgs(makePlan([
      { path: "/tmp/v0.mp4", durationSeconds: 5 },
      { path: "/tmp/v1.mp4", durationSeconds: 3, transition: "fade" },
    ]));
    const filterComplex = args[args.indexOf("-filter_complex") + 1];
    expect(filterComplex).toContain("offset=4.50");
  });

  it("chains xfade for 3+ videos", () => {
    const args = buildFFmpegArgs(makePlan([
      { path: "/tmp/v0.mp4", durationSeconds: 5 },
      { path: "/tmp/v1.mp4", durationSeconds: 3, transition: "fade" },
      { path: "/tmp/v2.mp4", durationSeconds: 4, transition: "wipeleft" },
    ]));
    const filterComplex = args[args.indexOf("-filter_complex") + 1];
    const xfadeCount = (filterComplex.match(/xfade/g) ?? []).length;
    expect(xfadeCount).toBe(2);
    expect(filterComplex).toContain("transition=fade");
    expect(filterComplex).toContain("transition=wipeleft");
  });

  it("falls back to concat for unsupported transition values", () => {
    const args = buildFFmpegArgs(makePlan([
      { path: "/tmp/v0.mp4", durationSeconds: 5 },
      { path: "/tmp/v1.mp4", durationSeconds: 3, transition: "dissolve" },
    ]));
    expect(args).toContain("concat");
  });

  it("ignores transition on first clip (no previous clip)", () => {
    const args = buildFFmpegArgs(makePlan([
      { path: "/tmp/v0.mp4", durationSeconds: 5, transition: "fade" },
      { path: "/tmp/v1.mp4", durationSeconds: 3 },
    ]));
    expect(args).toContain("concat");
  });

  it("supports single video without transitions", () => {
    const args = buildFFmpegArgs(makePlan([
      { path: "/tmp/v0.mp4", durationSeconds: 5 },
    ]));
    const filterComplex = args[args.indexOf("-filter_complex") + 1];
    expect(filterComplex).not.toContain("xfade");
    expect(filterComplex).toContain("v_base");
  });

  it("buildConcatList produces valid concat format", () => {
    const list = buildConcatList([
      { path: "/tmp/v0.mp4", durationSeconds: 5 },
      { path: "/tmp/v1.mp4", durationSeconds: 3 },
    ]);
    expect(list).toContain("file '/tmp/v0.mp4'");
    expect(list).toContain("file '/tmp/v1.mp4'");
  });
});