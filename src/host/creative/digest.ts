/**
 * Canonical JSON and digests for the PRODUCT lane.
 *
 * The frozen contract fixes one canonicalization ("restricted JCS", see
 * `docs/agent-driven-v1/cp-a0/01_PROTOCOL_AND_AUTH.md` §"创作输入摘要的精确定义" and the
 * golden vectors in `docs/agent-driven-v1/cp-a0/canonical-vectors.json`):
 *
 * - object keys are the schema-declared ASCII field names, sorted ascending by UTF-16 code
 *   unit (which, inside the ASCII domain, is plain ASCII order);
 * - values keep their original code points; no Unicode normalization;
 * - UTF-8 without BOM, no whitespace;
 * - array order is preserved;
 * - only safe integers, booleans, null, strings and typed objects/arrays are accepted;
 *   floats, `-0`, non-finite numbers, `undefined` and duplicate keys are rejected.
 *
 * The digest is SHA-256 of that canonical text, lowercase hex.
 *
 * The rejections are not pedantry. A digest that silently accepts a float or drops an
 * `undefined` produces two different canonical texts for the same logical request, which
 * turns an idempotency check into a coin flip. Failing loudly at the boundary is the only
 * way a "same request" claim stays meaningful.
 */

import { createHash } from "node:crypto";
import type {
  Brief,
  CreativeInputClosure,
  RunScope,
} from "../../contracts/agent-driven-types.js";

/** Raised when a value cannot be canonicalized under the frozen rules. */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

const ASCII_KEY = /^[\x20-\x7e]+$/;

/**
 * Canonical JSON text for a value.
 *
 * The traversal is explicit rather than `JSON.stringify(value, replacer)`, because the
 * replacer form cannot reject `undefined`, cannot detect duplicate keys and cannot enforce
 * the integer domain.
 */
export function canonicalJson(value: unknown): string {
  return render(value, new Set<object>(), []);
}

function render(value: unknown, seen: Set<object>, path: string[]): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`Non-finite number at ${describe(path)}`);
      }
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalizationError(`Non-integer number at ${describe(path)}`);
      }
      if (Object.is(value, -0)) {
        throw new CanonicalizationError(`Negative zero at ${describe(path)}`);
      }
      return String(value);
    }
    case "string":
      return JSON.stringify(value);
    case "undefined":
      throw new CanonicalizationError(`Undefined value at ${describe(path)}`);
    case "bigint":
    case "function":
    case "symbol":
      throw new CanonicalizationError(`Unsupported value at ${describe(path)}`);
    default:
      break;
  }

  if (seen.has(value as object)) {
    throw new CanonicalizationError(`Circular reference at ${describe(path)}`);
  }

  if (Array.isArray(value)) {
    seen.add(value as unknown as object);
    try {
      const parts = value.map((item, index) => render(item, seen, [...path, String(index)]));
      return `[${parts.join(",")}]`;
    } finally {
      seen.delete(value as unknown as object);
    }
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of keys) {
    if (!ASCII_KEY.test(key)) {
      throw new CanonicalizationError(`Non-ASCII object key at ${describe(path)}`);
    }
    if (record[key] === undefined) {
      throw new CanonicalizationError(`Undefined member "${key}" at ${describe(path)}`);
    }
  }
  keys.sort(compareCodeUnits);

  seen.add(value as unknown as object);
  try {
    const parts = keys.map(
      (key) => `${JSON.stringify(key)}:${render(record[key], seen, [...path, key])}`,
    );
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(value as unknown as object);
  }
}

/**
 * UTF-16 code unit order.
 *
 * `<` on JavaScript strings already compares UTF-16 code units, so this is the identity
 * function written out: the contract names the order, and a reader should not have to
 * re-derive it from the language spec.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function describe(path: string[]): string {
  return path.length === 0 ? "<root>" : path.join(".");
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 of the canonical JSON text of a value. */
export function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** The digest of a complete Brief, which is what `brief_sha256` and `input_digest` carry. */
export function briefDigest(brief: Brief): string {
  return canonicalDigest(brief);
}

/**
 * The digest of the creative input closure.
 *
 * This is a *different* digest from the brief digest: the closure also covers the current
 * question and answer versions, so a new answer changes it even when the brief is
 * unchanged. Mixing the two up is exactly the bug the contract calls out — a decision
 * that was made against the old closure must not be able to start a run.
 */
export function creativeInputClosureDigest(closure: CreativeInputClosure): string {
  return canonicalDigest(closure);
}

/**
 * The digest of a run scope.
 *
 * The client never decides this: the server computes it from the scope it assembled, so a
 * client cannot widen the scope and keep the old digest.
 */
export function runScopeDigest(scope: RunScope): string {
  return canonicalDigest(scope);
}

/** The digest of a request body, used as the idempotency request digest. */
export function requestDigest(value: unknown): string {
  return canonicalDigest(value);
}

/**
 * A deterministic identifier derived from its parts.
 *
 * Used where the identity of a record has to be reproducible from the request rather than
 * randomly generated — the pre-project content decision, for example, is keyed by
 * `(intake_id, intake_version, request_id)` so that a replay with the same request lands
 * on the same row while the same request id with different content lands on the same row
 * too and is therefore detected as a conflict.
 */
export function deterministicId(prefix: string, parts: readonly string[]): string {
  const digest = sha256Hex([prefix, ...parts].join("\u0000"));
  return `${prefix}-${digest.slice(0, 32)}`;
}

/**
 * The digest of a request body, ignoring its transport metadata.
 *
 * `meta` carries the idempotency key and the correlation id. Neither is part of the
 * content: two requests that differ only in their correlation id are the same request and
 * have to hash the same, otherwise a retry of the same logical call looks like a different
 * request and raises a spurious conflict.
 */
export function contentDigest(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return canonicalDigest(payload);
  }
  const { meta: _meta, ...rest } = payload as Record<string, unknown>;
  return canonicalDigest(rest);
}

/* -------------------------------------------------------------------------------------- */
/* The fixed A plan                                                                        */
/* -------------------------------------------------------------------------------------- */

/** The published execution digest of `local-short-film@1`. */
export const FIXED_PLAN_EXECUTION_DIGEST =
  "b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32";

/**
 * The fixed A plan, byte for byte the golden `referenceVectors.fixedPlan.value`.
 *
 * The canonical JSON of this document has to hash to `FIXED_PLAN_EXECUTION_DIGEST`.
 * `assertFixedPlanDigest` checks that, so a typo in this literal cannot silently produce
 * a plan whose digest does not match the published template.
 */
export const FIXED_PLAN = {
  template_id: "local-short-film",
  template_version: 1,
  stages: [
    { id: "definition", after: [] },
    { id: "sample", after: ["definition"], review: "sample" },
    { id: "first_chapter", after: ["sample"], review: "first_chapter" },
    { id: "chapters", after: ["first_chapter"], review: "chapter_pack" },
    { id: "cover", after: ["chapters"], review: "cover" },
    { id: "delivery", after: ["chapters", "cover"], review: "qc" },
  ],
  capabilities: ["clip.prepare", "snapshot.render", "qc.inspect", "delivery.package"],
  stability_skip: false,
  dynamic_patch: false,
  paid: false,
  external_write: false,
  runtime_mutation: false,
} as const;

/**
 * Checks that the fixed plan literal still hashes to the published execution digest.
 *
 * The callers use it as a precondition, so a corrupted plan is a hard failure rather than
 * a run with a mismatched digest.
 */
export function assertFixedPlanDigest(): boolean {
  const digest = canonicalDigest(FIXED_PLAN);
  if (digest !== FIXED_PLAN_EXECUTION_DIGEST) {
    throw new CanonicalizationError(
      `The fixed plan does not match the published execution digest: ${digest}`,
    );
  }
  return true;
}
