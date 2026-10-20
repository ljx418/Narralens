import { createHash } from "node:crypto";
import { canonicalJson, compareUtf8 } from "../engine/source-digest-v1.js";
import type { AffectedConsumer, ImpactSpecV1, LockChecked } from "../../contracts/wave2-types.js";

/**
 * The impact hash (`ADR-W2.0-004` §4).
 *
 * `SHA256("narralens-impact-v1\n" + canonical(spec without impact_hash))`.
 *
 * Two properties this has to have, and both are about what is *left out* as much as what is
 * in:
 *
 * - It is a function of the spec's content, not of the order the Host happened to compute
 *   it in. So every array is sorted by an explicit, total order before it is serialized,
 *   and `canonicalJson` then sorts object keys. Reordering a range list cannot change the
 *   hash, and a hash that moved for a cosmetic reason would be indistinguishable from a
 *   spec that genuinely changed.
 * - It covers *everything* that defines the authorization: the base/source/control it was
 *   computed against, the engine and its pinned upstream, the rights and plan digests, the
 *   affected ranges and consumers, the locks that were checked, the approvals, and the
 *   expiry. `impact_id` is included — it is part of the spec a client echoes back. Only
 *   `impact_hash` itself is excluded, since it cannot contain its own preimage.
 *
 * The prefix is a domain separator so a hash minted here can never collide with any other
 * domain's hash over the same bytes.
 */

export const IMPACT_HASH_DOMAIN = "narralens-impact-v1\n";
export const IMPACT_TTL_MS = 15 * 60 * 1000;

export type AffectedRange = ImpactSpecV1["affected_ranges"][number];

/** start, then end, then clip id — total, so the result is a permutation-invariant list. */
export function compareRanges(left: AffectedRange, right: AffectedRange): number {
  return left.start_frame - right.start_frame
    || left.end_frame_exclusive - right.end_frame_exclusive
    || compareUtf8(left.clip_id, right.clip_id);
}

/** kind, then id, then action. */
export function compareConsumers(left: AffectedConsumer, right: AffectedConsumer): number {
  return compareUtf8(left.kind, right.kind)
    || compareUtf8(left.id, right.id)
    || compareUtf8(left.action, right.action);
}

/** lock id. */
export function compareLocks(left: LockChecked, right: LockChecked): number {
  return compareUtf8(left.lock_id, right.lock_id);
}

/** Canonical order for every array that enters the hash. */
export function sortImpactArrays(spec: Omit<ImpactSpecV1, "impact_hash">): Omit<ImpactSpecV1, "impact_hash"> {
  return {
    ...spec,
    affected_ranges: [...spec.affected_ranges].sort(compareRanges),
    affected_consumers: [...spec.affected_consumers].sort(compareConsumers),
    locks_checked: [...spec.locks_checked].sort(compareLocks),
    // `approvals_required` is a set of strings; sorting it keeps the hash stable whatever
    // order the service built it in.
    approvals_required: [...spec.approvals_required].sort(compareUtf8),
  };
}

/**
 * The exact bytes the hash is taken over. Exposed so a second implementation can be checked
 * against the same preimage rather than against the same function.
 */
export function impactHashPreimage(spec: Omit<ImpactSpecV1, "impact_hash">): string {
  return `${IMPACT_HASH_DOMAIN}${canonicalJson(sortImpactArrays(spec))}`;
}

export function computeImpactHash(spec: Omit<ImpactSpecV1, "impact_hash">): string {
  return createHash("sha256").update(impactHashPreimage(spec), "utf8").digest("hex");
}

/**
 * Recompute and compare. Used everywhere a stored spec is read back: a row whose bytes were
 * edited after the fact must fail here rather than be honoured because the flag said active.
 */
export function verifyImpactHash(spec: ImpactSpecV1): boolean {
  const { impact_hash, ...rest } = spec;
  return computeImpactHash(rest) === impact_hash;
}

/** `expires_at` is derived from an injected clock, never from wall-clock `Date.now()`. */
export function impactExpiry(now: Date): string {
  return new Date(now.getTime() + IMPACT_TTL_MS).toISOString();
}

/** The boundary is `now >= expires_at`, so an impact is dead the instant it reaches it. */
export function isExpired(expiresAt: string, now: Date): boolean {
  const deadline = Date.parse(expiresAt);
  return !Number.isFinite(deadline) || now.getTime() >= deadline;
}
