import { describe, expect, it } from "vitest";
import { runQualityControl, type SupplementCheck } from "../../../src/host/delivery/qc.js";
import { GOOD_PROBE, renderSpec, runnerOf, sha256Of } from "./support.js";

/**
 * The quality control.
 *
 * Module checks: the decoder is faked, because what is being checked here is how the
 * module reads what the decoder said. The real decode of a real file is part of the
 * real T20 acceptance and is `NOT_RUN`.
 */

const MEDIA = "/tmp/does-not-need-to-exist.mp4";

function status(items: readonly { id: string; status: string }[], id: string): string | undefined {
  return items.find((item) => item.id === id)?.status;
}

const GOOD_SUPPLEMENT: SupplementCheck = {
  id: "supplement_0",
  sha256: "b".repeat(64),
  bytes: 11,
  actual_sha256: "b".repeat(64),
  actual_bytes: 11,
};

describe("the quality control", () => {
  it("passes a file that is what the spec asked for", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      render_spec: renderSpec(),
      supplements: [GOOD_SUPPLEMENT],
      runner: runnerOf({}),
      timeout_ms: 1000,
    });

    expect(result.blocked).toBe(false);
    expect(status(result.items, "media_container")).toBe("pass");
    expect(status(result.items, "media_video_codec")).toBe("pass");
    expect(status(result.items, "media_audio_codec")).toBe("pass");
    expect(status(result.items, "media_dimensions")).toBe("pass");
    expect(status(result.items, "media_frame_rate")).toBe("pass");
    expect(status(result.items, "media_frames")).toBe("pass");
    expect(status(result.items, "media_full_decode")).toBe("pass");
    expect(status(result.items, "supplements")).toBe("pass");
    expect(result.probe?.container).toContain("mp4");
  });

  it("blocks a file the decoder refuses", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      render_spec: renderSpec(),
      supplements: [],
      runner: runnerOf({ decode: { code: 1, stderr: "Invalid data found when processing input\n" } }),
      timeout_ms: 1000,
    });

    expect(result.blocked).toBe(true);
    expect(status(result.items, "media_full_decode")).toBe("block");
  });

  it("blocks a file the decoder complains about even when it exits cleanly", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      render_spec: renderSpec(),
      supplements: [],
      runner: runnerOf({ decode: { code: 0, stderr: "error while decoding MB 12\n" } }),
      timeout_ms: 1000,
    });

    expect(result.blocked).toBe(true);
    expect(status(result.items, "media_full_decode")).toBe("block");
  });

  it("blocks a file that was truncated before it was probed", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      render_spec: renderSpec(),
      supplements: [],
      runner: runnerOf({ probe: { code: 1, stdout: "", stderr: "moov atom not found\n" } }),
      timeout_ms: 1000,
    });

    expect(result.blocked).toBe(true);
    expect(status(result.items, "media_container")).toBe("block");
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
      render_spec: renderSpec(),
      supplements: [],
      runner: runnerOf({ probe: { stdout: probe } }),
      timeout_ms: 1000,
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
      render_spec: renderSpec(),
      supplements: [],
      runner: runnerOf({ probe: { stdout: probe } }),
      timeout_ms: 1000,
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
      render_spec: renderSpec(),
      supplements: [],
      runner: runnerOf({ probe: { stdout: probe } }),
      timeout_ms: 1000,
    });

    expect(status(result.items, "media_frame_rate")).toBe("block");
  });

  it("blocks a supplement that is not the file it was cleared as", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      render_spec: renderSpec(),
      supplements: [{ ...GOOD_SUPPLEMENT, actual_sha256: sha256Of("other bytes") }],
      runner: runnerOf({}),
      timeout_ms: 1000,
    });

    expect(status(result.items, "supplements")).toBe("block");
    expect(result.blocked).toBe(true);
  });

  it("keeps the decoder's own words as the evidence", async () => {
    const result = await runQualityControl({
      media_path: MEDIA,
      render_spec: renderSpec(),
      supplements: [],
      runner: runnerOf({ decode: { code: 1, stderr: "moov atom not found\n" } }),
      timeout_ms: 1000,
    });

    expect(result.decode_bytes.toString("utf8")).toContain("moov atom not found");
    expect(result.probe_bytes.toString("utf8")).toBe(GOOD_PROBE);
  });
});
