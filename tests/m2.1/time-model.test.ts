import { describe, expect, it } from "vitest";
import {
  FPS_30, assertAssetCoversRange, assertHalfOpenRange, assertWithinSingleClip, rational,
  frameToSeconds, fpsToLegacyNumber, isVerifiedFps, normalizeFps, rationalFromDecimal,
  rationalFromNumber, requireVerifiedFps, secondsToFrame,
} from "../../src/host/engine/time-model.js";

/** TM-01 frame/second round trip; TM-02 half-open ranges; TM-03 no implicit retiming. */

const CLIP = (clip_id: string, start: number, end: number) =>
  ({ clip_id, frame_range: { start_frame: start, end_frame_exclusive: end } });

describe("TM-01 rational frame rate", () => {
  it("treats 30/1 as the only verified target specification", () => {
    expect(FPS_30).toEqual({ num: 30, den: 1 });
    expect(isVerifiedFps(FPS_30)).toBe(true);
    expect(isVerifiedFps({ num: 30000, den: 1001 })).toBe(false);
    expect(isVerifiedFps({ num: 25, den: 1 })).toBe(false);
    expect(isVerifiedFps({ num: 60, den: 2 })).toBe(false);
    expect(requireVerifiedFps(FPS_30)).toEqual(FPS_30);
    expect(() => requireVerifiedFps({ num: 30000, den: 1001 })).toThrowError(/verified target specification/u);
    expect(() => requireVerifiedFps({ num: 0, den: 1 })).toThrow(/reduced positive rational/u);
  });

  it("normalizes a rational and derives the legacy float in one direction only", () => {
    expect(normalizeFps({ num: 60, den: 2 })).toEqual(FPS_30);
    expect(normalizeFps({ num: 60, den: 2 })).not.toBe(FPS_30);
    expect(fpsToLegacyNumber(FPS_30)).toBe(30);
    expect(fpsToLegacyNumber({ num: 30000, den: 1001 })).toBeCloseTo(29.97, 2);
    expect(() => fpsToLegacyNumber({ num: 2, den: 4 })).toThrow(/FPS_NOT_NORMALIZED/u);
  });

  it("converts frame to seconds exactly, never as a float", () => {
    expect(frameToSeconds(0, FPS_30)).toEqual({ num: 0n, den: 1n });
    expect(frameToSeconds(1, FPS_30)).toEqual({ num: 1n, den: 30n });
    expect(frameToSeconds(900, FPS_30)).toEqual({ num: 30n, den: 1n });
    expect(frameToSeconds(29, FPS_30)).toEqual({ num: 29n, den: 30n });
    expect(() => frameToSeconds(-1, FPS_30)).toThrow(/non-negative integer/u);
    expect(() => frameToSeconds(1.5, FPS_30)).toThrow(/non-negative integer/u);
  });

  it("TM-01 round trips every frame of the 900-frame D1 fixture in both rounding directions", () => {
    for (let frame = 0; frame <= 900; frame += 1) {
      const seconds = frameToSeconds(frame, FPS_30);
      expect(secondsToFrame(seconds, FPS_30, "floor"), `floor at ${frame}`).toBe(frame);
      expect(secondsToFrame(seconds, FPS_30, "half_up"), `half_up at ${frame}`).toBe(frame);
      expect(secondsToFrame(seconds, FPS_30, "ceil"), `ceil at ${frame}`).toBe(frame);
    }
  });

  it("TM-01 resolves the boundaries on either side of a frame exactly", () => {
    const justBefore = rationalFromDecimal("0.9666666");
    const exact = rational(29n, 30n);
    const justUnderHalf = rationalFromDecimal("0.9833333");
    const justOverHalf = rationalFromDecimal("0.9833334");
    expect(secondsToFrame(justBefore, FPS_30, "floor")).toBe(28);
    expect(secondsToFrame(exact, FPS_30, "floor")).toBe(29);
    expect(secondsToFrame(exact, FPS_30, "half_up")).toBe(29);
    expect(secondsToFrame(justUnderHalf, FPS_30, "half_up")).toBe(29);
    expect(secondsToFrame(justOverHalf, FPS_30, "half_up")).toBe(30);
    expect(secondsToFrame(justOverHalf, FPS_30, "floor")).toBe(29);
    expect(rationalFromNumber(0.5)).toEqual({ num: 1n, den: 2n });
    expect(() => rationalFromDecimal("1e3")).toThrow(/RATIONAL_PARSE_FAILED/u);
    expect(() => rationalFromNumber(Number.POSITIVE_INFINITY)).toThrow(/NON_FINITE/u);
  });
});

describe("TM-02 half-open frame ranges", () => {
  it("accepts a non-empty range inside the projection", () => {
    expect(() => assertHalfOpenRange({ start_frame: 0, end_frame_exclusive: 300 }, 900)).not.toThrow();
    expect(() => assertHalfOpenRange({ start_frame: 300, end_frame_exclusive: 900 }, 900)).not.toThrow();
  });

  it("rejects zero length, reversed, negative and out-of-bounds ranges instead of clamping", () => {
    for (const range of [
      { start_frame: 300, end_frame_exclusive: 300 },
      { start_frame: 600, end_frame_exclusive: 300 },
      { start_frame: -1, end_frame_exclusive: 300 },
      { start_frame: 0, end_frame_exclusive: 901 },
    ]) {
      expect(() => assertHalfOpenRange(range, 900), JSON.stringify(range)).toThrow(/INVALID|must/u);
      try { assertHalfOpenRange(range, 900); } catch (error) {
        expect(error).toMatchObject({ status: 422, code: "INVALID_RANGE" });
      }
    }
    expect(() => assertHalfOpenRange({ start_frame: 0.5, end_frame_exclusive: 300 }, 900)).toThrow(/integers/u);
  });

  it("rejects a range that crosses a clip boundary when the operation is scoped to one clip", () => {
    const clips = [CLIP("shot-001", 0, 300), CLIP("shot-002", 300, 600), CLIP("shot-003", 600, 900)];
    expect(assertWithinSingleClip({ start_frame: 310, end_frame_exclusive: 590 }, clips)).toBe("shot-002");
    expect(assertWithinSingleClip({ start_frame: 0, end_frame_exclusive: 300 }, clips)).toBe("shot-001");
    expect(assertWithinSingleClip({ start_frame: 600, end_frame_exclusive: 900 }, clips)).toBe("shot-003");
    expect(() => assertWithinSingleClip({ start_frame: 250, end_frame_exclusive: 650 }, clips))
      .toThrow(/exactly one clip/u);
    expect(() => assertWithinSingleClip({ start_frame: 900, end_frame_exclusive: 900 }, clips))
      .toThrow(/non-empty/u);
    expect(() => assertWithinSingleClip({ start_frame: 0, end_frame_exclusive: 901 }, clips))
      .toThrow(/within the projection/u);
  });
});

describe("TM-03 asset length", () => {
  it("accepts an asset that covers the selected range", () => {
    expect(() => assertAssetCoversRange(300, { start_frame: 300, end_frame_exclusive: 600 })).not.toThrow();
    expect(() => assertAssetCoversRange(600, { start_frame: 300, end_frame_exclusive: 600 })).not.toThrow();
  });

  it("refuses a short asset instead of looping, freezing or retiming it", () => {
    expect(() => assertAssetCoversRange(299, { start_frame: 300, end_frame_exclusive: 600 }))
      .toThrowError(/does not loop, freeze or retime/u);
    try { assertAssetCoversRange(10, { start_frame: 0, end_frame_exclusive: 300 }); }
    catch (error) { expect(error).toMatchObject({ status: 422, code: "MISSING_ASSET" }); }
  });

  it("rejects a non-integer or non-positive asset length as invalid media", () => {
    for (const frames of [0, -1, 12.5]) {
      expect(() => assertAssetCoversRange(frames, { start_frame: 0, end_frame_exclusive: 1 }), String(frames)).toThrow();
    }
    try { assertAssetCoversRange(0, { start_frame: 0, end_frame_exclusive: 1 }); }
    catch (error) { expect(error).toMatchObject({ code: "INVALID_MEDIA" }); }
  });
});
