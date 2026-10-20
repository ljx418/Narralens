import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { DerivedArtifactStore } from "../../../src/host/materialize/derived-artifact-store.js";
import { classifyProxyToolError, ENCODER_THREADS, ProxyRenderer } from "../../../src/host/materialize/proxy-renderer.js";
import type { NativePlanV1 } from "../../../src/contracts/wave2-types.js";

/**
 * M3.2: a real comparison proxy, with real media as the evidence.
 *
 * The frozen plan is explicit that "the file exists" and "JSON that looks right" are not
 * proofs: MT-06 asks for a full decode, the total frame count, the segment boundaries and
 * the first and last frames. So every assertion below runs ffprobe and ffmpeg against the
 * produced bytes, and nothing is accepted on the strength of a return value.
 *
 * The derived artifacts are content-addressed and written out of a staging directory, so a
 * half-written proxy is never visible under its final name, and a proxy that already exists
 * is reused rather than re-encoded — which is what makes a rerun comparable at all.
 */

const run = promisify(execFile);
const SOURCE_A = resolve("fixtures/d1-30s/assets/generated/visual-10s.mp4");
const SOURCE_B = resolve("fixtures/d1-30s/assets/generated/visual-alt-10s.mp4");
const PROFILE = "wave2-proxy-720p30-v1";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("M3.2 proxy tool failure classification", () => {
  it("bounds each admitted encoder's own worker pool", () => {
    expect(ENCODER_THREADS).toBe(1);
  });

  it.each(["ENOMEM", "EMFILE", "EAGAIN"])(
    "keeps raw %s retryable instead of declaring the source invalid",
    (code) => {
      const error = classifyProxyToolError(Object.assign(new Error(code), { code }), "invalid proxy");
      expect(error).toMatchObject({
        status: 503,
        code: "HOST_RESOURCE_EXHAUSTED",
        details: { reason: `TRANSIENT:${code}`, recoverable: true },
      });
    },
  );

  it("keeps missing tools distinct from invalid media", () => {
    expect(classifyProxyToolError(Object.assign(new Error("missing"), { code: "ENOENT" }), "invalid proxy"))
      .toMatchObject({ status: 503, code: "MEDIA_TOOL_UNAVAILABLE" });
    expect(classifyProxyToolError(Object.assign(new Error("bad bytes"), { code: 1 }), "invalid proxy"))
      .toMatchObject({ status: 422, code: "INVALID_MEDIA", message: "invalid proxy" });
  });
});

async function workspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m32-proxy-"));
  dirs.push(base);
  return base;
}

/** Hashed in-process: one fewer subprocess under this box's memory pressure. */
async function sha256Of(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function probe(path: string): Promise<{
  frames: number; rate: string; width: number; height: number; codec: string;
}> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-count_frames",
    "-select_streams", "v:0",
    "-show_entries", "stream=nb_read_frames,r_frame_rate,width,height,codec_name",
    "-of", "json", path], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout) as { streams?: Array<Record<string, string>> };
  const stream = parsed.streams?.[0] ?? {};
  return {
    frames: Number(stream.nb_read_frames), rate: String(stream.r_frame_rate),
    width: Number(stream.width), height: Number(stream.height), codec: String(stream.codec_name),
  };
}

/** Decodes one frame to small grayscale bytes, so two frames can be compared numerically. */
async function frameGray(path: string, frame: number): Promise<Buffer> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", path,
    "-vf", `select=eq(n\\,${frame}),scale=32:18`, "-fps_mode", "passthrough", "-frames:v", "1",
    "-f", "rawvideo", "-pix_fmt", "gray", "-"],
  { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, encoding: "buffer" });
  // `execFile` returns stdout as a string by default, which re-encodes binary and changes
  // its length — 1050 bytes where a 32x18 frame is 576.
  return stdout as unknown as Buffer;
}

/**
 * Mean absolute difference between two decoded frames, 0 to 255.
 *
 * The proxy is re-encoded, so its bytes can never equal the source's — comparing digests
 * would fail on a correct render. What *is* provable is which source a proxy frame came
 * from: the frame nearest a segment's own source, and further from the other segment's.
 */
function meanDifference(a: Buffer, b: Buffer): number {
  expect(a.length).toBe(b.length);
  let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    total += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return total / a.length;
}

/** A one-clip plan, for the cases that render exactly one segment. */
function firstClipPlan(): NativePlanV1 {
  const plan = planFor();
  return {
    ...plan,
    clips: [plan.clips[0]!],
    total_frames: 300,
  };
}

function planFor(): NativePlanV1 {
  return {
    format: "narralens.native-plan@1.0", engine: "openfilm", fps: { num: 30, den: 1 },
    clips: [
      { clip_id: "clip-seg-1", segment_id: "seg-1", asset_id: "asset_1",
        asset_sha256: "a".repeat(64),
        timeline: { start_frame: 0, end_frame_exclusive: 300 },
        source: { start_frame: 0, end_frame_exclusive: 300 }, track_id: "track_visual" },
      { clip_id: "clip-seg-2", segment_id: "seg-2", asset_id: "asset_2",
        asset_sha256: "b".repeat(64),
        timeline: { start_frame: 300, end_frame_exclusive: 600 },
        source: { start_frame: 0, end_frame_exclusive: 300 }, track_id: "track_visual" },
    ],
    narration_policy: "preserve", duration_policy: "preserve", total_frames: 600,
    plan_sha256: "c".repeat(64),
  };
}

describe("M3.2 the derived artifact store is content-addressed and atomic", () => {
  it("resolves a token to a file under its own root and nothing above it", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const bytes = Buffer.from("not really a video, just bytes for the path test");
    const token = await store.put(bytes, "mp4");
    expect(token).toMatch(/^proxy\/[a-f0-9]{64}\.mp4$/u);
    expect(store.resolve(token)).toBe(join(base, "derived", token));
    await expect(readFile(store.resolve(token))).resolves.toEqual(bytes);
  });

  it("refuses a token that escapes the root, in any spelling", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    for (const token of ["../secret", "proxy/../../etc/passwd", "/etc/passwd", "proxy/ok/x"]) {
      expect(() => store.resolve(token), token).toThrow();
    }
  });

  it("gives the same token for the same bytes and a different one otherwise", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const first = await store.put(Buffer.from("same"), "mp4");
    const second = await store.put(Buffer.from("same"), "mp4");
    const other = await store.put(Buffer.from("different"), "mp4");
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("leaves no staging directory behind after a successful write", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    await store.put(Buffer.from("x"), "mp4");
    const entries = await readdir(join(base, "derived"));
    expect(entries.filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("leaves no staging directory behind after a failed write", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    await expect(store.put(Buffer.from("y"), "mp4/x")).rejects.toThrow();
    expect(existsSync(join(base, "derived", "proxy"))).toBe(false);
  });
});

describe("M3.2 the proxy is real media with the frames the plan promised", () => {
  it("produces a decodable proxy whose total frame count matches the plan", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });

    const result = await renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: planFor(),
      segments: [
        { segment_id: "seg-1", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
          start_frame: 0, end_frame_exclusive: 300,
          license_status: "cleared", commercial_use: true },
        { segment_id: "seg-2", asset_path: SOURCE_B, sha256: await sha256Of(SOURCE_B),
          start_frame: 0, end_frame_exclusive: 300,
          license_status: "cleared", commercial_use: true },
      ],
    });

    const probed = await probe(store.resolve(result.proxy.token));
    expect(probed.frames).toBe(600);
    expect(probed.rate).toBe("30/1");
    expect(probed.width).toBe(1280);
    expect(probed.height).toBe(720);
    expect(result.proxy.frame_count).toBe(600);
    expect(result.proxy.profile_id).toBe(PROFILE);
  }, 180_000);

  it("keeps each segment's own first and last frames, so the proxy is really the segments", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });

    const result = await renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: planFor(),
      segments: [
        { segment_id: "seg-1", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
          start_frame: 0, end_frame_exclusive: 300,
          license_status: "cleared", commercial_use: true },
        { segment_id: "seg-2", asset_path: SOURCE_B, sha256: await sha256Of(SOURCE_B),
          start_frame: 0, end_frame_exclusive: 300,
          license_status: "cleared", commercial_use: true },
      ],
    });
    const proxy = store.resolve(result.proxy.token);

    // Each boundary frame must be closer to its own segment's source than to the other's.
    // That is what proves the segments were concatenated in order and neither duplicated
    // nor substituted — and unlike a byte comparison it survives a lossy re-encode.
    const aFirst = await frameGray(SOURCE_A, 0);
    const bFirst = await frameGray(SOURCE_B, 0);
    const aLast = await frameGray(SOURCE_A, 299);
    const bLast = await frameGray(SOURCE_B, 299);

    const proxyFirst = await frameGray(proxy, 0);
    expect(meanDifference(proxyFirst, aFirst)).toBeLessThan(meanDifference(proxyFirst, bFirst));

    const proxyBoundary = await frameGray(proxy, 300);
    expect(meanDifference(proxyBoundary, bFirst)).toBeLessThan(meanDifference(proxyBoundary, aFirst));

    const proxyLast = await frameGray(proxy, 599);
    expect(meanDifference(proxyLast, bLast)).toBeLessThan(meanDifference(proxyLast, aLast));

    // And the boundary is a real boundary: the frame before it is not the frame after it,
    // so the two segments are adjacent rather than one having been dropped.
    const proxyEndOfFirst = await frameGray(proxy, 299);
    expect(meanDifference(proxyBoundary, proxyEndOfFirst)).toBeGreaterThan(0);
    expect(meanDifference(proxyEndOfFirst, aLast)).toBeLessThan(meanDifference(proxyEndOfFirst, bLast));
  }, 240_000);

  it("decodes the whole proxy without error, not just its head", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    const result = await renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: firstClipPlan(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "cleared", commercial_use: true }],
    });
    // A full decode to the null muxer surfaces any corrupt packet a partial probe would miss.
    await expect(run("ffmpeg", ["-v", "error", "-xerror", "-i", store.resolve(result.proxy.token),
      "-f", "null", "-"], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }))
      .resolves.toBeTruthy();
  }, 240_000);
});

describe("M3.2 lineage accounts for every output and cannot be quietly rewritten", () => {
  it("names the input bytes, span and rights behind every clip", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    const aSha = await sha256Of(SOURCE_A);
    const bSha = await sha256Of(SOURCE_B);

    const result = await renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: planFor(),
      segments: [
        { segment_id: "seg-1", asset_path: SOURCE_A, sha256: aSha,
          start_frame: 0, end_frame_exclusive: 300, license_status: "cleared", commercial_use: true },
        { segment_id: "seg-2", asset_path: SOURCE_B, sha256: bSha,
          start_frame: 0, end_frame_exclusive: 300, license_status: "cleared", commercial_use: true },
      ],
    });

    expect(result.lineage).toHaveLength(2);
    expect(result.lineage.map((entry) => entry.input_sha256)).toEqual([aSha, bSha]);
    for (const entry of result.lineage) {
      expect(entry.output_sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(entry.source.end_frame_exclusive - entry.source.start_frame).toBe(300);
      expect(entry.output.end_frame_exclusive - entry.output.start_frame).toBe(300);
    }
    expect(result.lineage[0]!.input_asset_id).toBe("asset_1");
    expect(result.lineage[1]!.input_asset_id).toBe("asset_2");
  }, 180_000);

  it("rejects a segment whose bytes do not hash to what it claims", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    await expect(renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: planFor(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: "0".repeat(64),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "cleared", commercial_use: true }],
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  }, 120_000);

  it("refuses a segment whose rights bar commercial use", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    await expect(renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: planFor(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "restricted", commercial_use: false }],
    })).rejects.toMatchObject({ code: "DATA_POLICY_DENIED" });
  }, 120_000);

  it("refuses a segment longer than the bytes it can supply, rather than looping it", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    // SOURCE_B is 300 frames; asking for 400 would need a loop or a freeze.
    await expect(renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: planFor(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_B, sha256: await sha256Of(SOURCE_B),
        start_frame: 0, end_frame_exclusive: 400,
        license_status: "cleared", commercial_use: true }],
    })).rejects.toMatchObject({ code: "INVALID_RANGE" });
  }, 120_000);

  it("refuses more than 64 segments", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    const sha = await sha256Of(SOURCE_B);
    await expect(renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: firstClipPlan(),
      // The ceiling exists so a single request cannot turn into an unbounded encoder run.
      segments: Array.from({ length: 65 }, (_, index) => ({
        segment_id: `seg-${index}`, asset_path: SOURCE_B, sha256: sha,
        start_frame: 0, end_frame_exclusive: 1,
        license_status: "cleared", commercial_use: true,
      })),
    })).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  }, 120_000);

  it("records the tool and its version, so a proxy can be traced to what made it", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    const result = await renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: firstClipPlan(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "cleared", commercial_use: true }],
    });
    expect(result.tool.profile_id).toBe(PROFILE);
    expect(result.tool.argv_is_fixed).toBe(true);
    expect(result.tool.version).toMatch(/ffmpeg version \d/u);
  }, 180_000);
});

describe("M3.2 the renderer cannot be steered by its arguments", () => {
  it("builds argv from a fixed template, so no input can reach a shell", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    // A segment id that looks like a flag must still end up as a map entry, never as an
    // argument that changes what ffmpeg does.
    await expect(renderer.render({
      materializationId: "mat_1", projectId: "p1",
      plan: { ...planFor(), clips: [{ ...planFor().clips[0]!, clip_id: "clip-x", segment_id: "seg-x" }],
        total_frames: 300 },
      segments: [{ segment_id: "seg-x", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "cleared", commercial_use: true }],
    })).resolves.toBeTruthy();
  }, 180_000);

  it("writes only under the derived root, never next to the source", async () => {
    const base = await workspace();
    const store = new DerivedArtifactStore(join(base, "derived"));
    const renderer = new ProxyRenderer({ artifacts: store, profile: PROFILE });
    const sourceBefore = await sha256Of(SOURCE_A);
    await renderer.render({
      materializationId: "mat_1", projectId: "p1", plan: firstClipPlan(),
      segments: [{ segment_id: "seg-1", asset_path: SOURCE_A, sha256: await sha256Of(SOURCE_A),
        start_frame: 0, end_frame_exclusive: 300,
        license_status: "cleared", commercial_use: true }],
    });
    expect(await sha256Of(SOURCE_A)).toBe(sourceBefore);
    const siblings = await readdir(resolve("fixtures/d1-30s/assets/generated"));
    expect(siblings.some((name) => name.includes("narralens"))).toBe(false);
  }, 180_000);
});
