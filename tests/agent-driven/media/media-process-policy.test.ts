import { describe, expect, it } from "vitest";
import { localMediaArgs, nativeOutputProblems } from "../../../src/host/render/media-process-policy.mjs";

describe("native media subprocess policy", () => {
  it("restricts every ffmpeg input, including a second local playlist", () => {
    const argv = localMediaArgs("ffmpeg", ["-i", "/project/one.mp4", "-i", "/project/two.mp4", "-c", "copy", "/out.mp4"]);
    expect(argv.filter((arg) => arg === "-protocol_whitelist")).toHaveLength(2);
    for (const [index, arg] of argv.entries()) {
      if (arg === "-i") expect(argv.slice(index - 4, index)).toEqual(["-protocol_whitelist", "file,pipe", "-threads", "1"]);
    }
    expect(argv).not.toContain("http");
  });

  it("restricts ffprobe and leaves the Chromium command unchanged", () => {
    expect(localMediaArgs("ffprobe", ["-of", "json", "/project/clip.mp4"]).slice(0, 4))
      .toEqual(["-protocol_whitelist", "file,pipe", "-threads", "1"]);
    const browser = ["--headless", "--disable-background-networking"];
    expect(localMediaArgs("/runtime/chromium", browser)).toBe(browser);
  });

  it("blocks native page errors even when encoding returned successful output evidence", () => {
    const output = { out: "/media.mp4", lines: ["→ media.mp4", "60 frames", "✗ request: missing local asset"] };
    expect(nativeOutputProblems(output)).toEqual(["✗ request: missing local asset"]);
    expect(nativeOutputProblems({ lines: ["60 frames"] })).toEqual([]);
    expect(nativeOutputProblems({})).not.toEqual([]);
  });
});
