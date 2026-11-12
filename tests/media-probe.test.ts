import { describe, expect, it } from "vitest";
import { parseProbeOutput } from "@/lib/providers/media/probe";

describe("media probe result validation", () => {
  it("accepts a probed playable video only when a video stream and duration exist", () => {
    const result = parseProbeOutput(JSON.stringify({
      format: { duration: "12.5" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "24/1" },
        { codec_type: "audio", codec_name: "aac" },
      ],
    }), "video");
    expect(result).toMatchObject({
      validationStatus: "playable", durationSeconds: 12.5, width: 1280, height: 720,
      frameRate: 24, videoCodec: "h264", audioCodec: "aac",
    });
  });

  it("rejects a container with no valid video stream and rejects malformed probe data", () => {
    expect(() => parseProbeOutput(JSON.stringify({ format: { duration: "12" }, streams: [] }), "video"))
      .toThrow("video_stream_invalid");
    expect(() => parseProbeOutput("not-json", "video")).toThrow("invalid_probe_json");
  });

  it("requires a real audio stream for playable audio", () => {
    expect(parseProbeOutput(JSON.stringify({
      format: { duration: "2.75" },
      streams: [{ codec_type: "audio", codec_name: "pcm_s16le" }],
    }), "audio")).toMatchObject({ validationStatus: "playable", durationSeconds: 2.75, audioCodec: "pcm_s16le" });
    expect(() => parseProbeOutput(JSON.stringify({ format: { duration: "2" }, streams: [] }), "audio"))
      .toThrow("audio_stream_invalid");
  });
});
