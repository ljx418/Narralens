import { describe, expect, it } from "vitest";
import { runQualityControl, type MediaToolRunner, type SupplementCheck } from "../../../src/host/delivery/qc.js";
import { GOOD_PROBE, renderSpec, runnerOf, sha256Of } from "./support.js";

/**
 * The quality control.
 *
 * Module checks: the decoder is faked, because what is being checked here is how the
 * module reads what the decoder said, and what it asks the decoder to do. The real
 * decode of a real file is part of the real T20 acceptance and is `NOT_RUN`.
 */

const MEDIA = "/tmp/does-not-need-to-exist.mp4";
const DELIVERY = "d_0123456789abcdef0123456789abcdef";

function status(items: readonly { id: string; status: string }[], id: string): string | undefined {
  return items.find((item) => item.id === id)?.status;
}

const GOOD_SUPPLEMENT: SupplementCheck = {
  id: "sup0",
  role: "rights",
  sha256: "b".repeat(64),
  bytes: 11,
  actual_sha256: "b".repeat(64),
  actual_bytes: 11,
};

/** A runner that records what it was asked to run. */
function recordingRunner(results: Parameters<typeof runnerOf>[0]): { runner: MediaToolRunner; calls: Array<{ tool: string; args: readonly string[] }> } {
  const calls: Array<{ tool: string; args: readonly string[] }> = [];
  const inner = runnerOf(results);
  return {
    calls,
    runner: {
      async run(tool, args, options) {
        calls.push({ tool, args });
        return await inner.run(tool, args, options);
      },
    },
  };
}

describe("the quality control", () => {
  it("passes a file that is what the spec asked for", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [GOOD_SUPPLEMENT],
      required_supplements: ["rights"],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({}),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(result.blocked).toBe(false);
    expect(status(result.items, "media_container")).toBe("pass");
    expect(status(result.items, "media_video_codec")).toBe("pass");
    expect(status(result.items, "media_audio_codec")).toBe("pass");
    expect(status(result.items, "media_dimensions")).toBe("pass");
    expect(status(result.items, "media_frame_rate")).toBe("pass");
    expect(status(result.items, "media_streams")).toBe("pass");
    expect(status(result.items, "media_frames")).toBe("pass");
    expect(status(result.items, "media_duration")).toBe("pass");
    expect(status(result.items, "media_full_decode")).toBe("pass");
    expect(status(result.items, "supplements")).toBe("pass");
    expect(result.probe?.container).toContain("mp4");
  });

  it("asks the tools for a local, strict, single-threaded decode of every stream", async () => {
    const { runner, calls } = recordingRunner({});
    await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner,
      timeout_ms: 1000,
      signal: undefined,
    });

    const decode = calls.find((call) => call.tool === "ffmpeg");
    expect(decode).toBeDefined();
    const args = decode?.args ?? [];
    expect(args).toContain("-xerror");
    expect(args).toContain("-protocol_whitelist");
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("file,pipe");
    expect(args).toContain("-map");
    expect(args[args.indexOf("-map") + 1]).toBe("0");
    expect(args).toContain("-threads");
    expect(args[args.indexOf("-threads") + 1]).toBe("1");
    expect(args).toContain("-filter_threads");
    expect(args[args.indexOf("-filter_threads") + 1]).toBe("1");
    expect(args).toContain("-filter_complex_threads");
    expect(args[args.indexOf("-filter_complex_threads") + 1]).toBe("1");

    const probe = calls.find((call) => call.tool === "ffprobe");
    expect(probe?.args).toContain("-protocol_whitelist");
    expect(probe?.args[probe.args.indexOf("-protocol_whitelist") + 1]).toBe("file,pipe");
  });

  it("blocks a file the decoder refuses", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ decode: { code: 1, stderr: "Invalid data found when processing input\n" } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(result.blocked).toBe(true);
    expect(status(result.items, "media_full_decode")).toBe("block");
  });

  it("blocks a file the decoder complains about even when it exits cleanly", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ decode: { code: 0, stderr: "error while decoding MB 12\n" } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(result.blocked).toBe(true);
    expect(status(result.items, "media_full_decode")).toBe("block");
  });

  it("blocks a file that was truncated before it was probed", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ probe: { code: 1, stdout: "", stderr: "moov atom not found\n" } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(result.blocked).toBe(true);
    expect(status(result.items, "media_container")).toBe("block");
  });

  it("blocks a film that is shorter than the native document says it is", async () => {
    const probe = JSON.stringify({
      format: { format_name: "mov,mp4,m4a", duration: "1.000000" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1", nb_read_frames: "30" },
        { codec_type: "audio", codec_name: "aac", avg_frame_rate: "0/0", nb_read_frames: "" },
      ],
    });
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ probe: { stdout: probe } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(status(result.items, "media_frames")).toBe("block");
    expect(status(result.items, "media_duration")).toBe("block");
    expect(result.blocked).toBe(true);
  });

  it("blocks a file with a stream nobody described", async () => {
    const probe = JSON.stringify({
      format: { format_name: "mov,mp4,m4a", duration: "2.000000" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1", nb_read_frames: "60" },
        { codec_type: "audio", codec_name: "aac", avg_frame_rate: "0/0", nb_read_frames: "" },
        { codec_type: "subtitle", codec_name: "mov_text", avg_frame_rate: "0/0", nb_read_frames: "" },
      ],
    });
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ probe: { stdout: probe } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(status(result.items, "media_streams")).toBe("block");
  });

  it("blocks a file whose picture is not the size that was asked for", async () => {
    const probe = JSON.stringify({
      format: { format_name: "mov,mp4,m4a", duration: "2.000000" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1", nb_read_frames: "60" },
        { codec_type: "audio", codec_name: "aac", avg_frame_rate: "0/0", nb_read_frames: "" },
      ],
    });
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ probe: { stdout: probe } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(status(result.items, "media_dimensions")).toBe("block");
    expect(result.blocked).toBe(true);
  });

  it("blocks a file whose video codec is not the one that was asked for", async () => {
    const probe = JSON.stringify({
      format: { format_name: "mov,mp4,m4a", duration: "2.000000" },
      streams: [
        { codec_type: "video", codec_name: "vp9", width: 1920, height: 1080, avg_frame_rate: "30/1", nb_read_frames: "60" },
        { codec_type: "audio", codec_name: "aac", avg_frame_rate: "0/0", nb_read_frames: "" },
      ],
    });
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ probe: { stdout: probe } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(status(result.items, "media_video_codec")).toBe("block");
  });

  it("blocks a file whose frame rate is not the one that was asked for", async () => {
    const probe = JSON.stringify({
      format: { format_name: "mov,mp4,m4a", duration: "2.000000" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "25/1", nb_read_frames: "50" },
        { codec_type: "audio", codec_name: "aac", avg_frame_rate: "0/0", nb_read_frames: "" },
      ],
    });
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ probe: { stdout: probe } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(status(result.items, "media_frame_rate")).toBe("block");
  });

  it("compares rational frame rates by value", async () => {
    // 30000/1001 and 29.97/1 are the same number; 30/1 is not.
    const rational = JSON.stringify({
      format: { format_name: "mov,mp4,m4a", duration: "2.000000" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001", nb_read_frames: "60" },
        { codec_type: "audio", codec_name: "aac", avg_frame_rate: "0/0", nb_read_frames: "" },
      ],
    });
    const equal = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec({ fps_numerator: 30000, fps_denominator: 1001 }),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ probe: { stdout: rational } }),
      timeout_ms: 1000,
      signal: undefined,
    });
    expect(status(equal.items, "media_frame_rate")).toBe("pass");

    const different = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec({ fps_numerator: 30001, fps_denominator: 1001 }),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ probe: { stdout: rational } }),
      timeout_ms: 1000,
      signal: undefined,
    });
    expect(status(different.items, "media_frame_rate")).toBe("block");
  });

  it("blocks a supplement that is not the file it was cleared as", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [{ ...GOOD_SUPPLEMENT, actual_sha256: sha256Of("other bytes") }],
      required_supplements: ["rights"],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({}),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(status(result.items, "supplements")).toBe("block");
    expect(result.blocked).toBe(true);
  });

  it("blocks a package that does not carry what was promised", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [GOOD_SUPPLEMENT],
      required_supplements: ["rights", "subtitles"],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({}),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(status(result.items, "supplements")).toBe("block");
  });

  it("keeps the decoder's own words as the evidence", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      delivery_id: DELIVERY,
      render_spec: renderSpec(),
      supplements: [],
      required_supplements: [],
      expected_frames: 60,
      expected_duration_seconds: 2,
      runner: runnerOf({ decode: { code: 1, stderr: "moov atom not found\n" } }),
      timeout_ms: 1000,
      signal: undefined,
    });

    expect(result.decode_bytes.toString("utf8")).toContain("moov atom not found");
    expect(result.probe_bytes.toString("utf8")).toBe(GOOD_PROBE);
  });
});
