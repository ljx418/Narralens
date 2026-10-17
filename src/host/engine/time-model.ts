import { HttpError } from "../api-error.js";
import type { Fps, HalfOpenFrameRange } from "../../contracts/engine-types.js";

/**
 * M2.1 time model (AC-D02).
 *
 * Everything crossing the Host boundary is an integer frame in a half-open
 * `[start_frame, end_frame_exclusive)` range at a rational frame rate. Seconds exist only
 * inside an adapter and convert back to the same integer frame. No float is ever a
 * persisted contract (`07_CODE_STANDARDS.md` §6).
 */

/** Exact non-negative-denominator rational. `den` is always > 0. */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

/** The only frame rate with verified evidence in this repository (`06` AC-D02). */
export const FPS_30: Fps = Object.freeze({ num: 30, den: 1 });

export const VERIFIED_FPS: readonly Fps[] = Object.freeze([FPS_30]);

export const VERIFIED_FPS_REASON = "fps is outside the verified target specification (30/1)";
export const UNVERIFIED_FPS_REASON = "engine capability is unverified for this operation";

function invalid(message: string, correlationId?: string): HttpError {
  return new HttpError(422, "INVALID_RANGE", message, undefined, correlationId);
}

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) { const next = left % right; left = right; right = next; }
  return left;
}

/** Reduce to lowest terms with a positive denominator, so equality is structural. */
export function rational(num: bigint, den: bigint): Rational {
  if (den === 0n) throw new Error("RATIONAL_DENOMINATOR_ZERO");
  const sign = den < 0n ? -1n : 1n;
  const left = num * sign;
  const right = den * sign;
  const divisor = gcd(left, right) || 1n;
  return { num: left / divisor, den: right / divisor };
}

/**
 * Exact decimal string to rational. Rejects anything that is not a plain decimal so a
 * caller cannot smuggle an exponent or trailing garbage into a frame boundary.
 */
export function rationalFromDecimal(text: string): Rational {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(text.trim());
  if (!match) throw new Error(`RATIONAL_PARSE_FAILED:${text}`);
  const [, sign, whole, fraction = ""] = match;
  const num = BigInt(`${sign}${whole}${fraction}`);
  return rational(num, 10n ** BigInt(fraction.length));
}

/**
 * Rational from a finite number via its shortest round-trip decimal text, so the
 * conversion is deterministic rather than dependent on binary floating-point internals.
 */
export function rationalFromNumber(value: number): Rational {
  if (!Number.isFinite(value)) throw new Error("RATIONAL_FROM_NON_FINITE");
  return rationalFromDecimal(String(value));
}

export function isFps(value: Fps): boolean {
  return Number.isSafeInteger(value.num) && Number.isSafeInteger(value.den)
    && value.num > 0 && value.den > 0 && gcd(BigInt(value.num), BigInt(value.den)) === 1n;
}

export function normalizeFps(value: Fps): Fps {
  const reduced = rational(BigInt(value.num), BigInt(value.den));
  return Object.freeze({ num: Number(reduced.num), den: Number(reduced.den) });
}

export function isVerifiedFps(value: Fps): boolean {
  return VERIFIED_FPS.some((known) => known.num === value.num && known.den === value.den);
}

/**
 * Reject an unverified frame rate outright rather than degrading to a guess. Every other
 * fps is `blocked` until it carries real evidence (AC-D02).
 */
export function requireVerifiedFps(value: Fps, correlationId?: string): Fps {
  if (!isFps(value)) throw invalid("Frame rate must be a reduced positive rational", correlationId);
  if (!isVerifiedFps(value)) throw new HttpError(422, "UNSUPPORTED_EDIT", VERIFIED_FPS_REASON, undefined, correlationId);
  return value;
}

/** One-way bridge to the legacy `frame_rate: number` response field (ADR D-01). */
export function fpsToLegacyNumber(value: Fps): number {
  if (!isFps(value)) throw new Error("FPS_NOT_NORMALIZED");
  const legacy = value.num / value.den;
  if (!Number.isFinite(legacy)) throw new Error("FPS_LEGACY_OVERFLOW");
  return legacy;
}

/** Exact frame to seconds. Returns a rational, never a float. */
export function frameToSeconds(frame: number, fps: Fps): Rational {
  if (!Number.isSafeInteger(frame) || frame < 0) throw invalid("Frame index must be a non-negative integer");
  if (!isFps(fps)) throw new Error("FPS_NOT_NORMALIZED");
  return rational(BigInt(frame) * BigInt(fps.den), BigInt(fps.num));
}

export type SecondsRounding = "floor" | "ceil" | "half_up";

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return -floorDiv(-a, b);
}

/**
 * Exact seconds to frame. The rounding mode is always explicit; there is no default that
 * could silently change a boundary decision.
 */
export function secondsToFrame(seconds: Rational, fps: Fps, rounding: SecondsRounding): number {
  if (!isFps(fps)) throw new Error("FPS_NOT_NORMALIZED");
  if (seconds.den <= 0n) throw new Error("RATIONAL_DENOMINATOR_ZERO");
  const numerator = seconds.num * BigInt(fps.num);
  const denominator = seconds.den * BigInt(fps.den);
  const frames = rounding === "floor" ? floorDiv(numerator, denominator)
    : rounding === "ceil" ? ceilDiv(numerator, denominator)
    : floorDiv(numerator * 2n + denominator, denominator * 2n);
  if (!Number.isSafeInteger(Number(frames))) throw new Error("FRAME_INDEX_OUT_OF_RANGE");
  return Number(frames);
}

/**
 * TM-02. A range is valid only when it is non-empty, starts at or after zero and ends
 * within the projection. Zero-length, reversed and out-of-bounds ranges are rejected
 * rather than clamped.
 */
export function assertHalfOpenRange(range: HalfOpenFrameRange, frameCount: number, correlationId?: string): void {
  if (!Number.isSafeInteger(range.start_frame) || !Number.isSafeInteger(range.end_frame_exclusive)) {
    throw invalid("Frame range bounds must be integers", correlationId);
  }
  if (range.start_frame < 0) throw invalid("Frame range must start at or after frame 0", correlationId);
  if (range.end_frame_exclusive <= range.start_frame) {
    throw invalid("Frame range must be a non-empty [start_frame, end_frame_exclusive) range", correlationId);
  }
  if (range.end_frame_exclusive > frameCount) {
    throw invalid("Frame range must end within the projection", correlationId);
  }
}

/** TM-02, single-clip form: an operation scoped to one clip may not cross its boundary. */
export function assertWithinSingleClip(range: HalfOpenFrameRange,
  clips: readonly { clip_id: string; frame_range: HalfOpenFrameRange }[], correlationId?: string): string {
  const longest = clips.reduce((maximum, clip) => Math.max(maximum, clip.frame_range.end_frame_exclusive), 0);
  assertHalfOpenRange(range, longest, correlationId);
  const covering = clips.filter((clip) => clip.frame_range.start_frame <= range.start_frame
    && clip.frame_range.end_frame_exclusive >= range.end_frame_exclusive);
  if (covering.length !== 1) {
    throw invalid("Frame range must fall inside exactly one clip", correlationId);
  }
  return covering[0]!.clip_id;
}

/**
 * TM-03. A replacement asset must cover the target range exactly or by being long
 * enough; a short asset is refused rather than looped, frozen or speed-changed behind
 * the user's back.
 */
export function assertAssetCoversRange(assetFrames: number, range: HalfOpenFrameRange, correlationId?: string): void {
  if (!Number.isSafeInteger(assetFrames) || assetFrames <= 0) {
    throw new HttpError(422, "INVALID_MEDIA", "Asset must report a positive integer frame length", undefined, correlationId);
  }
  const required = range.end_frame_exclusive - range.start_frame;
  if (assetFrames < required) {
    throw new HttpError(422, "MISSING_ASSET",
      "Asset is shorter than the selected range; Narralens does not loop, freeze or retime to fit",
      undefined, correlationId);
  }
}
