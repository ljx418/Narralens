import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import {
  markCacheProductionCleanupRequired,
} from "./cache-production-scope.js";
import type { CacheProductionScope } from "./cache-production-scope.js";

/**
 * The supervisor of the native cache worker, at protocol revision 3.
 *
 * The pinned upstream draws a page's picture in a headless browser it keeps for the
 * whole process, and nothing about the upstream's own API says whether the work
 * behind a picture really ended. A resolved promise is not a proof: the browser may
 * still be running, a late page may still be loading, and a child of the browser may
 * still be alive with the file descriptor of the drawing open.
 *
 * So the draw happens in a worker of its own, and this supervisor owns that
 * worker - together with a custodian that lives OUTSIDE the group of the draw and
 * is the only wait owner of it:
 *
 *     Host -> C (custodian; own session and group) -> N (worker; own session and
 *     group) -> the browser and everything under it (they inherit N)
 *
 * The custodian exists because a group that is killed leaves orphans, and an
 * orphan that nobody waits for is a zombie that never goes away. The custodian is
 * outside the group, so it survives the kill, adopts the orphans and reaps them -
 * and it keeps the worker's own exit visible WITHOUT reaping it until every
 * signal that is still needed has been sent.
 *
 * What this supervisor is careful about:
 *
 *  - The RESERVATION comes before anything is born. The draw's responsibility is
 *    registered first, and the handle is signed by THIS instance: a handle of
 *    another supervisor is not a handle here, even a real one.
 *
 *  - The HANDSHAKE is a proof, not a greeting. The custodian states its own
 *    identity, the worker states its own, and this supervisor reads the same
 *    facts from the kernel and compares them - field by field - before it adopts
 *    any of them. The ticket of the draw travels over the private socket and
 *    nowhere else: not in the argument vector, not in the environment, not in a
 *    URL and not in a log.
 *
 *  - The CHILD IS STARTED DETACHED. The custodian is the leader of its own
 *    session and its own group before its first instruction runs, and this
 *    supervisor checks that against the kernel instead of assuming it.
 *
 *  - A CANDIDATE is not a settlement. The picture the worker returns is a
 *    candidate; it becomes the result only after the receipt of the custodian
 *    really matches, the custodian has really closed with the code of a settled
 *    draw, the worker has really been reaped, the group has really gone and every
 *    identity that was recorded is really gone - zombies included.
 *
 *  - The FINALISATION is recorded BEFORE it is asked for, and the FIRST failure
 *    latches: a candidate that arrives after a failure is not a success - and a
 *    candidate may still be UNDONE by a failure that comes after it.
 *
 *  - A PROVEN CLEANUP ends the draw - the failure of a draw is settled only
 *    after its process domain is really gone. A cleanup that cannot be proven
 *    keeps the whole promise PENDING: the scope, the descriptors, the capacity
 *    and the working copy stay where they are.
 *
 *  - Every draw has a PRIVATE namespace of its own: a run directory with a HOME,
 *    an XDG cache, an XDG configuration, an XDG data, an XDG runtime and a
 *    temporary directory inside it. The Host's own HOME is never changed, and the
 *    directory is removed only when the draw really ended.
 */

/** What one draw is asked to do. */
export interface CacheDrawRequest {
  /** The working copy the picture is drawn from. */
  readonly root: string;
  /** The origin the page of that working copy is served from. */
  readonly base: string;
  /** The page of the working copy, relative to its root. */
  readonly rel: string;
  /** The moment of the picture, in milliseconds. A negative moment is the poster. */
  readonly ms: number;
  /** The width of the picture, in pixels. */
  readonly width: number;
  /** The upstream's own tweaks of that page. */
  readonly overrides: unknown[] | null;
}

/** The phase of a draw, as the supervisor knows it. */
export type CacheDrawPhase =
  | "reserved"
  | "spawning"
  | "custodian_hello"
  | "forked"
  | "identified"
  | "drawing"
  | "candidate"
  | "finalize_after_ok"
  | "terminating"
  | "execution_settled"
  | "failed"
  | "cleanup_required";

/** What one draw ended with. */
export interface CacheDrawSettlement {
  /** The picture, when the draw really ended with one. */
  readonly picture: Buffer | null;
  /** The original failure, when the draw really ended with one. */
  readonly error: unknown;
  /** Every failure of the cleanup, kept with the outcome. */
  readonly cleanup: readonly unknown[];
}

/**
 * The handle of one draw.
 *
 * It is an OPAQUE handle: the facts behind it live in this module's private table,
 * and a copy of it, a JSON object and a handle of another supervisor are not in
 * that table at all. Its own fields are read-only views of those facts.
 */
export interface CacheDrawHandle {
  /** The phase the draw is in. */
  readonly phase: CacheDrawPhase;
  /** The digest of the candidate, when there is one. It is not an authority. */
  readonly candidate_digest: string | null;
  /** Whether the draw is held because its cleanup could not be proven. */
  readonly cleanup_required: boolean;
  /** The whole promise of the draw. It stays pending while the cleanup is unproven. */
  readonly settlement: Promise<CacheDrawSettlement>;
}

/** What `inspectCleanup` reports. It is a read-only copy and grants nothing. */
export interface CacheCleanupInspection {
  readonly known: boolean;
  readonly phase: CacheDrawPhase | null;
  readonly cleanup_required: boolean;
  readonly settled: boolean;
  readonly custodian_pid: number | null;
  readonly worker_pid: number | null;
  readonly worker_start_ticks: string | null;
  readonly group: number | null;
  readonly session: number | null;
  readonly group_members: number;
  readonly zombies: number;
  readonly finalize_after_ok: boolean;
  readonly observed_signals: readonly string[];
  readonly cleanup_failures: number;
  readonly latched_outcome: CacheLatchedOutcome;
  /** The private run directory of the draw, while it is still there. */
  readonly run_directory: string | null;
  /** Whether the receipt of the custodian really matched this draw. */
  readonly receipt_valid: boolean;
}

/**
 * A BOUNDED, READ-ONLY copy of the facts of a draw.
 *
 * It is the surface an owner of a draw uses to KEEP what really happened. It
 * carries FACTS and COPIES only: never the raw ticket of the draw, never a
 * token, never a socket, never a process handle and never a mutable internal
 * authority.
 */
export interface CacheDiagnosticSnapshot {
  readonly known: true;
  readonly phase: CacheDrawPhase;
  readonly settled: boolean;
  readonly cleanup_required: boolean;
  /** The short name of the draw. It is not the ticket and it is not a secret. */
  readonly draw_id: string;
  /** The digest of the ticket of the draw. The ticket ITSELF is never here. */
  readonly ticket_digest: string;
  /** The COMPLETE epoch of the custodian, as the kernel reported it. */
  readonly custodian: CacheProcessIdentity | null;
  readonly custodian_born: boolean;
  readonly custodian_closed: boolean;
  readonly custodian_exit: { readonly code: number | null; readonly signal: string | null } | null;
  /** The COMPLETE epoch of the worker, as the kernel reported it. */
  readonly worker: CacheProcessIdentity | null;
  readonly forked: boolean;
  readonly forked_pid: number | null;
  readonly exec_ok: boolean | null;
  /** The identities this draw recorded while they were alive. */
  readonly recorded_targets: readonly { readonly pid: number; readonly start_ticks: string }[];
  /** The summary of the receipt, without its ticket and without its digests. */
  readonly receipt_summary: CacheReceiptSummary | null;
  /** The counts of the accumulator of the segments. */
  readonly accumulator_summary: CacheAccumulatorSummary;
  readonly latched_outcome: CacheLatchedOutcome;
  /** The provenance of the cancel of the owner, when there was one. */
  readonly cancel_provenance: CacheCancelProvenance | null;
  /** The later cancels of the owner, as a bounded fact. */
  readonly cancel_secondary: CacheCancelSecondary | null;
  /** The bounded failures of the cleanup that the draw kept. */
  readonly cleanup_facts: readonly CacheBoundedFailure[];
  /** The ACTUAL observations of the last terminal proof of the draw. */
  readonly terminal_proof: CacheTerminalProofObservations | null;
  readonly observed_signals: readonly string[];
  readonly cleanup_failures: number;
  readonly run_directory: string | null;
  readonly transport_failure: CacheNativeErrorEnvelope | null;
}

/**
 * The provenance of ONE cancel of the owner of a draw.
 *
 * It is BOUNDED and it is READ-ONLY: it says WHICH error the owner asked to
 * cancel with, and whether that cancel really became the PRIMARY outcome of
 * the draw. An error that was already latched - a native failure or a
 * transport failure - keeps the primary outcome, and the cancel is then only
 * a fact about what the owner asked for.
 *
 * It is IMMUTABLE once it is written: a later cancel of the owner may not
 * rewrite the history of the first one.
 */
export interface CacheCancelProvenance {
  /** The code of the cancel of the owner. */
  readonly code: string;
  /** The bounded message of the cancel of the owner. */
  readonly message: string;
  /** The name of the ORIGINAL error object of the owner. */
  readonly error_name: string;
  /** The code of the ORIGINAL error object of the owner, when it had one. */
  readonly error_code: string | null;
  /** Whether this cancel became the PRIMARY outcome of the draw. */
  readonly accepted_as_primary: boolean;
  /** Whether an EARLIER failure was already the primary outcome. */
  readonly superseded_by_earlier_failure: boolean;
}

/**
 * A later cancel of the owner, as a BOUNDED fact.
 *
 * It never replaces the provenance of the first cancel: it says how many
 * later requests there were and what the last one asked for. The count is
 * bounded by its nature - it is a number, not a history.
 */
export interface CacheCancelSecondary {
  readonly count: number;
  readonly message: string;
  readonly error_name: string;
  readonly error_code: string | null;
}

/** A bounded description of a failure that the draw kept. */
export interface CacheBoundedFailure {
  readonly name: string;
  readonly code: string | null;
  readonly message: string;
}

/**
 * ONE observation of the terminal proof, as it really happened.
 *
 * It is a FACT of the proof path and not a boolean: the presence that the
 * kernel reported, the number it was about, the epoch it carried and the
 * moment it was observed.
 */
export interface CacheTerminalProofObservation {
  /** When the observation was made. */
  readonly at: number;
  /** Which part of the proof this observation belongs to. */
  readonly kind: "custodian-epoch" | "worker-epoch" | "group" | "known-target";
  /** What the kernel said. */
  readonly presence: CacheProcessPresence;
  /** The number the observation was about. */
  readonly pid: number | null;
  /** The epoch the number carried, when it was known. */
  readonly start_ticks: string | null;
  /** The state of the process, when it was known. */
  readonly state: string | null;
  /** Why the observation is what it is. */
  readonly reason: string | null;
}

/** The observations of the LAST terminal proof of a draw. */
export interface CacheTerminalProofObservations {
  /** When the proof ran. */
  readonly at: number;
  /** Whether the proof succeeded. */
  readonly proven: boolean;
  /** Whether the observations did not fit and were cut. */
  readonly truncated: boolean;
  readonly observations: readonly CacheTerminalProofObservation[];
}

/** The summary of a receipt, as a bounded and secret-free copy. */
export interface CacheReceiptSummary {
  readonly kind: string;
  readonly outcome: string;
  readonly seq: number;
  readonly segments: number;
  readonly events_count: number;
  readonly waits_count: number;
  readonly identities_count: number;
  readonly exec_ok: boolean;
  readonly echild: boolean;
  readonly group_esrch: boolean;
  readonly known_ids_gone: boolean;
  readonly anchor_retained: boolean;
  readonly identity_overflow: boolean;
  readonly events_truncated: boolean;
  readonly diagnostics_lost: boolean;
  readonly state: string | null;
  /**
   * The digests that the CUSTODIAN really computed for the receipt.
   *
   * They are COPIED, never recomputed here: a summary that invented its own
   * digest would be a second oracle, and a second oracle is not a proof. A
   * value that is not a complete digest is NULL, and it is never a partial
   * one.
   */
  readonly events_digest: string | null;
  readonly waits_digest: string | null;
  readonly identities_digest: string | null;
}

/** The counts of the accumulator of the segments of a receipt. */
export interface CacheAccumulatorSummary {
  readonly segments: number;
  readonly received: number;
  readonly events: number;
  readonly waits: number;
  readonly identities: number;
  readonly refused: boolean;
  /**
   * The digests that the ACCUMULATOR really computed.
   *
   * They are the digests of the bytes that arrived, and they are COPIED from
   * the accumulator: they are not recomputed here, and they are never
   * invented. A value that is not a complete digest is NULL.
   */
  readonly events_digest: string | null;
  readonly waits_digest: string | null;
  readonly identities_digest: string | null;
}

/**
 * The outcome that was LATCHED for a draw.
 *
 * The first thing that went wrong is the outcome. A candidate that arrives later
 * does not replace it, and a reconcile may not turn a latched failure into a
 * picture.
 */
export interface CacheLatchedOutcome {
  readonly kind: "none" | "failure" | "candidate";
  /** The code of the failure, when there was one. */
  readonly code: string | null;
  /** The message of the failure, when there was one. */
  readonly message: string | null;
  /** The native phase the failure came from, when it came from the producer. */
  readonly native_phase: string | null;
}

/** The identity of a process, as the kernel reports it. */
export interface CacheProcessIdentity {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly sid: number;
  /** The start time of the process, as the kernel counts it. */
  readonly start_ticks: number;
  /** The state of the process: `Z` is a zombie, which is not gone. */
  readonly state: string;
}

/** What the kernel says about a process. */
export type CacheProcessPresence = "gone" | "known" | "unknown";

/** The result of asking the kernel about a process. */
export interface CacheProcessObservation {
  readonly presence: CacheProcessPresence;
  readonly identity: CacheProcessIdentity | null;
  /** Why the answer is unknown, when it is. */
  readonly reason: string | null;
}

/** What the kernel says about a process group. */
export interface CacheGroupObservation {
  readonly presence: CacheProcessPresence;
  readonly members: readonly CacheProcessIdentity[];
  readonly reason: string | null;
}

/** The bounds of one draw. They are action deadlines, never a settlement. */
export const CACHE_DRAW_LIMITS = Object.freeze({
  /** The whole two level startup chain: the custodian AND the worker. */
  readyMs: 30_000,
  /** The whole draw once it was told to go, including the complete candidate. */
  outerMs: 60_000,
  /** The closing of the worker, counted from the candidate. */
  finalizeMs: 3_000,
  /** How long the group may take to answer the polite signal. */
  termGraceMs: 3_000,
  /** How long the confirmation of a hard kill may take. */
  killConfirmMs: 15_000,
  /** One metadata frame of either private channel. */
  metadataBytes: 16 * 1024,
  /** The request frame of the draw channel. */
  requestBytes: 64 * 1024,
  /** One picture frame of the draw channel. */
  jpegBytes: 8 * 1024 * 1024,
  /** How much the worker may write on its standard output. */
  stdoutBytes: 64 * 1024,
  /** How much the worker may write on its standard error. */
  stderrBytes: 64 * 1024,
  /** How much of a flood is kept as a diagnostic. */
  diagnosticTailBytes: 8 * 1024,
  /** How many decoded frames of the control channel may wait to be read. */
  controlQueueFrames: 8,
  /** How many decoded bytes of the control channel may wait to be read. */
  controlQueueBytes: 64 * 1024,
  /** How many decoded frames of the draw channel may wait to be read. */
  drawQueueFrames: 4,
  /**
   * How many decoded bytes of the draw channel may wait to be read.
   *
   * It is the picture AND the metadata of the answer, because a legal answer may
   * arrive in one chunk: the picture is 8MiB and the metadata in front of it is
   * 16KiB, and both have to fit.
   */
  drawQueueBytes: 8 * 1024 * 1024 + 16 * 1024 + 64,
});

/**
 * The environment the custodian and the worker are given.
 *
 * It is an ALLOWLIST and not the environment of the Host: the child gets the few
 * names a browser and an interpreter really need and nothing else. A variable
 * that could change how the child's own code runs - `NODE_OPTIONS` above all -
 * is never passed on.
 */
const CACHE_CHILD_ENV_NAMES = Object.freeze([
  "PATH", "LANG", "LC_ALL", "LC_CTYPE",
  "PLAYWRIGHT_BROWSERS_PATH", "SYSTEMROOT", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
]);

/**
 * The names of the environment that are NEVER taken from the Host.
 *
 * The HOME and the XDG directories of a draw are the PRIVATE ones of that draw.
 * The Host's own HOME is the user's home, and a browser that inherits it writes
 * into the user's own configuration.
 */
const PRIVATE_CHILD_ENV_NAMES = Object.freeze([
  "HOME", "TMPDIR", "TMP", "TEMP",
  "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
]);

/** The directories of the private run directory of one draw. */
const PRIVATE_RUN_DIRECTORIES = Object.freeze([
  "home", "cache", "config", "data", "runtime", "tmp",
]);

/** How many cleanup failures are kept. A draw that needed more says so. */
const MAX_CLEANUP_FAILURES = 64;

/** The protocol of revision 3. The old revision is not silently compatible. */
export const CACHE_PROCESS_PROTOCOL = "narralens.openfilm-cache-process@3";

/** The failure of a draw that could not be proven to have ended. */
export class CacheCleanupRequiredError extends Error {
  readonly cleanup_required = true;
  readonly cleanup_failures: readonly unknown[];
  constructor(message: string, cleanupFailures: readonly unknown[]) {
    super(message);
    this.name = "CacheCleanupRequiredError";
    this.cleanup_failures = cleanupFailures;
  }
}

/** The failure of the draw itself, as it is reported. */
export class CacheDrawError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CacheDrawError";
    this.code = code;
  }
}

/**
 * The original failure of the producer, as it crossed the process boundary.
 *
 * It is a TRANSPORT FACT and not the original object: the very same JavaScript
 * object did not survive the process boundary and this does not pretend that it
 * did. What survives is the bounded structure of it - its name, its code, its
 * message, its stack, its cause and the phase it came from - so that a seek, a
 * JOB and a capture are told apart instead of being flattened into one line.
 */
export interface CacheNativeErrorEnvelope {
  readonly name: string;
  readonly code: string | null;
  readonly message: string;
  readonly stack: string | null;
  readonly cause: CacheNativeErrorEnvelope | null;
  /** The phase of the producer the failure came from. */
  readonly phase: string | null;
}

/** The failure of the producer, as the Host holds it. */
export class CacheNativeError extends Error {
  /** The bounded structure of the original failure. */
  readonly native: CacheNativeErrorEnvelope;
  constructor(envelope: CacheNativeErrorEnvelope) {
    super(`${envelope.name}: ${envelope.message}`);
    this.name = "CacheNativeError";
    this.native = envelope;
  }
}

/**
 * Parse one /proc/<pid>/stat text.
 *
 * The layout is `pid (comm) state ppid pgrp session ...`. The command name may
 * hold spaces AND parentheses, so the fields after it are read from the LAST
 * closing parenthesis - and the PID is the number BEFORE the FIRST opening one.
 * The field after the closing parenthesis is the STATE (S, R, Z, ...): it is a
 * state and never a number.
 */
export function parseCacheProcStat(text: string): CacheProcessIdentity | null {
  const head = text.indexOf("(");
  const cut = text.lastIndexOf(")");
  if (head < 0 || cut < 0 || cut < head) return null;
  const pidText = text.slice(0, head).trim();
  if (!/^[0-9]+$/u.test(pidText)) return null;
  const fields = text.slice(cut + 1).trim().split(/\s+/u);
  if (fields.length < 20) return null;
  const state = fields[0]!;
  const numberAt = (index: number): number | null => {
    const value = fields[index];
    if (value === undefined || !/^-?[0-9]+$/u.test(value)) return null;
    return Number(value);
  };
  const ppid = numberAt(1);
  const pgid = numberAt(2);
  const sid = numberAt(3);
  const startTicks = numberAt(19);
  if (ppid === null || pgid === null || sid === null || startTicks === null) return null;
  return {
    pid: Number(pidText),
    ppid, pgid, sid,
    start_ticks: startTicks,
    state,
  };
}

/**
 * Ask the kernel about one process.
 *
 * The answer is one of three things, and the difference matters:
 *
 *  - `gone`    the kernel says the process does not exist,
 *  - `known`   the kernel says exactly what it is,
 *  - `unknown` the kernel could not be asked, or answered something that could not
 *              be read. UNKNOWN is NEVER "gone": a process this supervisor cannot
 *              read may still be running.
 */
export function observeCacheProcessIdentity(pid: number): CacheProcessObservation {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ESRCH") {
      return { presence: "gone", identity: null, reason: null };
    }
    return { presence: "unknown", identity: null, reason: String(code ?? "unknown") };
  }
  const identity = parseCacheProcStat(text);
  if (identity === null) {
    return { presence: "unknown", identity: null, reason: "the process state could not be read" };
  }
  return { presence: "known", identity, reason: null };
}

/**
 * Ask the kernel about a process group.
 *
 * The group is found by its NUMBER: a process belongs to it when the kernel says
 * its group is that number. The names of the processes are never read and never
 * used to decide anything.
 *
 * A process whose state cannot be read makes the WHOLE answer unknown: it may
 * be a member of this group, and "the group looks empty" is not a proof that it is.
 */
export function observeCacheProcessGroup(pgid: number): CacheGroupObservation {
  const members: CacheProcessIdentity[] = [];
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch (error) {
    return { presence: "unknown", members, reason: "the process list could not be read" };
  }
  let tainted: string | null = null;
  for (const entry of entries) {
    if (!/^[0-9]+$/u.test(entry)) continue;
    const observation = observeCacheProcessIdentity(Number(entry));
    if (observation.presence === "unknown") {
      tainted = observation.reason ?? "a process could not be read";
      continue;
    }
    if (observation.presence === "gone") continue;
    if (observation.identity === null) continue;
    if (observation.identity.pgid === pgid) members.push(observation.identity);
  }
  if (tainted !== null) {
    return { presence: "unknown", members, reason: tainted };
  }
  if (members.length > 0) {
    return { presence: "known", members, reason: null };
  }
  // A complete read found nobody. Whether the GROUP still exists is a second
  // fact, and it is asked of the kernel as well.
  try {
    process.kill(-pgid, 0);
    return { presence: "known", members, reason: "the group exists and its members could not be enumerated" };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ESRCH") return { presence: "gone", members, reason: null };
    return { presence: "unknown", members, reason: String(code ?? "unknown") };
  }
}

/**
 * The digest of a chain of events.
 *
 * The custodian records every event of the draw in a chain and publishes the
 * digest of that chain. The Host recomputes it from the events it received: a
 * receipt whose events were cut, changed or reordered does not match its own
 * digest, and it may not be used as a proof.
 */
export function cacheEventChainDigest(events: readonly string[]): string {
  const digest = createHash("sha256");
  for (const event of events) digest.update(`${event}\n`);
  return digest.digest("hex");
}

/**
 * The exact text of one value, as BOTH ends of the protocol compute it.
 *
 * The custodian writes it with `json.dumps(..., sort_keys=True)` and this writes
 * the same text: the keys are sorted, there are no spaces, and a value that is
 * not a string is written the way the custodian writes it.
 */
export function canonicalCacheJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalCacheJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalCacheJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The exact text of ONE item of a receipt segment. */
export function canonicalCacheReceiptItem(item: { readonly t?: unknown; readonly v?: unknown }): string {
  return item.t === "e" ? String(item.v) : canonicalCacheJson(item.v);
}

/** How many items the whole receipt may carry. */
const MAX_RECEIPT_ITEMS = 4096;
/** How many identities the receipt may carry. */
const MAX_RECEIPT_IDENTITIES = 512;
/** How many wait FACTS the accumulator keeps for the proof of a failed start. */
const MAX_RECEIPT_WAIT_FACTS = 256;
/** How many recorded targets a diagnostic snapshot may carry. */
const MAX_DIAGNOSTIC_TARGETS = 64;
/** The bounded facts of a cleanup are kept: the count alone is not the truth. */
const MAX_BOUNDED_CLEANUP_FACTS = 32;
/** The bounded observations of one terminal proof. */
const MAX_TERMINAL_OBSERVATIONS = 64;

/**
 * A digest of the production, as a BOUNDED string.
 *
 * It is a COPY of a digest that the receipt or the accumulator really
 * computed: it is never recomputed here, and it is never invented. A value
 * that is not a complete lowercase digest of 64 hexadecimal digits is NULL,
 * and it is never a partial one.
 */
function boundedDigestString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^[0-9a-f]{64}$/u.test(text)) return null;
  return text;
}

/**
 * The bounded serialization of the failures that a draw kept.
 *
 * It is a COPY: the original objects stay where they are, and the copy never
 * grows without a bound.
 */
function boundedCacheFailures(causes: readonly unknown[]): CacheBoundedFailure[] {
  const bounded: CacheBoundedFailure[] = [];
  for (const cause of causes.slice(0, MAX_BOUNDED_CLEANUP_FACTS)) {
    const record = (cause ?? {}) as { name?: unknown; message?: unknown; code?: unknown };
    bounded.push(Object.freeze({
      name: String(record.name ?? "Error").slice(0, 128),
      code: typeof record.code === "string" ? record.code.slice(0, 64) : null,
      message: String(record.message ?? "").slice(0, 1024),
    }));
  }
  return bounded;
}

/**
 * What the receipt segments that arrived so far add up to.
 *
 * It is the state of the accumulation, and it is what the final summary is
 * checked against: a summary whose totals and digests do not match the
 * segments that really arrived is not a receipt.
 */
export interface CacheReceiptAccumulatorState {
  /** How many segments the receipt DECLARED. */
  readonly segments: number;
  /** How many segments really arrived. */
  readonly received: number;
  readonly events: number;
  readonly events_digest: string;
  readonly waits: number;
  readonly waits_digest: string;
  readonly identities: number;
  readonly identities_digest: string;
  /**
   * The bounded FACTS of the waits: which process was really waited for, and
   * how it ended.
   *
   * A count is not a proof: a receipt may carry one wait of something else and
   * claim that the worker of the draw was reaped. These facts are what the
   * proof of a FAILED startup is made of.
   */
  readonly wait_facts: readonly CacheReceiptWaitFact[];
  /** The retained wait facts did not fit, and the receipt says so. */
  readonly wait_facts_truncated: boolean;
  /** The order of the LAST wait that really happened. */
  readonly last_wait_order: number;
  /**
   * The IMMUTABLE binding that every segment of the receipt carried.
   *
   * It is bound by the FIRST segment, and it never changes: a segment of
   * another draw is a segment of another receipt.
   */
  readonly protocol: string | null;
  readonly draw_id: string | null;
  readonly ticket_digest: string | null;
  /** The epochs of the retained targets, with the way each one ended. */
  readonly identity_facts: readonly {
    readonly epoch: CacheReceiptEpoch;
    readonly completion: string;
  }[];
  /** The wait of the worker ITSELF, when the receipt carries one. */
  readonly worker_wait: CacheReceiptWaitFact | null;
}

/** One wait of the receipt, as a bounded fact. */
export interface CacheReceiptWaitFact {
  /** The process that was really waited for. */
  readonly pid: number;
  /** How it ended: "exited", "signaled" or "unknown". */
  readonly kind: string;
  /** The FULL epoch of the process that was waited for. */
  readonly epoch: CacheReceiptEpoch | null;
  /** The increasing number of the wait: it is the ORDER of the waits. */
  readonly order: number;
  /** "worker" or "adopted": the wait of the worker itself, or of a descendant. */
  readonly category: string;
}

/**
 * The FULL epoch of a process: its number AND its ticks.
 *
 * The identity of a process is not its number: a number that was given to
 * somebody else is not the same process.
 */
export interface CacheReceiptEpoch {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly sid: number;
  readonly start_ticks: string;
}

/** How the epoch of a retained target ended. */
export const CACHE_COMPLETION_WAITED = "waited-by-custodian";
export const CACHE_COMPLETION_PARENT_REAPED = "parent-reaped-observed-gone";
export const CACHE_COMPLETION_UNKNOWN = "unknown";

/**
 * The accumulator of the SEGMENTS of a receipt.
 *
 * The bulk of a receipt does not fit into one frame, and it is not supposed
 * to: the custodian sends it in bounded segments, and the Host takes them in
 * order. A segment that arrives out of order, that is missing, that is
 * repeated or that carries an item that does not match its own digest is
 * REFUSED here - and a refused receipt may not be used as a proof.
 */
export class CacheReceiptAccumulator {
  #index = 0;
  #count = -1;
  #events = 0;
  #waits = 0;
  #identities = 0;
  #items = 0;
  #eventsDigest = createHash("sha256");
  #waitsDigest = createHash("sha256");
  #identitiesDigest = createHash("sha256");
  /** The identities that arrived, by their EPOCH: the number AND the ticks. */
  readonly #identityEpochs = new Set<string>();
  /** The bounded facts of the waits that really happened. */
  readonly #waitFacts: CacheReceiptWaitFact[] = [];
  /** The epochs of the retained targets, with the way each one ended. */
  readonly #identityFacts: { epoch: CacheReceiptEpoch; completion: string }[] = [];
  /** The wait of the worker ITSELF: it has a slot of its own. */
  #workerWait: CacheReceiptWaitFact | null = null;
  /** The retained wait facts did not fit, and the fact says so. */
  #waitFactsTruncated = false;
  /** The order of the LAST wait that really happened, even if it did not fit. */
  #lastWaitOrder = 0;
  /** The immutable binding of the draw, bound by the FIRST segment. */
  #protocol: string | null = null;
  #drawId: string | null = null;
  #ticketDigest: string | null = null;
  /** Why the accumulator refused something, when it did. */
  reason: string | null = null;

  /** Take ONE segment of the receipt. It returns the reason when it refused it. */
  take(segment: Record<string, unknown>): string | null {
    if (this.reason !== null) return this.reason;
    // The wire types are STRICT: a number that arrives as a string is not a
    // number, and Number("1") is not a segment order.
    const index = segment.index;
    const count = segment.count;
    if (typeof index !== "number" || typeof count !== "number"
      || !Number.isInteger(index) || !Number.isInteger(count) || count <= 0) {
      return this.#refuse("a receipt segment carries no segment order");
    }
    if (this.#count === -1) this.#count = count;
    if (count !== this.#count) {
      return this.#refuse("the receipt segments disagree about their number");
    }
    if (index !== this.#index) {
      return this.#refuse("the receipt segments arrived out of order");
    }
    // The IMMUTABLE binding of the draw: it is bound by the FIRST segment,
    // and a segment of another draw is a segment of another receipt.
    const protocol = typeof segment.protocol === "string" ? segment.protocol : "";
    const drawId = typeof segment.draw_id === "string" ? segment.draw_id : "";
    const ticketDigest = typeof segment.ticket_digest === "string" ? segment.ticket_digest : "";
    if (this.#protocol === null) {
      this.#protocol = protocol;
      this.#drawId = drawId;
      this.#ticketDigest = ticketDigest;
    } else if (protocol !== this.#protocol
      || drawId !== this.#drawId
      || ticketDigest !== this.#ticketDigest) {
      return this.#refuse("a segment of the receipt belongs to another draw");
    }
    const items = segment.items;
    if (!Array.isArray(items)) return this.#refuse("a receipt segment carries no items");
    const texts = items.map(item => canonicalCacheReceiptItem(item as { t?: unknown; v?: unknown }));
    const digest = createHash("sha256");
    for (const text of texts) digest.update(`${text}\n`);
    if (segment.items_digest !== digest.digest("hex")) {
      return this.#refuse("the items of a receipt segment do not match its digest");
    }
    for (const item of items) {
      const record = item as { readonly t?: unknown; readonly v?: unknown };
      const text = canonicalCacheReceiptItem(record);
      this.#items += 1;
      if (this.#items > MAX_RECEIPT_ITEMS) {
        return this.#refuse("the receipt carries more items than the limit allows");
      }
      if (record.t === "e") {
        this.#events += 1;
        this.#eventsDigest.update(`${text}\n`);
      } else if (record.t === "w") {
        const wait = this.#readWaitItem(record.v);
        if (wait === null) {
          return this.#refuse("a wait of the receipt is not a legal terminal fact");
        }
        this.#waits += 1;
        this.#waitsDigest.update(`${text}\n`);
        this.#recordWaitFact(wait);
      } else if (record.t === "i") {
        const identity = this.#readIdentityItem(record.v);
        if (identity === null) {
          return this.#refuse("an identity of the receipt is not a legal epoch");
        }
        const pid = identity.epoch.pid;
        // The identity of a process is its number AND its ticks: the same
        // number that was given to somebody else is NOT the same identity.
        const key = `${pid}:${identity.epoch.start_ticks}`;
        if (this.#identityEpochs.has(key)) {
          return this.#refuse("the receipt carries the same identity twice");
        }
        if (this.#identityFacts.length >= MAX_RECEIPT_IDENTITIES) {
          return this.#refuse("the receipt carries more identities than the limit allows");
        }
        this.#identityEpochs.add(key);
        this.#identities += 1;
        this.#identitiesDigest.update(`${text}\n`);
        this.#identityFacts.push(identity);
      } else {
        return this.#refuse("the receipt carries an item of an unknown kind");
      }
    }
    this.#index += 1;
    return null;
  }

  /**
   * What the segments that arrived add up to.
   *
   * It is a READ-ONLY SNAPSHOT: it never consumes the accumulator. The digests
   * are taken of a COPY of the live hashes, so the state may be read again and
   * again - before, between and after the segments - and the accumulator stays
   * OPEN for the segments that arrive later.
   *
   * The bytes of a receipt are digested ONCE, at the end. A state that was
   * digested consumed the hash: the second read threw, and an early read
   * broke every later segment.
   */
  state(): CacheReceiptAccumulatorState {
    return {
      segments: this.#count,
      received: this.#index,
      events: this.#events,
      events_digest: this.#eventsDigest.copy().digest("hex"),
      waits: this.#waits,
      waits_digest: this.#waitsDigest.copy().digest("hex"),
      identities: this.#identities,
      identities_digest: this.#identitiesDigest.copy().digest("hex"),
      wait_facts: Object.freeze([...this.#waitFacts]),
      wait_facts_truncated: this.#waitFactsTruncated,
      last_wait_order: this.#lastWaitOrder,
      protocol: this.#protocol,
      draw_id: this.#drawId,
      ticket_digest: this.#ticketDigest,
      identity_facts: Object.freeze([...this.#identityFacts]),
      worker_wait: this.#workerWait,
    };
  }

  #refuse(reason: string): string {
    this.reason = reason;
    return reason;
  }

  /**
   * Keep ONE bounded fact about a wait.
   *
   * The proof of a FAILED startup needs the wait of the failed worker itself:
   * a receipt that carries the wait of something else is not a proof that the
   * worker of the draw really ended.
   */
  #recordWaitFact(wait: CacheReceiptWaitFact): void {
    // The wait of the WORKER has a slot of its own: it is never lost to the
    // bound of the retained facts.
    if (wait.category === "worker") this.#workerWait = wait;
    if (wait.order > this.#lastWaitOrder) this.#lastWaitOrder = wait.order;
    if (this.#waitFacts.length >= MAX_RECEIPT_WAIT_FACTS) {
      // The retained facts are bounded, and the fact that they did not fit is
      // NOT hidden.
      this.#waitFactsTruncated = true;
      return;
    }
    this.#waitFacts.push(wait);
  }

  /** The FULL epoch of an item, or null when it is not a legal one. */
  #readEpoch(value: unknown): CacheReceiptEpoch | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const pid = record.pid;
    const ppid = record.ppid;
    const pgid = record.pgid;
    const sid = record.sid;
    const startTicks = record.start_ticks;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
    if (typeof ppid !== "number" || !Number.isInteger(ppid) || ppid < 0) return null;
    if (typeof pgid !== "number" || !Number.isInteger(pgid) || pgid < 0) return null;
    if (typeof sid !== "number" || !Number.isInteger(sid) || sid < 0) return null;
    if (typeof startTicks !== "string" || !/^[0-9]+$/u.test(startTicks)) return null;
    return { pid, ppid, pgid, sid, start_ticks: startTicks };
  }

  /** The identity item of the receipt, or null when it is not a legal one. */
  #readIdentityItem(value: unknown): { epoch: CacheReceiptEpoch; completion: string } | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const epoch = this.#readEpoch(record);
    if (epoch === null) return null;
    const completion = record.completion;
    if (completion !== CACHE_COMPLETION_WAITED
      && completion !== CACHE_COMPLETION_PARENT_REAPED
      && completion !== CACHE_COMPLETION_UNKNOWN) {
      return null;
    }
    return { epoch, completion };
  }

  /** The wait item of the receipt, or null when it is not a legal one. */
  #readWaitItem(value: unknown): CacheReceiptWaitFact | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const pid = record.pid;
    const order = record.order;
    const category = record.category;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
    if (typeof order !== "number" || !Number.isInteger(order) || order <= 0) return null;
    if (category !== "worker" && category !== "adopted") return null;
    const status = record.status;
    if (status === null || typeof status !== "object" || Array.isArray(status)) return null;
    const statusRecord = status as Record<string, unknown>;
    const kind = statusRecord.kind;
    // A TERMINAL status is exited or signaled: stopped, continued and unknown
    // are not the end of a process.
    if (kind !== "exited" && kind !== "signaled") return null;
    if (kind === "exited") {
      const code = statusRecord.code;
      if (typeof code !== "number" || !Number.isInteger(code)) return null;
    } else {
      const signal = statusRecord.signal;
      if (typeof signal !== "string" || !/^[A-Z]+$/u.test(signal)) return null;
    }
    return { pid, kind, epoch: this.#readEpoch(record.epoch), order, category };
  }
}

/**
 * The state of the control channel of ONE draw, as the pump sees it.
 *
 * It is exported for the pure tests of this module: the interpretation of a
 * message is REAL code, and the tests drive it with the frames they build
 * instead of with a copy of it.
 */
export interface CacheControlState {
  /** The sequence number of the last message that was accepted. */
  lastSeq: number;
  /** The receipt, when the summary arrived. */
  receipt: Record<string, unknown> | null;
  /** The sequence number the receipt carried. */
  receiptSeq: number | null;
  /** The segments of the receipt that really arrived. */
  readonly accumulator: CacheReceiptAccumulator;
  /** The failure that the channel produced, when it produced one. */
  failure: { readonly code: string; readonly message: string } | null;
}

/** The state of a control channel that has not read anything yet. */
export function cacheOpenControlState(): CacheControlState {
  return {
    lastSeq: 0,
    receipt: null,
    receiptSeq: null,
    accumulator: new CacheReceiptAccumulator(),
    failure: null,
  };
}

/**
 * The Host-private interpretation of ONE message of the control channel.
 *
 * It is the ACTUAL code of the pump. A message that arrives out of order, a
 * segment that was cut and a segment that does not match its own digest are all
 * refused HERE, and the refusal is a failure of the draw - not a message that
 * is quietly dropped.
 */
export function cacheInterpretControlMessage(
  state: CacheControlState,
  message: Record<string, unknown>,
): { ok: boolean; reason: string | null } {
  const seq = Number(message.seq);
  if (!Number.isInteger(seq) || seq !== state.lastSeq + 1) {
    const reason = `The control channel is out of order: the message ${String(message.seq)} arrived after ${String(state.lastSeq)}`;
    state.failure = { code: "PROTOCOL_UNEXPECTED", message: reason };
    return { ok: false, reason };
  }
  state.lastSeq = seq;
  if (message.kind === "RECEIPT_SEGMENT") {
    // The VERSION of the private receipt: a segment of an older version is
    // refused, and there is no fallback to it.
    if (message.receipt_version !== CACHE_RECEIPT_VERSION) {
      const reason = "the segment of the receipt is not of the version 2 of this protocol";
      state.failure = { code: "PROTOCOL_UNEXPECTED", message: reason };
      return { ok: false, reason };
    }
    if (state.receipt !== null) {
      // The summary is the LAST message of the receipt: a segment that
      // arrives after it is not silently accepted.
      const reason = "a segment of the receipt arrived after the summary";
      state.failure = { code: "PROTOCOL_UNEXPECTED", message: reason };
      return { ok: false, reason };
    }
    const refusal = state.accumulator.take(message);
    if (refusal !== null) {
      state.failure = { code: "RECEIPT_SEGMENT_REFUSED", message: refusal };
      return { ok: false, reason: refusal };
    }
    return { ok: true, reason: null };
  }
  if (message.kind === "DOMAIN_REAPED") {
    if (state.receipt !== null) {
      // A SECOND summary does not replace the first one, and it does not
      // rewrite the facts that are already there.
      const reason = "the custodian sent a second receipt";
      state.failure = { code: "PROTOCOL_UNEXPECTED", message: reason };
      return { ok: false, reason };
    }
    state.receipt = message;
    state.receiptSeq = seq;
  }
  return { ok: true, reason: null };
}

/**
 * The Host-private interpretation of ONE terminal message of the draw.
 *
 * It returns the failure that the message produces, or null when the message is
 * a normal one. The `closed` message of the worker says whether the browser
 * really closed, and a `fatal` says that the worker itself failed: both are
 * failures of the draw, and both are latched.
 */
export function cacheInterpretDrawTerminal(
  message: Record<string, unknown>,
): { readonly code: string; readonly message: string; readonly native_phase: string | null } | null {
  const kind = message.kind;
  if (kind === "closed") {
    if (message.closed === true) return null;
    const envelope = normalizeNativeEnvelope(message.error);
    return {
      code: "WORKER_CLOSE_FAILED",
      message: `The worker could not close what it opened: ${envelope.message}`,
      native_phase: envelope.phase ?? null,
    };
  }
  if (kind === "fatal") {
    const envelope = normalizeNativeEnvelope(message.error);
    return {
      code: "WORKER_FAILED",
      message: `The cache worker failed: ${envelope.message}`,
      native_phase: envelope.phase ?? null,
    };
  }
  return {
    code: "PROTOCOL_UNEXPECTED",
    message: `The draw channel carried an unexpected message: ${String(kind)}`,
    native_phase: null,
  };
}

/**
 * Whether the END of the draw channel is a failure.
 *
 * The end of the draw channel BEFORE the finalisation was authorised means that
 * the worker is gone and that the answer may never be complete: it is a
 * protocol failure, and it is latched. The end AFTER the finalisation is the
 * normal end of the worker.
 */
export function cacheDrawEndFailure(
  finalizeAfterOk: boolean,
): { readonly code: string; readonly message: string } | null {
  if (finalizeAfterOk) return null;
  return {
    code: "DRAW_EOF_BEFORE_FINALIZE",
    message: "The draw channel ended before the finalisation was authorised",
  };
}

/** What a receipt of the custodian has to match. */
export interface CacheReceiptExpectation {
  /** The protocol the receipt has to be of. */
  readonly protocol: string;
  /** The draw the receipt has to be about. */
  readonly draw_id: string;
  /** The ticket of the draw the receipt has to be about. */
  readonly ticket_digest: string;
  /** The sequence number the receipt has to carry. */
  readonly seq: number;
  /** The custodian the receipt has to be about, when it was identified. */
  readonly custodian: CacheProcessEpoch | null;
  /** The worker the receipt has to be about, when it was identified. */
  readonly worker: CacheProcessEpoch | null;
  /** The number of the worker the custodian forked, when it reported one. */
  readonly forked_pid: number | null;
}

/** The whole identity epoch of one process, as the receipt has to carry it. */
export interface CacheProcessEpoch {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly sid: number;
  readonly start_ticks: string;
}

/**
 * The version of the PRIVATE receipt that this Host accepts.
 *
 * There is NO fallback to an older one: a receipt that does not carry it is
 * refused, and the two ends of the protocol are released together.
 */
export const CACHE_RECEIPT_VERSION = 2;

/**
 * The two kinds of proof that a receipt may carry.
 *
 * ``complete-v2``        the complete bounded facts of a draw that really
 *                        ended. It may carry a deliverable result.
 * ``failed-terminal-v1`` the bounded certificate that the resources of a
 *                        FAILED draw really ended. It NEVER delivers a result.
 */
export const CACHE_PROOF_COMPLETE = "complete-v2";
export const CACHE_PROOF_FAILED_TERMINAL = "failed-terminal-v1";

/**
 * The startup kinds of a draw.
 *
 * It is a DISCRIMINANT: the fields that a kind requires are its own, and an
 * unknown kind is refused.
 */
export const CACHE_STARTUP_KINDS = Object.freeze([
  "custodian-unauthed",
  "authorized-fork-failed",
  "forked-setup-failed",
  "forked-exec-succeeded",
]);

/**
 * Check the FAILED TERMINAL proof of a receipt: the resources of a draw that
 * FAILED really ended.
 *
 * It is a proof of the END of the resources and NEVER of a deliverable
 * result: the creative eligibility of such a receipt is false, and the Host
 * may not deliver an image because of it.
 *
 * The certificate is bound to the SAME custodian, the SAME worker and the
 * SAME draw, and it carries the facts of the ROOT OWNERSHIP: the subreaper
 * was confirmed before the fork, this program is the only wait owner, the
 * worker was really waited for, the ECHILD was really seen after that wait,
 * the original group really ended and every retained epoch really is gone.
 */
export function validateCacheFailedTerminalReceipt(
  receipt: Record<string, unknown>,
  expected: CacheReceiptExpectation,
  accumulated: CacheReceiptAccumulatorState | null = null,
): { ok: boolean; reason: string | null } {
  const facts = receipt as Record<string, unknown>;
  const refuse = (reason: string): { ok: boolean; reason: string | null } => ({ ok: false, reason });
  // The CREATIVE eligibility of a failed terminal proof is false, and it may
  // not be missing: a receipt that does not say it may not be used at all.
  if (facts.creative_eligible !== false) {
    return refuse("the failed terminal receipt does not refuse the creative result");
  }
  const failure = facts.failure;
  if (failure === null || failure === undefined || typeof failure !== "object" || Array.isArray(failure)) {
    return refuse("the failed terminal receipt carries no failure");
  }
  const failureRecord = failure as Record<string, unknown>;
  if (typeof failureRecord.code !== "string" || failureRecord.code.length === 0
    || failureRecord.code.length > 64) {
    return refuse("the failure of the failed terminal receipt carries no code");
  }
  if (typeof failureRecord.message !== "string" || failureRecord.message.length > 1024) {
    return refuse("the failure of the failed terminal receipt carries no message");
  }
  const certificate = facts.failed_terminal;
  if (certificate === null || certificate === undefined
    || typeof certificate !== "object" || Array.isArray(certificate)) {
    return refuse("the failed terminal receipt carries no certificate");
  }
  const proof = certificate as Record<string, unknown>;
  if (proof.version !== 1) {
    return refuse("the certificate is not of the version 1");
  }
  if (proof.root_scope !== "sole-custodian-subtree") {
    return refuse("the certificate does not name the root scope it proves");
  }
  if (proof.subreaper_before_fork !== true) {
    return refuse("the certificate does not claim the subreaper of the fork");
  }
  if (proof.sole_wait_owner !== true) {
    return refuse("the certificate does not claim the sole wait ownership");
  }
  if (proof.no_new_fork_after_termination !== true) {
    return refuse("the certificate does not claim that no fork followed");
  }
  if (proof.resource_proof_complete !== true) {
    return refuse("the certificate does not prove the end of the resources");
  }
  if (proof.retained_epochs_gone !== true) {
    return refuse("the certificate does not claim that the retained epochs are gone");
  }
  if (proof.original_group_state !== "gone" && proof.original_group_state !== "not-established") {
    return refuse("the certificate does not name a state of the original group");
  }
  if (proof.authority_revoked !== true && proof.authority_revoked !== false) {
    return refuse("the certificate does not say whether the authority was revoked");
  }
  if (proof.anchor_preserved_until_worker_wait !== true
    && proof.anchor_preserved_until_worker_wait !== false) {
    return refuse("the certificate does not say whether the anchor was held");
  }
  if (proof.worker_wait_was_last !== true && proof.worker_wait_was_last !== false) {
    return refuse("the certificate does not say whether the worker was the last wait");
  }
  const postWorkerWaits = proof.post_worker_wait_count;
  if (typeof postWorkerWaits !== "number" || !Number.isInteger(postWorkerWaits) || postWorkerWaits < 0) {
    return refuse("the certificate does not count the waits that came after the worker");
  }
  // The WORKER wait of the certificate, and the ECHILD that came after it.
  const workerWait = proof.worker_wait;
  if (expected.forked_pid !== null) {
    if (workerWait === null || workerWait === undefined || typeof workerWait !== "object"
      || Array.isArray(workerWait)) {
      return refuse("the certificate carries no wait of the worker");
    }
    const wait = workerWait as Record<string, unknown>;
    if (typeof wait.pid !== "number" || !Number.isInteger(wait.pid) || wait.pid !== expected.forked_pid) {
      return refuse("the certificate waits for another worker");
    }
    if (typeof wait.order !== "number" || !Number.isInteger(wait.order) || wait.order <= 0) {
      return refuse("the certificate carries no order of the wait");
    }
    if (wait.category !== "worker") {
      return refuse("the certificate does not name the wait of the worker");
    }
    const waitStatus = wait.status;
    if (waitStatus === null || waitStatus === undefined
      || typeof waitStatus !== "object" || Array.isArray(waitStatus)) {
      return refuse("the wait of the certificate carries no status");
    }
    const waitKind = (waitStatus as Record<string, unknown>).kind;
    if (waitKind !== "exited" && waitKind !== "signaled") {
      return refuse("the wait of the certificate is not a terminal one");
    }
    if (proof.post_worker_echild !== true) {
      return refuse("the certificate does not claim the ECHILD after the worker");
    }
    const echildOrdinal = proof.echild_after_wait_ordinal;
    if (typeof echildOrdinal !== "number" || !Number.isInteger(echildOrdinal)) {
      return refuse("the certificate carries no ordinal of the ECHILD");
    }
    if (echildOrdinal < Number(wait.order)) {
      return refuse("the ECHILD of the certificate came before the wait of the worker");
    }
    if (accumulated !== null) {
      // The wait of the certificate must be a wait that REALLY arrived, and
      // the ECHILD must come after the LAST wait that really happened.
      const real = accumulated.worker_wait;
      if (real === null || real.pid !== expected.forked_pid || real.order !== Number(wait.order)) {
        return refuse("the certificate claims a wait of the worker that never arrived");
      }
      if (accumulated.last_wait_order !== echildOrdinal) {
        return refuse("the ECHILD of the certificate did not come after the last wait");
      }
    }
  } else if (workerWait !== null) {
    return refuse("the certificate waits for a worker that was never forked");
  }
  // The BINDING of the certificate: the same custodian and the same worker.
  const custodianEpoch = proof.custodian_epoch;
  if (expected.custodian !== null) {
    if (custodianEpoch === null || custodianEpoch === undefined
      || typeof custodianEpoch !== "object" || Array.isArray(custodianEpoch)) {
      return refuse("the certificate names no custodian");
    }
    const epoch = custodianEpoch as Record<string, unknown>;
    if (typeof epoch.pid !== "number" || epoch.pid !== expected.custodian.pid) {
      return refuse("the certificate is about another custodian");
    }
    if (typeof epoch.start_ticks !== "string" || epoch.start_ticks !== expected.custodian.start_ticks) {
      return refuse("the certificate names another custodian epoch");
    }
    if (typeof epoch.pgid !== "number" || epoch.pgid !== expected.custodian.pgid) {
      return refuse("the certificate names another custodian group");
    }
    if (typeof epoch.sid !== "number" || epoch.sid !== expected.custodian.sid) {
      return refuse("the certificate names another custodian session");
    }
    if (typeof epoch.ppid !== "number" || epoch.ppid !== expected.custodian.ppid) {
      return refuse("the certificate names another custodian parent");
    }
  }
  const workerEpoch = proof.worker_epoch;
  if (expected.worker !== null) {
    if (workerEpoch === null || workerEpoch === undefined
      || typeof workerEpoch !== "object" || Array.isArray(workerEpoch)) {
      return refuse("the certificate names no worker epoch");
    }
    const epoch = workerEpoch as Record<string, unknown>;
    if (typeof epoch.start_ticks !== "string" || epoch.start_ticks !== expected.worker.start_ticks) {
      return refuse("the certificate names another worker epoch");
    }
    if (typeof epoch.pid !== "number" || epoch.pid !== expected.worker.pid) {
      return refuse("the certificate names another worker");
    }
  }
  // The forked pid of the certificate, when there is one.
  const forkedPid = proof.forked_pid;
  if (expected.forked_pid !== null) {
    if (typeof forkedPid !== "number" || forkedPid !== expected.forked_pid) {
      return refuse("the certificate names another forked worker");
    }
  }
  // The STREAMS of the certificate: they are the facts of the whole life of
  // the worker, and every one of them has to be there.
  const streams = proof.stream_disposition;
  if (streams === null || streams === undefined || typeof streams !== "object" || Array.isArray(streams)) {
    return refuse("the certificate carries no facts of the streams");
  }
  for (const name of ["stdout", "stderr"] as const) {
    const stream = (streams as Record<string, unknown>)[name];
    if (stream === null || stream === undefined || typeof stream !== "object" || Array.isArray(stream)) {
      return refuse(`the certificate carries no facts of the ${name} stream`);
    }
    const record = stream as Record<string, unknown>;
    if (record.ownership !== "not-opened" && record.ownership !== "acquired") {
      return refuse(`the certificate does not name the ownership of the ${name} stream`);
    }
    if (typeof record.bytes !== "number" || !Number.isInteger(record.bytes) || record.bytes < 0) {
      return refuse(`the certificate does not count the bytes of the ${name} stream`);
    }
    if (typeof record.tail_bytes !== "number" || !Number.isInteger(record.tail_bytes) || record.tail_bytes < 0) {
      return refuse(`the certificate does not count the tail of the ${name} stream`);
    }
    if (record.eof !== true && record.eof !== false) {
      return refuse(`the certificate does not say whether the ${name} stream ended`);
    }
    if (record.read_error !== null && record.read_error !== undefined) {
      return refuse(`the certificate carries a read error of the ${name} stream`);
    }
    if (record.disposition !== "not-opened" && record.disposition !== "never-inherited-and-closed"
      && record.disposition !== "eof" && record.disposition !== "read-failed-and-reader-closed"
      && record.disposition !== "acquired") {
      return refuse(`the certificate does not name the disposition of the ${name} stream`);
    }
  }
  // The LIFETIME of the certificate: the counts, the digests and the fact
  // that the transcript is NOT complete - a failed terminal proof never
  // claims a complete transcript.
  const lifetime = proof.lifetime;
  if (lifetime === null || lifetime === undefined || typeof lifetime !== "object" || Array.isArray(lifetime)) {
    return refuse("the certificate carries no lifetime");
  }
  const span = lifetime as Record<string, unknown>;
  for (const field of ["events", "waits", "identities"]) {
    const count = span[field];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      return refuse(`the certificate does not count the ${field} of the lifetime`);
    }
  }
  for (const field of ["events_digest", "waits_digest", "identities_digest"]) {
    const digest = span[field];
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest)) {
      return refuse(`the certificate does not carry the digest of the ${field}`);
    }
  }
  if (span.events_truncated !== true && span.events_truncated !== false) {
    return refuse("the certificate does not say whether the events were cut");
  }
  if (span.identity_overflow !== true && span.identity_overflow !== false) {
    return refuse("the certificate does not say whether the identities overflowed");
  }
  if (span.transcript_complete !== false) {
    return refuse("the certificate claims a complete transcript");
  }
  return { ok: true, reason: null };
}

/**
 * Check the DOMAIN proof of a receipt: the domain of the draw is really gone.
 *
 * This is the proof that the run and the reconcile share, and it says NOTHING
 * about whether the draw succeeded: the resources of a draw may really end
 * while the draw itself failed, and the two facts are separate.
 */
export function validateCacheDomainReceipt(
  receipt: Record<string, unknown> | null,
  expected: CacheReceiptExpectation,
  accumulated: CacheReceiptAccumulatorState | null,
): { ok: boolean; reason: string | null } {
  if (receipt === null) return { ok: false, reason: "the custodian sent no receipt" };
  if (receipt.kind !== "DOMAIN_REAPED") {
    return { ok: false, reason: "the message of the custodian is not a receipt" };
  }
  if (receipt.protocol !== expected.protocol) {
    return { ok: false, reason: "the receipt is of another protocol" };
  }
  if (receipt.draw_id !== expected.draw_id) {
    return { ok: false, reason: "the receipt is about another draw" };
  }
  if (receipt.ticket_digest !== expected.ticket_digest) {
    return { ok: false, reason: "the receipt is about another request" };
  }
  if (!Number.isInteger(Number(receipt.seq)) || Number(receipt.seq) !== expected.seq) {
    return { ok: false, reason: "the receipt does not carry the expected sequence number" };
  }
  if (receipt.outcome !== "reaped") {
    return { ok: false, reason: "the receipt does not claim a reaped domain" };
  }
  // The SEGMENTS and the summary have to agree: the totals and the digests of
  // the summary are the ones of the segments that really arrived.
  if (accumulated === null) {
    return { ok: false, reason: "the receipt arrived without a single segment" };
  }
  // The IMMUTABLE binding of the segments: it is the binding of the receipt,
  // and the summary of another draw may not describe these segments.
  if (accumulated.protocol !== null && accumulated.protocol !== receipt.protocol) {
    return { ok: false, reason: "the receipt describes another protocol" };
  }
  if (accumulated.draw_id !== null && accumulated.draw_id !== receipt.draw_id) {
    return { ok: false, reason: "the receipt describes another draw" };
  }
  if (accumulated.ticket_digest !== null && accumulated.ticket_digest !== receipt.ticket_digest) {
    return { ok: false, reason: "the receipt describes another request" };
  }
  if (Number(receipt.segments) !== accumulated.segments) {
    return { ok: false, reason: "the receipt does not carry the segments that arrived" };
  }
  if (accumulated.received !== accumulated.segments) {
    // A segment that never arrived is a receipt that was CUT, whatever the
    // summary says about it.
    return { ok: false, reason: "a segment of the receipt never arrived" };
  }
  if (Number(receipt.events_count) !== accumulated.events) {
    return { ok: false, reason: "the chain of events of the receipt was cut" };
  }
  if (receipt.events_digest !== accumulated.events_digest) {
    return { ok: false, reason: "the chain of events of the receipt does not match its digest" };
  }
  if (Number(receipt.waits_count) !== accumulated.waits) {
    return { ok: false, reason: "the waits of the receipt were cut" };
  }
  if (receipt.waits_digest !== accumulated.waits_digest) {
    return { ok: false, reason: "the waits of the receipt do not match their digest" };
  }
  if (Number(receipt.identities_count) !== accumulated.identities) {
    return { ok: false, reason: "the identities of the receipt were cut" };
  }
  if (receipt.identities_digest !== accumulated.identities_digest) {
    return { ok: false, reason: "the identities of the receipt do not match their digest" };
  }
  // The WAITS are the transcript of the reap. A draw that forked a worker has
  // at least the wait of the worker itself: an empty list is not a proof.
  if (expected.forked_pid !== null && accumulated.waits < 1) {
    return { ok: false, reason: "the receipt carries no wait at all" };
  }
  // The EXEC of the worker is part of the proof: a worker that never execed is
  // not a worker.
  //
  // A worker that really FAILED to exec is a different fact: the draw failed,
  // and the question is whether the resources really ended. That is answered by
  // the TERMINAL WAIT of the failed worker itself - not by a count of waits,
  // and not by some other wait of the receipt. A failed exec may NEVER be a
  // success: the ELIGIBILITY asks about that, and it says no.
  const exec = receipt.exec as { ok?: unknown } | null | undefined;
  if (expected.forked_pid !== null && (exec === null || exec === undefined || exec.ok !== true)) {
    if (exec === null || exec === undefined || exec.ok !== false) {
      return { ok: false, reason: "the receipt does not claim a successful exec" };
    }
    if (accumulated === null) {
      return { ok: false, reason: "the receipt arrived without a single segment" };
    }
    const terminalWait = accumulated.worker_wait;
    if (terminalWait === null
      || terminalWait.pid !== expected.forked_pid
      || (terminalWait.kind !== "exited" && terminalWait.kind !== "signaled")) {
      return { ok: false, reason: "the receipt does not carry the terminal wait of the failed worker" };
    }
  }
  // The VERSION of the private receipt: a receipt of an older version is
  // refused, and there is no fallback to it.
  if (receipt.receipt_version !== CACHE_RECEIPT_VERSION) {
    return { ok: false, reason: "the receipt is not of the version 2 of this protocol" };
  }
  // The KIND of the proof is a discriminant: an unknown one is refused, and
  // the two kinds are checked by their own rules.
  const proofKind = receipt.proof_kind;
  if (proofKind === CACHE_PROOF_FAILED_TERMINAL) {
    return validateCacheFailedTerminalReceipt(receipt, expected, accumulated);
  }
  if (proofKind !== CACHE_PROOF_COMPLETE) {
    return { ok: false, reason: "the receipt does not name a kind of proof" };
  }
  // The STARTUP kind is a discriminant as well, and its own fields are
  // required: a missing field is not a null one.
  const startupKind = receipt.startup_kind;
  if (typeof startupKind !== "string" || !CACHE_STARTUP_KINDS.includes(startupKind)) {
    return { ok: false, reason: "the receipt does not name a startup kind" };
  }
  if (startupKind === "authorized-fork-failed") {
    if (receipt.fork_attempt_state !== "failed-no-child") {
      return { ok: false, reason: "the receipt does not name a failed fork attempt" };
    }
    const forkErrno = receipt.fork_errno;
    if (!Number.isInteger(forkErrno) || Number(forkErrno) <= 0) {
      return { ok: false, reason: "the receipt carries no errno of the failed fork" };
    }
    if (receipt.forked_pid !== null) {
      return { ok: false, reason: "the receipt names a worker that was never forked" };
    }
    if (receipt.group_disposition !== "not-established") {
      return { ok: false, reason: "the receipt does not say that the group was never established" };
    }
  } else if (startupKind === "forked-exec-succeeded" || startupKind === "forked-setup-failed") {
    if (receipt.fork_attempt_state !== "born") {
      return { ok: false, reason: "the receipt does not name a born worker" };
    }
    const forkedPid = receipt.forked_pid;
    if (!Number.isInteger(forkedPid) || Number(forkedPid) <= 0) {
      return { ok: false, reason: "the receipt carries no number of the worker" };
    }
    if (receipt.group_disposition !== "established-gone" && receipt.group_disposition !== "unknown") {
      return { ok: false, reason: "the receipt does not name a disposition of the group" };
    }
    if (startupKind === "forked-exec-succeeded" && receipt.worker_wait === null) {
      return { ok: false, reason: "the receipt carries no wait of the worker" };
    }
  }
  // The wait of the WORKER has a slot of its own: it is never lost to the
  // bound of the retained facts, and it is the ONLY wait that proves that the
  // worker of the draw really ended.
  const workerWait = accumulated.worker_wait;
  if (expected.forked_pid !== null) {
    if (workerWait === null || workerWait.pid !== expected.forked_pid) {
      return { ok: false, reason: "the receipt carries no wait of the worker" };
    }
    if (workerWait.kind !== "exited" && workerWait.kind !== "signaled") {
      return { ok: false, reason: "the wait of the worker is not a terminal one" };
    }
    if (accumulated.last_wait_order !== workerWait.order) {
      // The worker was NOT the last one that was waited for: the complete
      // proof of a result is refused, and the FAILED proof still holds.
      return { ok: false, reason: "the worker was not the last process that was waited for" };
    }
  }
  if (receipt.echild !== true) return { ok: false, reason: "the receipt does not claim ECHILD" };
  if (receipt.group_esrch !== true) return { ok: false, reason: "the receipt does not claim a gone group" };
  if (receipt.known_ids_gone !== true) {
    return { ok: false, reason: "the receipt does not claim that the known identities are gone" };
  }
  if (receipt.events_truncated === true) return { ok: false, reason: "the events of the receipt were cut" };
  if (receipt.identity_overflow === true) {
    return { ok: false, reason: "the identities of the draw did not fit" };
  }
  if (receipt.anchor_retained !== true && expected.forked_pid !== null) {
    return { ok: false, reason: "the receipt does not claim that the anchor of the worker was held" };
  }
  // The whole EPOCH of the custodian and of the worker, not only their numbers.
  const custodian = receipt.custodian;
  if (custodian === null || typeof custodian !== "object") {
    return { ok: false, reason: "the receipt names no custodian" };
  }
  const custodianFacts = custodian as Record<string, unknown>;
  if (expected.custodian !== null) {
    if (Number(custodianFacts.pid) !== expected.custodian.pid) {
      return { ok: false, reason: "the receipt is about another custodian" };
    }
    if (String(custodianFacts.start_ticks) !== expected.custodian.start_ticks) {
      return { ok: false, reason: "the custodian of the receipt is another process" };
    }
    if (Number(custodianFacts.pgid) !== expected.custodian.pgid) {
      return { ok: false, reason: "the custodian of the receipt is in another group" };
    }
    if (Number(custodianFacts.sid) !== expected.custodian.sid) {
      return { ok: false, reason: "the custodian of the receipt is in another session" };
    }
    if (Number(custodianFacts.ppid) !== expected.custodian.ppid) {
      return { ok: false, reason: "the custodian of the receipt has another parent" };
    }
  }
  const worker = receipt.worker;
  if (worker === null || typeof worker !== "object") {
    return { ok: false, reason: "the receipt names no worker" };
  }
  const workerFacts = worker as Record<string, unknown>;
  if (expected.forked_pid !== null && Number(workerFacts.ppid) !== expected.custodian?.pid) {
    return { ok: false, reason: "the worker of the receipt is not a child of the custodian" };
  }
  if (expected.forked_pid !== null && Number(workerFacts.pid) !== expected.forked_pid) {
    return { ok: false, reason: "the receipt is about another worker" };
  }
  if (expected.worker !== null) {
    if (String(workerFacts.start_ticks) !== expected.worker.start_ticks) {
      return { ok: false, reason: "the worker of the receipt is another process" };
    }
    if (Number(workerFacts.pgid) !== expected.worker.pgid) {
      return { ok: false, reason: "the worker of the receipt is in another group" };
    }
    if (Number(workerFacts.sid) !== expected.worker.sid) {
      return { ok: false, reason: "the worker of the receipt is in another session" };
    }
  }
  return { ok: true, reason: null };
}

/**
 * Check the FULL proof of a receipt: the domain is gone AND the draw may be
 * delivered.
 *
 * The two are separate on purpose. The resources of a draw may really end
 * while the draw itself failed - a flood of the worker, a protocol error, an
 * exec that did not work - and such a draw is a FAILURE whose cleanup really
 * ended. It is never a success, and it is never held for ever.
 */
export function validateCacheExecutionReceipt(
  receipt: Record<string, unknown> | null,
  expected: CacheReceiptExpectation,
  accumulated: CacheReceiptAccumulatorState | null,
  limits: { readonly stdoutBytes: number; readonly stderrBytes: number } = {
    stdoutBytes: CACHE_DRAW_LIMITS.stdoutBytes,
    stderrBytes: CACHE_DRAW_LIMITS.stderrBytes,
  },
): { ok: boolean; reason: string | null } {
  const domain = validateCacheDomainReceipt(receipt, expected, accumulated);
  if (!domain.ok) return domain;
  const facts = receipt as Record<string, unknown>;
  // A FAILED TERMINAL proof NEVER delivers a result: the resources of the
  // draw really ended, and the draw really failed. The two facts are
  // separate, and the second one is not turned into the first one.
  if (facts.proof_kind === CACHE_PROOF_FAILED_TERMINAL) {
    return { ok: false, reason: "the receipt is a failed terminal proof: it never delivers a result" };
  }
  // The CREATIVE eligibility is a REQUIRED fact of a complete proof: it may
  // not be missing and it may not be of another type.
  if (facts.creative_eligible !== true) {
    return { ok: false, reason: "the receipt does not claim that its result may be delivered" };
  }
  // A worker that did not really exec is NEVER a success - not even when the
  // domain of the draw really ended. The two facts are separate.
  const exec = facts.exec as { ok?: unknown } | null | undefined;
  if (exec === null || exec === undefined || exec.ok !== true) {
    return { ok: false, reason: "the receipt does not claim a successful exec" };
  }
  if (facts.diagnostics_lost === true) {
    return { ok: false, reason: "the diagnostics of the draw were lost" };
  }
  if (Number(facts.stdout_bytes) > limits.stdoutBytes) {
    return { ok: false, reason: "the worker wrote more on its standard output than it may" };
  }
  if (Number(facts.stderr_bytes) > limits.stderrBytes) {
    return { ok: false, reason: "the worker wrote more on its standard error than it may" };
  }
  if (facts.failure !== null && facts.failure !== undefined) {
    return { ok: false, reason: "the custodian reported a failure of its own" };
  }
  if (facts.state === "recovery_held") {
    return { ok: false, reason: "the custodian is still holding the responsibility" };
  }
  return { ok: true, reason: null };
}

/**
 * The outcome of a draw, after ONE more thing went wrong.
 *
 * This is the latch of the draw, as a pure rule:
 *
 *  - a FAILURE latches: the first failure is the outcome, and nothing that
 *    comes later may replace it - not a candidate, not a cleanup failure;
 *  - a CANDIDATE does not latch against a failure: a candidate that arrived,
 *    and a fatal error that came AFTER it, still ends as the failure. The
 *    candidate was never more than a candidate.
 */
export function latchCacheOutcome(
  current: CacheLatchedOutcome,
  code: string,
  message: string,
  nativePhase: string | null = null,
): CacheLatchedOutcome {
  if (current.kind === "failure") return current;
  return { kind: "failure", code, message, native_phase: nativePhase };
}

/**
 * The cleanup causes of a draw, after ONE more cause was found.
 *
 * The causes are COPIED before they are walked, and they are de-duplicated: the
 * array that is written to may be the very array that is being read, and an
 * array that grows while it is walked never ends.
 */
export function collectCacheCleanupCauses(
  existing: readonly unknown[],
  failures: readonly unknown[],
): { causes: unknown[]; truncated: boolean } {
  const causes = [...existing];
  const seen = new Set<unknown>(causes);
  let truncated = false;
  for (const failure of [...failures]) {
    if (seen.has(failure)) continue;
    seen.add(failure);
    if (causes.length >= MAX_CLEANUP_FAILURES) {
      truncated = true;
      break;
    }
    causes.push(failure);
  }
  return { causes, truncated };
}

/**
 * ONE deadline of a phase of a draw.
 *
 * The startup chain has ONE of these, and it is never restarted: a step that
 * takes its time spends the budget of the chain, and not a budget of its own.
 */
export class CacheDeadline {
  /** The moment the deadline is over, in milliseconds since the epoch. */
  readonly atMs: number;

  constructor(atMs: number) {
    this.atMs = atMs;
  }

  /** How much of the budget is left. It is never negative. */
  remaining(nowMs: number): number {
    return Math.max(0, this.atMs - nowMs);
  }

  /** Whether the budget is spent. */
  expired(nowMs: number): boolean {
    return nowMs >= this.atMs;
  }
}

/** The digest of the bytes of a buffer. */
const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Wait for this many milliseconds. */
const delay = (ms: number): Promise<void> => new Promise((resolveWait) => {
  const timer = setTimeout(resolveWait, ms);
  timer.unref?.();
});

/**
 * An incremental, BOUNDED decoder of one private channel.
 *
 * The header is read before the payload is accepted, and the unconsumed bytes
 * never exceed the limit of the channel - on EVERY arrival, not only when
 * somebody waits: a channel that nobody reads may not grow without a limit.
 *
 * The decoder does NOT decide which frame may come next: the caller knows the
 * protocol phase, and the phase limit is checked when the frame is taken. That
 * matters because the frames of one phase and the frames of the next may arrive
 * in the SAME read: a picture and the metadata in front of it may be one chunk,
 * and a decoder that refused the chunk because the metadata phase was over
 * would refuse a legal answer.
 */
export class CacheChannelDecoder {
  #buffer: Buffer = Buffer.alloc(0);
  readonly #maxBuffer: number;
  #failed: string | null = null;

  constructor(maxBuffer: number) {
    this.#maxBuffer = maxBuffer;
  }

  /** The failure of the channel, when there was one. */
  get failure(): string | null {
    return this.#failed;
  }

  /** How many bytes are waiting to be consumed. */
  get buffered(): number {
    return this.#buffer.length;
  }

  /**
   * Take these bytes and give back the frames that are complete.
   *
   * A frame that claims more than the channel may ever hold is refused here: it
   * is never truncated and accepted.
   */
  feed(data: Buffer): Buffer[] {
    if (this.#failed !== null) return [];
    this.#buffer = this.#buffer.length === 0 ? data : Buffer.concat([this.#buffer, data]);
    if (this.#buffer.length > this.#maxBuffer) {
      this.#failed = "the unconsumed bytes of the channel exceed the limit";
      throw new CacheDrawError("CHANNEL_BUFFER_OVERFLOW", this.#failed);
    }
    const frames: Buffer[] = [];
    for (;;) {
      if (this.#buffer.length < 4) break;
      const length = this.#buffer.readUInt32BE(0);
      if (length + 4 > this.#maxBuffer) {
        this.#failed = "a frame of the private channel is too large";
        throw new CacheDrawError("CHANNEL_FRAME_TOO_LARGE", this.#failed);
      }
      if (this.#buffer.length < 4 + length) break;
      frames.push(this.#buffer.subarray(4, 4 + length));
      this.#buffer = this.#buffer.subarray(4 + length);
    }
    return frames;
  }
}

/**
 * A queue of decoded frames that may not grow without a limit.
 *
 * The DECODER bounds the bytes that wait to be decoded; this bounds the frames
 * that were decoded and wait to be READ. A channel nobody reads may not fill
 * the memory of the Host, and a legal answer - a picture of eight megabytes and
 * the metadata in front of it - still fits.
 */
export class CacheFrameQueue<T> {
  readonly #items: T[] = [];
  #bytes = 0;
  readonly #maxFrames: number;
  readonly #maxBytes: number;
  readonly #sizeOf: (item: T) => number;

  constructor(maxFrames: number, maxBytes: number, sizeOf: (item: T) => number) {
    this.#maxFrames = maxFrames;
    this.#maxBytes = maxBytes;
    this.#sizeOf = sizeOf;
  }

  /** How many frames are waiting. */
  get length(): number {
    return this.#items.length;
  }

  /** How many bytes are waiting. */
  get bytes(): number {
    return this.#bytes;
  }

  /** Whether the queue is full and may not take another frame. */
  get full(): boolean {
    return this.#items.length >= this.#maxFrames || this.#bytes >= this.#maxBytes;
  }

  /** Take one frame, or undefined when there is none. */
  shift(): T | undefined {
    const item = this.#items.shift();
    if (item === undefined) return undefined;
    this.#bytes -= this.#sizeOf(item);
    return item;
  }

  /** Put one frame on the queue, if it fits. */
  push(item: T): boolean {
    const size = this.#sizeOf(item);
    if (this.#items.length >= this.#maxFrames || this.#bytes + size > this.#maxBytes) return false;
    this.#items.push(item);
    this.#bytes += size;
    return true;
  }

  /** Throw the queue away. */
  clear(): void {
    this.#items.length = 0;
    this.#bytes = 0;
  }
}

/** The private facts of one draw. Only this module writes here. */
interface DrawFacts {
  /** The supervisor that issued this draw. A handle of another one is foreign. */
  readonly issuer: CacheProcessSupervisor;
  readonly handle: CacheDrawHandle;
  readonly request: CacheDrawRequest;
  /** The ticket of the draw. It travels over the private channel and nowhere else. */
  readonly ticket: string;
  /** The digest of the ticket, so an answer can be tied to its request. */
  readonly ticketDigest: string;
  /** The short name of the draw, as it travels over the control channel. */
  readonly drawId: string;
  phase: CacheDrawPhase;
  candidateDigest: string | null;
  picture: Buffer | null;
  error: unknown;
  cleanup: unknown[];
  cleanupRequired: boolean;
  /** The cleanup failures did not fit: the draw may not be proven gone. */
  cleanupTruncated: boolean;
  settled: boolean;
  /** The outcome that was latched: the FIRST thing that went wrong. */
  latched: CacheLatchedOutcome;
  /** The run has handed the settlement over: a reconcile may finish it. */
  settlementHandedOver: boolean;
  child: ChildProcess | undefined;
  custodian: CacheProcessIdentity | null;
  worker: CacheProcessIdentity | null;
  /** The identities of the members of the group that were seen alive. */
  readonly recorded: Map<number, number>;
  members: CacheProcessIdentity[];
  /** Whether the finalisation was recorded BEFORE it was asked for. */
  finalizeAfterOk: boolean;
  /** The digest of the candidate that was finalised. */
  finalizedDigest: string | null;
  /** What was really observed about the end of the worker. */
  observedSignals: string[];
  /**
   * The state of the control channel: the sequence numbers, the segments that
   * really arrived and the receipt.
   *
   * It is ONE object and not four fields: the interpretation of a message is
   * real code, and it is the same code in the pump and in the pure tests.
   */
  readonly control: CacheControlState;
  /** The custodian really closed. */
  custodianClosed: boolean;
  /** How the custodian really ended. */
  custodianExit: { code: number | null; signal: NodeJS.Signals | null } | null;
  /** The promise that settles when the custodian really closed. */
  closed: Promise<void> | null;
  /** The fork was authorised: a worker MAY exist, even without a hello. */
  authorizeSent: boolean;
  /** The custodian reported that it forked a worker. */
  forked: boolean;
  /** The number of the worker the custodian forked. */
  forkedPid: number | null;
  /** The cancel was already sent to the custodian. */
  cancelSent: boolean;
  /** The private run directory of this draw. */
  runDirectory: string | null;
  /** The candidate was accepted: the terminal messages of the draw count now. */
  afterCandidate: boolean;
  /** The original failure of the transport, as a bounded envelope. */
  transportFailure: CacheNativeErrorEnvelope | null;
  /** The custodian was born: it has a number and it may still be running. */
  custodianBorn: boolean;
  /**
   * The epoch of the custodian as it was RIGHT AFTER the start.
   *
   * It is the proof of the ORIGINAL process: a number that was reused later is
   * not the custodian of this draw, and a custodian that is really gone is not
   * the one that is still there.
   */
  custodianEpoch: CacheProcessIdentity | null;
  /**
   * The epoch of the custodian as the CUSTODIAN stated it in its hello.
   *
   * It is the CONSERVATIVE source of the original identity of the custodian
   * when the observation of the start was unknown: the hello is only accepted
   * when it matches the kernel, and it is never replaced by a later
   * observation.
   */
  custodianHelloEpoch: CacheProcessEpoch | null;
  /**
   * The provenance of the cancel of the owner.
   *
   * It says WHICH error the owner asked to cancel with, and whether that
   * cancel became the PRIMARY outcome of the draw. It is written ONCE: a later
   * cancel never rewrites it.
   */
  cancelProvenance: CacheCancelProvenance | null;
  /** The later cancels of the owner: a COUNT and the last request. */
  cancelSecondary: CacheCancelSecondary | null;
  /**
   * The ACTUAL observations of the last terminal proof of the draw.
   *
   * They are copied from the proof path itself: the presence that the kernel
   * reported, the epoch it carried and the moment it was observed. They are
   * never made up by a reader.
   */
  terminalObservations: CacheTerminalProofObservation[];
  /** The observations did not fit and were cut. */
  terminalObservationsTruncated: boolean;
  /** When the last terminal proof ran. */
  terminalProofAt: number | null;
  /** Whether the last terminal proof succeeded. */
  terminalProven: boolean;
  /** The owner asked for the draw to stop before it was started. */
  cancelRequested: boolean;
  /** The exec of the worker really succeeded. */
  execOk: boolean | null;
  readonly resolve: (settlement: CacheDrawSettlement) => void;
  /** The settlement is already handed out: it may not be settled twice. */
  settleCalled: boolean;
}

/** The private facts of every draw this module issued. */
const drawFacts = new WeakMap<object, DrawFacts>();

/** The options of the supervisor. Every one of them is a composition-time fact. */
export interface CacheProcessSupervisorOptions {
  /** The pinned upstream tree the worker loads the producer from. */
  readonly vendorRoot: string;
  /** The producer, relative to the upstream tree. */
  readonly producerFile: string;
  /** The digest of the producer, as the pinned lock records it. */
  readonly producerSha256: string;
  /** The worker of the draw. Its path is fixed; it is never taken from a request. */
  readonly workerPath: string;
  /** The custodian of the draw. Its path is fixed; it is never taken from a request. */
  readonly custodianPath: string;
  /** The interpreter the custodian runs under. Its path is fixed and verified. */
  readonly pythonExecutable: string;
  /** The scope this draw belongs to, when it belongs to one. */
  readonly scope?: CacheProductionScope | undefined;
  /** The bounds of the draw. */
  /**
   * The bounds of the draw, when they are not the default ones.
   *
   * The type is the NUMERIC one of every bound: the limits are action
   * deadlines, and a case that shortens them shortens the ACTION and never
   * the responsibility.
   */
  readonly limits?: Partial<{ readonly [K in keyof typeof CACHE_DRAW_LIMITS]: number }> | undefined;
}

/**
 * The supervisor of the native cache workers of one Host.
 *
 * There is ONE of them per Host process, and the scope scheduler is the only other
 * thing that decides how many productions may run.
 */
export class CacheProcessSupervisor {
  readonly #options: CacheProcessSupervisorOptions;
  readonly #limits: { readonly [K in keyof typeof CACHE_DRAW_LIMITS]: number };

  constructor(options: CacheProcessSupervisorOptions) {
    this.#options = options;
    this.#limits = { ...CACHE_DRAW_LIMITS, ...(options.limits ?? {}) };
  }

  /** The scope this supervisor's draws belong to, when it was given one. */
  get scope(): CacheProductionScope | undefined {
    return this.#options.scope;
  }

  /**
   * Register the responsibility of ONE draw, BEFORE anything is born.
   *
   * The handle is signed by THIS instance. The registration is what makes a
   * failure between the reservation and the spawn a draw this supervisor is
   * accountable for: the handle exists, and it settles exactly once.
   */
  reserve(request: CacheDrawRequest): CacheDrawHandle {
    const ticket = randomBytes(32).toString("hex");
    const ticketDigest = sha256Of(Buffer.from(ticket, "utf8"));
    let resolveSettlement!: (settlement: CacheDrawSettlement) => void;
    const settlement = new Promise<CacheDrawSettlement>((resolveOne) => {
      resolveSettlement = resolveOne;
    });
    // The facts come first: the handle is a set of READ-ONLY VIEWS of them, so a
    // caller can read the phase of the draw but can never write it.
    const facts = {
      issuer: this,
      handle: undefined as unknown as CacheDrawHandle,
      request, ticket, ticketDigest,
      drawId: ticketDigest.slice(0, 16),
      phase: "reserved" as CacheDrawPhase,
      candidateDigest: null as string | null,
      picture: null as Buffer | null,
      error: null as unknown,
      cleanup: [] as unknown[],
      cleanupRequired: false,
      cleanupTruncated: false,
      settled: false,
      latched: { kind: "none", code: null, message: null, native_phase: null } as CacheLatchedOutcome,
      settlementHandedOver: false,
      child: undefined as ChildProcess | undefined,
      custodian: null as CacheProcessIdentity | null,
      worker: null as CacheProcessIdentity | null,
      recorded: new Map<number, number>(),
      members: [] as CacheProcessIdentity[],
      finalizeAfterOk: false,
      finalizedDigest: null as string | null,
      observedSignals: [] as string[],
      control: cacheOpenControlState(),
      custodianClosed: false,
      custodianExit: null as { code: number | null; signal: NodeJS.Signals | null } | null,
      closed: null as Promise<void> | null,
      authorizeSent: false,
      forked: false,
      forkedPid: null as number | null,
      cancelSent: false,
      runDirectory: null as string | null,
      afterCandidate: false,
      transportFailure: null as CacheNativeErrorEnvelope | null,
      custodianBorn: false,
      custodianEpoch: null as CacheProcessIdentity | null,
      custodianHelloEpoch: null as CacheProcessEpoch | null,
      cancelProvenance: null as CacheCancelProvenance | null,
      cancelSecondary: null as CacheCancelSecondary | null,
      terminalObservations: [] as CacheTerminalProofObservation[],
      terminalObservationsTruncated: false,
      terminalProofAt: null as number | null,
      terminalProven: false,
      cancelRequested: false,
      execOk: null as boolean | null,
      resolve: resolveSettlement,
      settleCalled: false,
    } satisfies DrawFacts;
    const handle: CacheDrawHandle = {
      get phase(): CacheDrawPhase { return facts.phase; },
      get candidate_digest(): string | null { return facts.candidateDigest; },
      get cleanup_required(): boolean { return facts.cleanupRequired; },
      settlement,
    };
    facts.handle = handle;
    drawFacts.set(handle as object, facts);
    return handle;
  }

  /**
   * Start ONE reserved draw.
   *
   * Only a handle this supervisor issued, and only one that is still reserved,
   * may be started - and it is started once. A second start is a refusal, not a
   * second worker.
   */
  async start(handle: CacheDrawHandle): Promise<CacheDrawSettlement> {
    const facts = this.#factsOf(handle);
    if (facts === null) {
      throw new CacheDrawError("DRAW_FOREIGN", "The draw handle is not one this supervisor issued");
    }
    if (facts.phase !== "reserved") {
      throw new CacheDrawError("DRAW_ALREADY_STARTED", "The draw was already started");
    }
    if (facts.cancelRequested) {
      // The owner cancelled the draw BEFORE it started: nothing may be born.
      // The draw ends as the failure of a child that was never born.
      this.#latchFailure(facts, "CUSTODIAN_NOT_BORN",
        "The draw was cancelled before it was started: no child was born");
      this.#settle(facts, null, facts.error);
      return await facts.handle.settlement;
    }
    void this.#run(facts);
    return await facts.handle.settlement;
  }

  /**
   * Draw one picture, in a worker of its own.
   *
   * The returned promise settles only when the whole process domain of the draw
   * really disappeared. A cleanup that cannot be proven keeps it PENDING: it is
   * not turned into a failure by a deadline, and nothing it holds is released.
   */
  async draw(request: CacheDrawRequest): Promise<Buffer> {
    const handle = this.reserve(request);
    const settlement = await this.start(handle);
    if (settlement.error !== null) throw settlement.error;
    if (settlement.picture === null) {
      throw new CacheDrawError("DRAW_EMPTY", "The draw ended with neither a picture nor a failure");
    }
    return settlement.picture;
  }

  /** The private facts of a handle, or null when this supervisor did not issue it. */
  #factsOf(handle: unknown): DrawFacts | null {
    if (handle === null || typeof handle !== "object") return null;
    const facts = drawFacts.get(handle as object);
    if (facts === undefined) return null;
    // A REAL handle of ANOTHER supervisor is foreign here, even though it is in
    // the same table: the table is module wide, the authority is not.
    if (facts.issuer !== this) return null;
    return facts;
  }

  /**
   * The state of a draw that may be held, as a read-only copy.
   *
   * It reports what is true RIGHT NOW: it reads the kernel again, and it settles
   * nothing.
   */
  inspectCleanup(handle: unknown): CacheCleanupInspection {
    const facts = this.#factsOf(handle);
    if (facts === null) {
      return Object.freeze({
        known: false, phase: null, cleanup_required: false, settled: false,
        custodian_pid: null, worker_pid: null, worker_start_ticks: null,
        group: null, session: null, group_members: 0, zombies: 0,
        finalize_after_ok: false, observed_signals: [] as readonly string[],
        cleanup_failures: 0,
        latched_outcome: Object.freeze({ kind: "none", code: null, message: null, native_phase: null }),
        run_directory: null,
        receipt_valid: false,
      });
    }
    const group = facts.worker === null ? { members: [] } : observeCacheProcessGroup(facts.worker.pgid);
    return Object.freeze({
      known: true,
      phase: facts.phase,
      cleanup_required: facts.cleanupRequired,
      settled: facts.settled,
      custodian_pid: facts.custodian?.pid ?? null,
      worker_pid: facts.worker?.pid ?? null,
      worker_start_ticks: facts.worker === null ? null : String(facts.worker.start_ticks),
      group: facts.worker?.pgid ?? null,
      session: facts.worker?.sid ?? null,
      group_members: group.members.length,
      zombies: group.members.filter(member => member.state === "Z").length,
      finalize_after_ok: facts.finalizeAfterOk,
      observed_signals: Object.freeze([...facts.observedSignals]),
      cleanup_failures: facts.cleanup.length,
      latched_outcome: Object.freeze({ ...facts.latched }),
      run_directory: facts.runDirectory,
      receipt_valid: validateCacheDomainReceipt(
        facts.control.receipt,
        this.#receiptExpectation(facts),
        facts.control.accumulator.state(),
      ).ok,
    });
  }

  /**
   * Settle a draw that was held, with FRESH evidence.
   *
   * The evidence is fresh by construction: the kernel is read again, and the
   * settlement happens only when the receipt really matches, the custodian
   * really closed with the code of a settled draw, the group is provably gone
   * and every recorded identity is really gone - zombies included.
   *
   * It settles the EXECUTION and nothing else: the parent drain of the serving
   * and the whole production of the workspace go on afterwards, in their own
   * order. A reconcile that waited for them would wait for itself.
   */
  async reconcileCleanup(handle: unknown): Promise<CacheCleanupInspection> {
    const facts = this.#factsOf(handle);
    if (facts === null) {
      throw new CacheDrawError("DRAW_FOREIGN", "The draw handle is not one this supervisor issued");
    }
    if (facts.settled) return this.inspectCleanup(handle);
    if (!facts.cleanupRequired) {
      throw new CacheDrawError("DRAW_NOT_HELD", "The draw is not held: there is nothing to reconcile");
    }
    if (!facts.settlementHandedOver) {
      throw new CacheDrawError("DRAW_STILL_RUNNING", "The draw is still running: it may not be settled from outside");
    }
    if (facts.worker === null && facts.forkedPid === null) {
      // The LEDGER of the draw decides which proof applies. It is NEVER
      // guessed from the ABSENCE of a hello: a draw that was ALLOWED to fork
      // may have a worker that never said anything, and that worker may still
      // be there - so that draw stays UNKNOWN instead of being proved gone.
      if (this.#reconcileLedger(facts) === "unknown") {
        throw new CacheCleanupRequiredError(
          "The draw was allowed to fork and no worker of it was ever proved: the end of the draw is unknown",
          facts.cleanup);
      }
    }
    // The custodian that is still ALIVE is asked to try again: a custodian that
    // holds the responsibility may be waiting for a domain that has ended in
    // the meantime, and it is the only one that may reap it. A reconcile that
    // only looked at the corpse of a custodian that has closed would never
    // finish a draw whose domain ended later.
    await this.#askCustodianRecheck(facts);
    const proven = await this.#proveDomainGone(facts);
    if (!proven) {
      throw new CacheCleanupRequiredError(
        "The process domain of the draw is still there", facts.cleanup);
    }
    // The LATCHED outcome decides what the reconcile delivers. A candidate that
    // arrived after a failure is not a success, and a reconcile may not turn a
    // latched failure into a picture.
    if (facts.latched.kind === "failure") {
      this.#settle(facts, null, facts.error);
    } else {
      this.#settle(facts, facts.picture, facts.error);
    }
    // The terminal state of THIS responsibility: it is not held any more, and
    // the private run directory of the draw may be released - once, by the owner
    // of it, and only now that the resources really ended.
    facts.cleanupRequired = false;
    this.#releaseRunDirectory(facts);
    return this.inspectCleanup(handle);
  }

  /**
   * Which proof the reconcile of a draw has to use.
   *
   * It is decided by the LEDGER of the draw - by what really happened - and
   * NEVER by the absence of a fact:
   *
   *  - ``forked``       the custodian really forked: the worker and its group
   *                     are proved by the receipt and by the identities;
   *  - ``no-birth``     the child was NEVER born: the real error and the
   *                     close of the start are the whole proof;
   *  - ``no-authorize`` the custodian was born but was NEVER allowed to fork:
   *                     the exit, the close and the FRESH proof that the
   *                     original epoch of the custodian is gone are the proof;
   *  - ``unknown``      the draw was ALLOWED to fork and no worker of it was
   *                     ever proved: a worker MAY exist, and it stays
   *                     UNKNOWN - a missing hello is never a missing worker.
   */
  #reconcileLedger(facts: DrawFacts): "forked" | "no-birth" | "no-authorize" | "unknown" {
    if (facts.forked || facts.forkedPid !== null) return "forked";
    if (facts.authorizeSent) return "unknown";
    if (!facts.custodianBorn) return "no-birth";
    return "no-authorize";
  }

  /**
   * Ask a draw to stop, and KEEP its original failure.
   *
   * It is a HOST-PRIVATE surface: there is no public route for it, no MCP tool
   * and no EnginePort method. It is what an owner of a draw uses when it has
   * to end the draw itself - a tool that has to inject a deliberate failure,
   * for instance.
   *
   * The rules are strict:
   *
   *  - a handle of ANOTHER supervisor is refused BEFORE any side effect;
   *  - the EARLIEST error wins: a repeated call never replaces the primary
   *    failure, and a draw that already settled is never turned back into a
   *    failure;
   *  - the ORIGINAL error object is KEPT: when the cancel of the owner is the
   *    first failure, the draw ends with THAT object and not with a new one.
   *    An error that was already latched keeps the primary outcome, and the
   *    cancel is then only a bounded fact about what the owner asked for;
   *  - it NEVER waits for the settlement: a caller that waited here would be
   *    waiting for itself;
   *  - a draw that was reserved but never started may not spawn at all: the
   *    start refuses and the draw ends as a genuine failure of a child that
   *    was never born;
   *  - a draw that really forked is ended by the SURVIVING custodian: this
   *    method never kills the custodian and never signals a group.
   */
  requestCancel(handle: unknown, originalError: unknown): void {
    const facts = this.#factsOf(handle);
    if (facts === null) {
      throw new CacheDrawError("DRAW_FOREIGN", "The draw handle is not one this supervisor issued");
    }
    // A draw that already ended is not turned back into a failure.
    if (facts.settled) return;
    if (originalError !== null && originalError !== undefined) {
      const record = originalError as { name?: unknown; message?: unknown; code?: unknown };
      const message = String(record.message ?? originalError);
      const code = typeof record.code === "string" ? record.code.slice(0, 64) : null;
      const name = String(record.name ?? "Error").slice(0, 128);
      if (facts.cancelProvenance === null) {
        // The FIRST cancel of the owner. It is accepted as the PRIMARY outcome
        // when nothing failed before it, and the ORIGINAL error object becomes
        // the outcome of the draw.
        const accepted = facts.latched.kind !== "failure";
        if (accepted) {
          facts.latched = latchCacheOutcome(
            facts.latched, "DRAW_CANCELLED", `the draw was cancelled by its owner: ${message}`);
          facts.error = originalError;
        }
        facts.cancelProvenance = Object.freeze({
          code: "DRAW_CANCELLED",
          message: message.slice(0, 1024),
          error_name: name,
          error_code: code,
          accepted_as_primary: accepted,
          superseded_by_earlier_failure: !accepted,
        });
      } else {
        // A LATER cancel of the owner. The primary history is IMMUTABLE: the
        // first cancel is not recast as a foreign earlier failure, and the
        // original cause is never overwritten. The later request is a BOUNDED
        // fact: a COUNT and the last message.
        const count = (facts.cancelSecondary?.count ?? 0) + 1;
        facts.cancelSecondary = Object.freeze({
          count,
          message: message.slice(0, 1024),
          error_name: name,
          error_code: code,
        });
      }
    }
    if (facts.phase === "reserved") {
      // NOTHING was started: the start refuses to spawn, and the draw ends as
      // the failure of a child that was never born.
      facts.cancelRequested = true;
      return;
    }
    // The custodian that is still there is asked to stop. It is outside the
    // group of the draw, it is the only wait owner of it, and it is the only
    // one that may end it.
    this.#requestCustodianCancel(
      facts, facts.child?.stdio[4] as Socket | undefined, "the owner asked for the draw to stop");
  }

  /**
   * A BOUNDED, READ-ONLY copy of the facts of a draw.
   *
   * It is a HOST-PRIVATE surface: it is not a public DTO, not an MCP tool and
   * not an EnginePort method. It exists so that an owner of a draw can KEEP
   * what really happened - the epochs of the custodian and of the worker, the
   * fork and the exec, the real exit and close of the custodian, the targets it
   * knows, the summary of the receipt and of the accumulator, the original
   * outcome and the fresh observations of the cleanup.
   *
   * It NEVER returns the raw ticket, a token, a socket, a process handle or any
   * mutable internal authority: it returns FACTS and COPIES, and everything it
   * returns is frozen.
   */
  diagnosticSnapshot(handle: unknown): CacheDiagnosticSnapshot {
    const facts = this.#factsOf(handle);
    if (facts === null) {
      throw new CacheDrawError("DRAW_FOREIGN", "The draw handle is not one this supervisor issued");
    }
    const receipt = facts.control.receipt;
    const receiptSummary = receipt === null || receipt === undefined
      ? null
      : Object.freeze({
        kind: String(receipt.kind ?? "unknown"),
        outcome: String(receipt.outcome ?? "unknown"),
        seq: Number(receipt.seq ?? -1),
        segments: Number(receipt.segments ?? -1),
        events_count: Number(receipt.events_count ?? -1),
        waits_count: Number(receipt.waits_count ?? -1),
        identities_count: Number(receipt.identities_count ?? -1),
        exec_ok: (receipt.exec as { ok?: unknown } | null | undefined)?.ok === true,
        echild: receipt.echild === true,
        group_esrch: receipt.group_esrch === true,
        known_ids_gone: receipt.known_ids_gone === true,
        anchor_retained: receipt.anchor_retained === true,
        identity_overflow: receipt.identity_overflow === true,
        events_truncated: receipt.events_truncated === true,
        diagnostics_lost: receipt.diagnostics_lost === true,
        state: typeof receipt.state === "string" ? receipt.state : null,
        // The digests of the receipt, as the custodian computed them.
        events_digest: boundedDigestString(receipt.events_digest),
        waits_digest: boundedDigestString(receipt.waits_digest),
        identities_digest: boundedDigestString(receipt.identities_digest),
      });
    const accumulated = facts.control.accumulator.state();
    const recordedTargets = [...facts.recorded.entries()]
      .slice(0, MAX_DIAGNOSTIC_TARGETS)
      .map(([pid, startTicks]) => Object.freeze({ pid, start_ticks: String(startTicks) }));
    return Object.freeze({
      known: true,
      phase: facts.phase,
      settled: facts.settled,
      cleanup_required: facts.cleanupRequired,
      draw_id: facts.drawId,
      ticket_digest: facts.ticketDigest,
      custodian: facts.custodian === null ? null : Object.freeze({ ...facts.custodian }),
      custodian_born: facts.custodianBorn,
      custodian_closed: facts.custodianClosed,
      custodian_exit: facts.custodianExit === null
        ? null
        : Object.freeze({ code: facts.custodianExit.code, signal: facts.custodianExit.signal }),
      worker: facts.worker === null ? null : Object.freeze({ ...facts.worker }),
      forked: facts.forked,
      forked_pid: facts.forkedPid,
      exec_ok: facts.execOk,
      recorded_targets: Object.freeze(recordedTargets),
      receipt_summary: receiptSummary,
      accumulator_summary: Object.freeze({
        segments: accumulated.segments,
        received: accumulated.received,
        events: accumulated.events,
        waits: accumulated.waits,
        identities: accumulated.identities,
        refused: facts.control.accumulator.reason !== null,
        // The digests of the ACCUMULATOR: the digests of the bytes that
        // really arrived, copied and never recomputed here.
        events_digest: boundedDigestString(accumulated.events_digest),
        waits_digest: boundedDigestString(accumulated.waits_digest),
        identities_digest: boundedDigestString(accumulated.identities_digest),
      }),
      latched_outcome: Object.freeze({ ...facts.latched }),
      cancel_provenance: facts.cancelProvenance === null
        ? null
        : Object.freeze({ ...facts.cancelProvenance }),
      cancel_secondary: facts.cancelSecondary === null
        ? null
        : Object.freeze({ ...facts.cancelSecondary }),
      cleanup_facts: Object.freeze(boundedCacheFailures(facts.cleanup)),
      terminal_proof: facts.terminalProofAt === null
        ? null
        : Object.freeze({
          at: facts.terminalProofAt,
          proven: facts.terminalProven,
          truncated: facts.terminalObservationsTruncated,
          observations: Object.freeze([...facts.terminalObservations]),
        }),
      observed_signals: Object.freeze([...facts.observedSignals]),
      cleanup_failures: facts.cleanup.length,
      run_directory: facts.runDirectory,
      transport_failure: facts.transportFailure === null ? null : Object.freeze({ ...facts.transportFailure }),
    });
  }

  /**
   * Ask the custodian that is still alive to try the settlement again.
   *
   * It waits for a fresh receipt, and it does not settle anything: a custodian
   * that cannot prove the domain gone keeps the responsibility, and the draw
   * stays pending.
   */
  async #askCustodianRecheck(facts: DrawFacts): Promise<void> {
    if (facts.custodianClosed || facts.custodianExit !== null) return;
    const channel = facts.child?.stdio[4] as Socket | undefined | null;
    if (channel === undefined || channel === null) return;
    try {
      const payload = Buffer.from(JSON.stringify({
        kind: "RECHECK",
        protocol: CACHE_PROCESS_PROTOCOL,
        draw_id: facts.drawId,
        ticket_digest: facts.ticketDigest,
      }), "utf8");
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32BE(payload.length, 0);
      channel.write(Buffer.concat([header, payload]));
      facts.observedSignals.push("RECHECK:custodian");
    } catch (error) {
      facts.cleanup.push(error);
      return;
    }
    const deadline = Date.now() + this.#limits.killConfirmMs;
    while (facts.control.receipt === null && !facts.custodianClosed && Date.now() < deadline) {
      await delay(20);
    }
  }

  /** Settle a draw exactly once. */
  #settle(facts: DrawFacts, picture: Buffer | null, error: unknown): void {
    if (facts.settleCalled) return;
    facts.settleCalled = true;
    facts.settled = true;
    facts.phase = error === null && picture !== null ? "execution_settled" : "failed";
    facts.picture = picture;
    facts.error = error;
    facts.resolve({ picture, error, cleanup: [...facts.cleanup] });
  }

  /**
   * Latch the FIRST thing that went wrong.
   *
   * A failure LATCHES: the first failure is the outcome, and nothing that comes
   * later may replace it - not a candidate, not a cleanup failure.
   *
   * A CANDIDATE does not latch against a failure: a candidate that arrived, and
   * a fatal error that came AFTER it, still ends as the failure. The candidate
   * was never more than a candidate.
   */
  #latchFailure(facts: DrawFacts, code: string, message: string, nativePhase: string | null = null): void {
    if (facts.latched.kind === "failure") return;
    facts.latched = latchCacheOutcome(facts.latched, code, message, nativePhase);
    facts.error = new CacheDrawError(code, message);
  }

  /**
   * Hold a draw because its cleanup could not be proven.
   *
   * The promise stays pending and the scope of the draw is marked: the root it
   * holds is not given to the next production, and the capacity it took is not
   * returned.
   *
   * The causes are COPIED before they are walked: the array that is written to
   * here may be the very array that is being read, and an array that grows
   * while it is walked never ends.
   */
  #holdForCleanup(facts: DrawFacts, failures: readonly unknown[]): void {
    facts.cleanupRequired = true;
    facts.phase = "cleanup_required";
    facts.settlementHandedOver = true;
    const collected = collectCacheCleanupCauses(facts.cleanup, failures);
    facts.cleanup = collected.causes;
    if (collected.truncated) facts.cleanupTruncated = true;
    if (this.#options.scope !== undefined) markCacheProductionCleanupRequired(this.#options.scope);
    // The promise is NOT settled: the draw is not over.
  }

  /**
   * End a draw with a failure.
   *
   * The failure is settled only AFTER the process domain of the draw is really
   * gone: a failure that is delivered while the worker is still running would
   * be a report about a draw that has not ended. A cleanup that cannot be proven
   * keeps the promise pending instead.
   */
  async #fail(facts: DrawFacts, failure: unknown, closed: Promise<void>): Promise<void> {
    await this.#terminate(facts, closed);
    const proven = await this.#proveDomainGone(facts);
    if (!proven) {
      this.#holdForCleanup(facts, facts.cleanup);
      return;
    }
    this.#settle(facts, null, failure);
  }

  /** The private run directory of one draw, and the environment that points at it. */
  #createRunDirectory(): string {
    const base = mkdtempSync(join(tmpdir(), "narralens-cache-run-"));
    for (const name of PRIVATE_RUN_DIRECTORIES) {
      mkdirSync(join(base, name), { recursive: true, mode: 0o700 });
    }
    return base;
  }

  /**
   * The environment the custodian and the worker are given.
   *
   * The HOME and the XDG directories of the draw are the PRIVATE ones of that
   * draw: a browser that inherits the user's HOME writes into the user's own
   * configuration, and a draw of one root may never see the state of another.
   * The Host's own environment is never changed.
   */
  #childEnvironment(runDirectory: string): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const name of CACHE_CHILD_ENV_NAMES) {
      const value = process.env[name];
      if (typeof value === "string") environment[name] = value;
    }
    for (const name of PRIVATE_CHILD_ENV_NAMES) {
      delete environment[name];
    }
    environment.HOME = join(runDirectory, "home");
    environment.TMPDIR = join(runDirectory, "tmp");
    environment.TMP = environment.TMPDIR;
    environment.TEMP = environment.TMPDIR;
    environment.XDG_CACHE_HOME = join(runDirectory, "cache");
    environment.XDG_CONFIG_HOME = join(runDirectory, "config");
    environment.XDG_DATA_HOME = join(runDirectory, "data");
    environment.XDG_RUNTIME_DIR = join(runDirectory, "runtime");
    environment.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    return environment;
  }

  /** Remove the private run directory, when the draw really ended. */
  #releaseRunDirectory(facts: DrawFacts): void {
    const directory = facts.runDirectory;
    if (directory === null) return;
    if (!facts.settled || facts.cleanupRequired) return;
    try {
      rmSync(directory, { recursive: true, force: true });
      facts.runDirectory = null;
    } catch (error) {
      facts.cleanup.push(error);
    }
  }

  /** Run one draw: spawn, handshake, draw, finalise, prove. */
  async #run(facts: DrawFacts): Promise<void> {
    const limits = this.#limits;
    const request = facts.request;
    facts.phase = "spawning";
    // The private namespace of THIS draw. It exists before anything is born, so
    // that the child never inherits the namespace of the Host.
    let runDirectory: string;
    try {
      runDirectory = this.#createRunDirectory();
    } catch (error) {
      this.#latchFailure(facts, "RUN_DIRECTORY_FAILED",
        `The private directory of the draw could not be created: ${String((error as { message?: unknown }).message ?? error)}`);
      this.#settle(facts, null, facts.error);
      return;
    }
    facts.runDirectory = runDirectory;
    // The custodian is a process of its own: the fixed interpreter, the fixed
    // script, and NOTHING else in its argument vector. The ticket of the draw
    // travels over the private control socket.
    //
    // It is started DETACHED: it is the leader of its own session and its own
    // group before its first instruction runs, and the handshake checks that
    // against the kernel instead of assuming it.
    let child: ChildProcess;
    try {
      child = spawn(this.#options.pythonExecutable, ["-I", "-S", "-B", this.#options.custodianPath], {
        stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
        env: this.#childEnvironment(runDirectory),
        detached: true,
      });
    } catch (error) {
      // The start failed SYNCHRONOUSLY: there was never a child. The original
      // error - the real EAGAIN or ENOENT - is kept, and the draw ends as that
      // failure: there is nothing to clean up and nothing to wait for.
      const envelope = normalizeNativeEnvelope(error);
      this.#latchFailure(facts, "CUSTODIAN_NOT_BORN",
        `The custodian could not be started: ${envelope.code ?? ""} ${envelope.message}`.trim());
      facts.transportFailure = envelope;
      this.#settle(facts, null, facts.error);
      this.#releaseRunDirectory(facts);
      return;
    }
    facts.child = child;
    facts.custodianBorn = typeof child.pid === "number" && child.pid > 0;
    // The epoch of the custodian, read from the kernel right after the start:
    // it is the proof of the ORIGINAL process later on.
    if (facts.custodianBorn) {
      const observation = observeCacheProcessIdentity(child.pid ?? -1);
      if (observation.presence === "known" && observation.identity !== null) {
        facts.custodianEpoch = observation.identity;
      }
    }
    // The ASYNCHRONOUS error of the child. An error that nobody listens for
    // terminates the Host: it is listened for HERE, the original error is
    // KEPT as a bounded envelope, and the draw enters the same owned cleanup
    // as any other failure. It is not an exit and not a close.
    child.on("error", (error: unknown) => {
      facts.transportFailure = normalizeNativeEnvelope(error);
      // A child that was never BORN failed to start: the original error of
      // the start is the failure of the draw, and the draw ends as it - it is
      // not held for ever, because there is nothing to hold.
      const code = facts.custodianBorn ? "CUSTODIAN_ERROR" : "CUSTODIAN_NOT_BORN";
      const envelope = facts.transportFailure;
      this.#latchFailure(facts, code,
        `The custodian failed: ${envelope?.code ?? ""} ${envelope?.message ?? String((error as { message?: unknown }).message ?? error)}`.trim());
    });
    const drawChannel = child.stdio[3] as Socket | undefined;
    const controlChannel = child.stdio[4] as Socket | undefined;
    if (drawChannel === null || drawChannel === undefined || controlChannel === null || controlChannel === undefined) {
      this.#latchFailure(facts, "CUSTODIAN_CHANNEL_MISSING", "The custodian has no private channels");
      this.#settle(facts, null, facts.error);
      this.#releaseRunDirectory(facts);
      return;
    }

    // The ASYNCHRONOUS errors of the two private channels. An EPIPE or an
    // ECONNRESET of one of them is a transport failure of the draw, and it is
    // routed into the owned cleanup - never left unhandled.
    const onChannelError = (name: string) => (error: unknown): void => {
      facts.transportFailure = normalizeNativeEnvelope(error);
      this.#latchFailure(facts, "CHANNEL_ERROR",
        `The ${name} of the custodian failed: ${String((error as { message?: unknown }).message ?? error)}`);
    };
    drawChannel.on("error", onChannelError("draw channel"));
    controlChannel.on("error", onChannelError("control channel"));

    // The bounded diagnostics of the custodian. A custodian that floods is a
    // failure of the draw, not a diagnostic that is truncated and forgotten.
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTail = Buffer.alloc(0);
    let stderrTail = Buffer.alloc(0);
    const onStdout = (chunk: Buffer): void => {
      stdoutBytes += chunk.length;
      stdoutTail = Buffer.concat([stdoutTail, chunk]).subarray(-limits.diagnosticTailBytes);
      if (stdoutBytes > limits.stdoutBytes) {
        // The flood LATCHES at once, in EVERY phase: it is not noticed once,
        // later, after a candidate.
        this.#latchFailure(facts, "CUSTODIAN_FLOOD", "The custodian wrote more than it may");
      }
    };
    const onStderr = (chunk: Buffer): void => {
      stderrBytes += chunk.length;
      stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-limits.diagnosticTailBytes);
      if (stderrBytes > limits.stderrBytes) {
        this.#latchFailure(facts, "CUSTODIAN_FLOOD", "The custodian wrote more than it may");
      }
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);

    // The two private channels, each with its own bounded decoder AND its own
    // bounded queue of decoded frames. The control channel carries metadata
    // only; the draw channel carries the metadata of the draw AND the picture,
    // so its bound is the picture AND the metadata in front of it.
    const controlDecoder = new CacheChannelDecoder(limits.metadataBytes + 4);
    const drawDecoder = new CacheChannelDecoder(limits.drawQueueBytes);
    const controlQueue = new CacheFrameQueue<Record<string, unknown>>(
      limits.controlQueueFrames, limits.controlQueueBytes,
      frame => JSON.stringify(frame).length,
    );
    const drawQueue = new CacheFrameQueue<Buffer>(
      limits.drawQueueFrames, limits.drawQueueBytes,
      frame => frame.length,
    );
    let drawFailure: string | null = null;
    let controlClosed = false;
    let drawClosed = false;

    const pumpControl = (chunk: Buffer): void => {
      let frames: Buffer[];
      try {
        frames = controlDecoder.feed(chunk);
      } catch (error) {
        controlQueue.clear();
        drawFailure = String((error as { message?: unknown }).message ?? error);
        this.#latchFailure(facts, "CONTROL_DECODER_FAILED", drawFailure);
        return;
      }
      for (const frame of frames) {
        let message: Record<string, unknown>;
        try {
          message = parseFrame(frame);
        } catch (error) {
          this.#latchFailure(facts, "MESSAGE_MALFORMED",
            String((error as { message?: unknown }).message ?? error));
          continue;
        }
        // The SEQUENCE of the control channel is checked on EVERY message: a
        // gap, a repetition or a reordering is a broken chain, and a broken
        // chain is not a receipt.
        const interpreted = cacheInterpretControlMessage(facts.control, message);
        if (!interpreted.ok) {
          this.#latchFailure(facts, facts.control.failure?.code ?? "PROTOCOL_UNEXPECTED",
            interpreted.reason ?? "the control channel carried a message that could not be read");
          continue;
        }
        // The bulk of the receipt arrives in SEGMENTS. They were accumulated by
        // the interpretation above, and they are NOT queued: the receipt of the
        // draw is the final summary, and a segment that was queued would be
        // read as one.
        if (message.kind === "RECEIPT_SEGMENT") continue;
        if (!controlQueue.push(message)) {
          this.#latchFailure(facts, "CONTROL_QUEUE_OVERFLOW",
            "The control channel delivered more than the draw may hold");
          controlQueue.clear();
          return;
        }
      }
    };
    const pumpDraw = (chunk: Buffer): void => {
      let frames: Buffer[];
      try {
        frames = drawDecoder.feed(chunk);
      } catch (error) {
        drawQueue.clear();
        drawFailure = String((error as { message?: unknown }).message ?? error);
        this.#latchFailure(facts, "DRAW_DECODER_FAILED", drawFailure);
        return;
      }
      for (const frame of frames) {
        if (facts.afterCandidate) {
          // The terminal messages of the draw are COUNTED HERE and not only
          // when somebody reads them: a `closed:false` or a `fatal` that stays
          // in the queue is a failure that never arrives.
          this.#observeDrawTerminal(facts, frame);
          continue;
        }
        if (!drawQueue.push(frame)) {
          this.#latchFailure(facts, "DRAW_QUEUE_OVERFLOW",
            "The draw channel delivered more than the draw may hold");
          drawQueue.clear();
          return;
        }
      }
    };
    controlChannel.on("data", pumpControl);
    drawChannel.on("data", pumpDraw);
    const onControlEnd = (): void => { controlClosed = true; };
    controlChannel.on("end", onControlEnd);
    controlChannel.on("close", onControlEnd);
    // The draw channel ENDING is a fact about the worker: it is not the end of
    // the draw, and the custodian is told about it at once.
    const onDrawEnd = (): void => {
      if (drawClosed) return;
      drawClosed = true;
      // The draw channel ended BEFORE the finalisation was authorised. The
      // worker is gone and the answer that was in it may never be complete: it
      // is a protocol failure, and it is latched HERE - the latch helper alone
      // would not close it, because the event entry bypassed it.
      const failure = cacheDrawEndFailure(facts.finalizeAfterOk);
      if (failure !== null) this.#latchFailure(facts, failure.code, failure.message);
      // The CANCEL is a COMMAND, and it is sent only when the draw ended
      // WITHOUT the finalisation being authorised: the custodian may still be
      // reading its control channel, and it has to stop the domain.
      //
      // After the FINALIZE was authorised the custodian is finishing the
      // domain ON ITS OWN, and a CANCEL would be a byte that it may never
      // read: the close of a socket with unread data is a RESET, and the Host
      // would read that reset as the failure of a draw that really
      // succeeded.
      if (failure !== null) {
        this.#requestCustodianCancel(facts, controlChannel, "the draw channel closed");
      }
    };
    drawChannel.on("end", onDrawEnd);
    drawChannel.on("close", onDrawEnd);

    const writeFrame = (channel: Socket, payload: Buffer): void => {
      if (payload.length > limits.metadataBytes) {
        throw new CacheDrawError("FRAME_TOO_LARGE", "a frame of the private channel is too large");
      }
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32BE(payload.length, 0);
      channel.write(Buffer.concat([header, payload]));
    };
    const writeMessage = (channel: Socket, message: unknown): void => {
      writeFrame(channel, Buffer.from(JSON.stringify(message), "utf8"));
    };

    // The end of the custodian, as Node reports it: the exit, and the close that
    // follows it when the standard streams are closed as well.
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      child.once("exit", (code, signal) => {
        facts.observedSignals.push(`exit:${signal ?? `code ${String(code)}`}`);
        facts.custodianExit = { code, signal };
        resolveExit({ code, signal });
      });
    });
    const closed = new Promise<void>((resolveClose) => {
      child.once("close", () => {
        facts.custodianClosed = true;
        resolveClose();
      });
    });
    facts.closed = closed;

    /** Take the next frame of the control channel, or null on the deadline. */
    const nextControl = async (deadlineMs: number): Promise<Record<string, unknown> | null> => {
      const deadline = Date.now() + deadlineMs;
      for (;;) {
        const frame = controlQueue.shift();
        if (frame !== undefined) return frame;
        if (controlClosed) return null;
        if (facts.latched.kind === "failure") return null;
        if (Date.now() >= deadline) return null;
        await delay(5);
      }
    };

    /**
     * Take the next frame of the draw channel, or null on the deadline.
     *
     * The limit of the PHASE is checked here, where the phase is known: the
     * metadata of the draw is small, the picture is bounded by its own limit.
     */
    const nextDraw = async (deadlineMs: number, maxFrame: number): Promise<Buffer | null> => {
      const deadline = Date.now() + deadlineMs;
      for (;;) {
        const frame = drawQueue.shift();
        if (frame !== undefined) {
          if (frame.length > maxFrame) {
            throw new CacheDrawError("CHANNEL_FRAME_TOO_LARGE",
              "A frame of the draw channel is larger than this phase allows");
          }
          return frame;
        }
        if (drawFailure !== null) return null;
        if (facts.latched.kind === "failure") return null;
        if (Date.now() >= deadline) return null;
        await delay(5);
      }
    };

    try {
      // 1) The identity of the custodian, checked against the kernel.
      //
      //    ONE deadline covers the WHOLE two level chain: the custodian, the
      //    worker, and the worker's own hello. Each step does not get a fresh
      //    budget of its own.
      const ready = new CacheDeadline(Date.now() + limits.readyMs);
      const hello = await nextControl(ready.remaining(Date.now()));
      if (hello === null) {
        this.#latchFailure(facts, "CUSTODIAN_NOT_READY",
          "The custodian did not state its identity in time");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      if (hello.kind !== "C_HELLO" || hello.protocol !== CACHE_PROCESS_PROTOCOL) {
        this.#latchFailure(facts, "PROTOCOL_UNEXPECTED", "The custodian did not open with its identity");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      const custodianIdentity = observeCacheProcessIdentity(child.pid ?? -1);
      if (custodianIdentity.presence !== "known" || custodianIdentity.identity === null) {
        this.#latchFailure(facts, "CUSTODIAN_IDENTITY_UNREADABLE",
          "The custodian has no identity the kernel confirms");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      // The custodian states what it is; the kernel states what it is; they must
      // be the same process, in the same group, in the same session, started at
      // the same moment - and it must be THIS Host's own child.
      //
      //    It is ALSO the leader of its own session and its own group: the Host
      //    started it detached, and the kernel is asked whether that is true.
      if (custodianIdentity.identity.pid !== Number(hello.pid)
        || custodianIdentity.identity.ppid !== process.pid
        || custodianIdentity.identity.pgid !== Number(hello.pgid)
        || custodianIdentity.identity.sid !== Number(hello.sid)
        || custodianIdentity.identity.start_ticks !== Number(hello.start_ticks)
        || custodianIdentity.identity.pgid !== custodianIdentity.identity.pid
        || custodianIdentity.identity.sid !== custodianIdentity.identity.pid
        || hello.subreaper !== true) {
        this.#latchFailure(facts, "CUSTODIAN_IDENTITY_MISMATCH",
          "The custodian is not the process it says it is");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      facts.custodian = custodianIdentity.identity;
      // The epoch the custodian stated, kept as the CONSERVATIVE source of the
      // original identity of the custodian when the observation of the start
      // could not be made. It was checked against the kernel above, and it is
      // never replaced by a later observation.
      facts.custodianHelloEpoch = Object.freeze({
        pid: Number(hello.pid),
        ppid: process.pid,
        pgid: Number(hello.pgid),
        sid: Number(hello.sid),
        start_ticks: String(hello.start_ticks),
      });
      facts.phase = "custodian_hello";

      // 2) The authorisation of the fork. The ticket travels over the private
      //    control socket; the worker and the custodian are named by path.
      facts.authorizeSent = true;
      writeMessage(controlChannel, {
        kind: "AUTHORIZE_FORK",
        protocol: CACHE_PROCESS_PROTOCOL,
        draw_id: facts.drawId,
        ticket_digest: facts.ticketDigest,
        node_path: process.execPath,
        worker_path: this.#options.workerPath,
      });

      // 3) The worker, as the custodian forked it.
      const forked = await nextControl(ready.remaining(Date.now()));
      if (forked === null || forked.kind !== "FORKED") {
        this.#latchFailure(facts, "WORKER_NOT_FORKED", "The custodian did not report a worker");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      facts.forked = true;
      facts.forkedPid = Number(forked.pid);
      const exec = forked.exec as { ok?: unknown } | undefined;
      facts.execOk = exec?.ok === true;
      if (exec?.ok !== true) {
        this.#latchFailure(facts, "WORKER_EXEC_FAILED", "The custodian could not exec the worker");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      facts.phase = "forked";

      // 4) The identity of the worker, stated by the worker and checked against
      //    the kernel AND against what the custodian said.
      const workerHello = await nextDraw(ready.remaining(Date.now()), limits.metadataBytes);
      if (workerHello === null) {
        this.#latchFailure(facts, "WORKER_NOT_READY", "The worker did not state its identity in time");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      const stated = parseFrame(workerHello);
      if (stated.kind !== "N_HELLO" || stated.protocol !== CACHE_PROCESS_PROTOCOL) {
        this.#latchFailure(facts, "PROTOCOL_UNEXPECTED", "The worker did not open with its identity");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      const workerIdentity = observeCacheProcessIdentity(Number(stated.pid));
      if (workerIdentity.presence !== "known" || workerIdentity.identity === null) {
        this.#latchFailure(facts, "WORKER_IDENTITY_UNREADABLE",
          "The worker has no identity the kernel confirms");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      const worker = workerIdentity.identity;
      // The worker is the process the custodian forked: its number is the one the
      // custodian reported, its parent is the custodian, and it is the leader of
      // its own session and its own group.
      if (worker.pid !== Number(forked.pid)
        || worker.ppid !== facts.custodian.pid
        || worker.pgid !== Number(stated.pgid)
        || worker.sid !== Number(stated.sid)
        || worker.start_ticks !== Number(stated.start_ticks)
        || worker.pgid !== worker.pid
        || worker.sid !== worker.pid) {
        this.#latchFailure(facts, "WORKER_IDENTITY_MISMATCH",
          "The worker is not the process it says it is");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      facts.worker = worker;
      facts.phase = "identified";

      // 5) The authorisation of the draw. It goes on the DRAW channel, and the
      //    worker is the only reader of it.
      const go = Buffer.from(JSON.stringify({
        kind: "GO",
        protocol: CACHE_PROCESS_PROTOCOL,
        ticket: facts.ticket,
        upstream_root: this.#options.vendorRoot,
        producer_file: this.#options.producerFile,
        request: {
          root: request.root, base: request.base, rel: request.rel,
          ms: request.ms, width: request.width, overrides: request.overrides,
        },
      }), "utf8");
      if (go.length > limits.requestBytes) {
        this.#latchFailure(facts, "REQUEST_TOO_LARGE", "The request of the draw is larger than the limit");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      // The OUTER deadline starts HERE: it covers the whole answer, the picture
      // included, and it is not restarted when the answer begins.
      const outer = new CacheDeadline(Date.now() + limits.outerMs);
      const goHeader = Buffer.allocUnsafe(4);
      goHeader.writeUInt32BE(go.length, 0);
      drawChannel.write(Buffer.concat([goHeader, go]));
      facts.phase = "drawing";

      // 6) The candidate. It is NOT a settlement.
      const resultFrame = await nextDraw(outer.remaining(Date.now()), limits.metadataBytes);
      if (resultFrame === null) {
        this.#latchFailure(facts, "DRAW_OUTER_TIMEOUT",
          "The cache draw did not finish inside its outer deadline");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      const result = parseFrame(resultFrame);
      if (result.kind === "fatal") {
        const detail = result.error as { message?: unknown; code?: unknown } | undefined;
        this.#latchFailure(facts, "WORKER_FAILED",
          `The cache worker failed: ${String(detail?.message ?? "unknown")}`);
        await this.#fail(facts, facts.error, closed);
        return;
      }
      if (result.kind !== "result") {
        this.#latchFailure(facts, "PROTOCOL_UNEXPECTED", "The cache worker did not answer the draw");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      if (result.ticket_digest !== facts.ticketDigest) {
        this.#latchFailure(facts, "PROTOCOL_FOREIGN", "The answer of the cache worker belongs to another request");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      if (result.ok !== true) {
        // The original failure of the producer, with its bounded structure.
        const envelope = normalizeNativeEnvelope(result.error);
        this.#latchFailure(facts, "PRODUCER_FAILED", envelope.message, envelope.phase ?? null);
        facts.error = new CacheNativeError(envelope);
        await this.#fail(facts, facts.error, closed);
        return;
      }
      // The picture is its own frame, and it is bounded by its own limit.
      const picture = await nextDraw(outer.remaining(Date.now()), limits.jpegBytes);
      if (picture === null) {
        this.#latchFailure(facts, "CANDIDATE_TIMEOUT", "The complete picture did not arrive in time");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      if (sha256Of(picture) !== result.sha256 || picture.length !== Number(result.bytes)) {
        this.#latchFailure(facts, "CANDIDATE_MALFORMED", "The picture of the cache worker is not the one it described");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      if (facts.latched.kind === "failure") {
        // Something went wrong AFTER the candidate: the candidate is not a
        // success, and the failure that was latched is the outcome.
        await this.#fail(facts, facts.error, closed);
        return;
      }
      facts.phase = "candidate";
      facts.picture = picture;
      facts.candidateDigest = String(result.sha256);
      if (facts.latched.kind === "none") {
        facts.latched = { kind: "candidate", code: null, message: null, native_phase: null };
      }
      // From now on the terminal messages of the draw COUNT. The ones that were
      // already waiting in the queue are read now, and the ones that arrive
      // later are read by the pump: neither of them may stay in a queue that
      // nobody reads.
      facts.afterCandidate = true;
      for (;;) {
        const terminal = drawQueue.shift();
        if (terminal === undefined) break;
        this.#observeDrawTerminal(facts, terminal);
      }

      // The members of the group are recorded WHILE they are alive: the browser
      // and everything under it. Their identities are what the settlement is
      // checked against afterwards.
      const group = observeCacheProcessGroup(worker.pgid);
      facts.members = [...group.members];
      for (const member of group.members) facts.recorded.set(member.pid, member.start_ticks);

      // 7) The finalisation is recorded BEFORE it is asked for.
      facts.finalizeAfterOk = true;
      facts.finalizedDigest = String(result.sha256);
      facts.phase = "finalize_after_ok";
      writeMessage(controlChannel, {
        kind: "FINALIZE",
        protocol: CACHE_PROCESS_PROTOCOL,
        draw_id: facts.drawId,
        ticket_digest: facts.ticketDigest,
      });

      // 8) The receipt of the custodian, and its real close. The deadline of the
      //    closing phase is counted FROM THE CANDIDATE.
      const finalize = new CacheDeadline(Date.now() + limits.finalizeMs);
      const receipt = await nextControl(finalize.remaining(Date.now()));
      if (receipt === null) {
        this.#latchFailure(facts, "CUSTODIAN_RECEIPT_MISSING",
          "The custodian did not report the end of the draw in time");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      if (receipt.kind === "CUSTODIAN_FAILED") {
        this.#latchFailure(facts, "CUSTODIAN_FAILED",
          `The custodian failed: ${String((receipt.message as unknown) ?? "unknown")}`);
        await this.#fail(facts, facts.error, closed);
        return;
      }
      if (receipt.kind !== "DOMAIN_REAPED") {
        this.#latchFailure(facts, "PROTOCOL_UNEXPECTED", "The custodian did not send the receipt of the draw");
        await this.#fail(facts, facts.error, closed);
        return;
      }

      // 9) The custodian really closed, and the domain is really gone.
      //
      //    ONE deadline, counted FROM THE CANDIDATE, governs the receipt, the
      //    close of the custodian and the fresh proof. A receipt that arrived in
      //    time and a close that did not is NOT a success: the budget of the
      //    finalisation is one budget.
      const proven = await this.#proveDomainGone(facts, finalize);
      if (!proven) {
        if (finalize.expired(Date.now())) {
          // The candidate's own budget is spent. The draw is a FAILURE, and the
          // cleanup continues under its OWN action deadlines: a late close may
          // complete the failure cleanup, but it may not make a success of it.
          this.#latchFailure(facts, "FINALIZE_TIMEOUT",
            "The custodian did not close inside the finalisation budget of the candidate");
          await this.#fail(facts, facts.error, closed);
          return;
        }
        this.#holdForCleanup(facts, facts.cleanup);
        return;
      }
      // The ELIGIBILITY of a success is a separate question from the proof of
      // the domain: the resources may really be gone while the draw failed, and
      // such a draw is a failure whose cleanup really ended - never a success,
      // and never held for ever.
      const eligibility = this.#receiptEligibility(facts);
      if (!eligibility.ok) {
        this.#latchFailure(facts, "RECEIPT_NOT_ELIGIBLE",
          eligibility.reason ?? "the receipt of the custodian does not allow a success");
        await this.#fail(facts, facts.error, closed);
        return;
      }
      // The latched outcome decides: a candidate that arrived after a failure is
      // not a success.
      if (facts.latched.kind === "failure") {
        this.#settle(facts, null, facts.error);
        return;
      }
      this.#settle(facts, picture, null);
    } catch (error) {
      this.#latchFailure(facts, "DRAW_FAILED", String((error as { message?: unknown }).message ?? error));
      await this.#fail(facts, facts.error ?? error, closed);
    } finally {
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      void stdoutTail;
      void stderrTail;
      void exited;
      this.#releaseRunDirectory(facts);
    }
  }

  /** Ask the custodian to cancel, exactly once. */
  #requestCustodianCancel(facts: DrawFacts, channel: Socket | undefined | null, reason: string): void {
    if (facts.cancelSent) return;
    facts.cancelSent = true;
    facts.observedSignals.push(`CANCEL:custodian:${reason}`);
    if (channel === undefined || channel === null) return;
    try {
      const payload = Buffer.from(JSON.stringify({
        kind: "CANCEL",
        protocol: CACHE_PROCESS_PROTOCOL,
        draw_id: facts.drawId,
        ticket_digest: facts.ticketDigest,
      }), "utf8");
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32BE(payload.length, 0);
      channel.write(Buffer.concat([header, payload]));
    } catch (error) {
      facts.cleanup.push(error);
    }
  }

  /** What the receipt of the custodian has to match, with the whole epochs. */
  #receiptExpectation(facts: DrawFacts): CacheReceiptExpectation {
    return {
      protocol: CACHE_PROCESS_PROTOCOL,
      draw_id: facts.drawId,
      ticket_digest: facts.ticketDigest,
      seq: facts.control.receiptSeq ?? -1,
      custodian: facts.custodian === null
        ? null
        : {
          pid: facts.custodian.pid,
          ppid: facts.custodian.ppid,
          pgid: facts.custodian.pgid,
          sid: facts.custodian.sid,
          start_ticks: String(facts.custodian.start_ticks),
        },
      worker: facts.worker === null
        ? null
        : {
          pid: facts.worker.pid,
          ppid: facts.worker.ppid,
          pgid: facts.worker.pgid,
          sid: facts.worker.sid,
          start_ticks: String(facts.worker.start_ticks),
        },
      forked_pid: facts.forkedPid,
    };
  }

  /**
   * The ELIGIBILITY of a success.
   *
   * It is a different question from the proof of the domain: the resources of a
   * draw may really be gone while the draw itself failed, and such a draw is a
   * FAILURE whose cleanup really ended.
   */
  #receiptEligibility(facts: DrawFacts): { ok: boolean; reason: string | null } {
    return validateCacheExecutionReceipt(
      facts.control.receipt,
      this.#receiptExpectation(facts),
      facts.control.accumulator.state(),
      { stdoutBytes: this.#limits.stdoutBytes, stderrBytes: this.#limits.stderrBytes },
    );
  }

  /**
   * Read ONE terminal message of the draw, after the candidate was accepted.
   *
   * The `closed` message of the worker says whether the browser really closed,
   * and a `fatal` says that the worker itself failed. Both are failures of the
   * draw, and both are latched HERE: a message that waits in a queue that nobody
   * reads is a failure that never arrives.
   */
  #observeDrawTerminal(facts: DrawFacts, frame: Buffer): void {
    let message: Record<string, unknown>;
    try {
      message = parseFrame(frame);
    } catch (error) {
      this.#latchFailure(facts, "PROTOCOL_UNEXPECTED",
        String((error as { message?: unknown }).message ?? error));
      return;
    }
    const failure = cacheInterpretDrawTerminal(message);
    if (failure === null) return;
    this.#latchFailure(facts, failure.code, failure.message, failure.native_phase);
  }

  /**
   * Prove that the process domain of a draw really disappeared.
   *
   * ONE proof, shared by the run and the reconcile. It needs ALL of these:
   *
   *  - the custodian really CLOSED, and it was not killed: a custodian that
   *    died may have left a worker behind;
   *  - the receipt of the custodian REALLY matches this draw: its protocol, its
   *    draw, its ticket, its sequence number, its outcome, its event chain and
   *    its digest, and the identities it names;
   *  - the group of the worker is provably GONE, and every identity that was
   *    recorded while it was alive is gone - zombies included.
   *
   * A draw that never had a custodian has nothing to prove. A draw that was
   * AUTHORISED to fork has everything to prove: a worker that never said hello
   * may still be running, and "no hello" is not "no worker".
   */
  /**
   * Record ONE observation of the terminal proof.
   *
   * It is a FACT of the proof path: the presence that the kernel reported, the
   * number it was about, the epoch it carried and the moment it was observed.
   * It is copied here and never made up by a reader, and the list of them is
   * bounded.
   */
  #recordTerminalObservation(
    facts: DrawFacts,
    kind: CacheTerminalProofObservation["kind"],
    pid: number | null,
    observation: CacheProcessObservation,
    reason: string | null,
    originalTicks: string | null = null,
  ): void {
    facts.terminalProofAt = Date.now();
    if (facts.terminalObservations.length >= MAX_TERMINAL_OBSERVATIONS) {
      facts.terminalObservationsTruncated = true;
      return;
    }
    facts.terminalObservations.push(Object.freeze({
      at: facts.terminalProofAt,
      kind,
      presence: observation.presence,
      pid,
      // The epoch that the number carried, when the kernel still reports it,
      // and the ORIGINAL epoch otherwise: a gone observation has no fresh
      // epoch, and the original one is what went away.
      start_ticks: observation.identity === null
        ? originalTicks
        : String(observation.identity.start_ticks),
      state: observation.identity === null ? null : observation.identity.state,
      reason: observation.reason ?? reason,
    }));
  }

  async #proveDomainGone(facts: DrawFacts, finalize?: CacheDeadline): Promise<boolean> {
    const closed = facts.closed;
    if (closed !== null) {
      // The budget of the finalisation is ONE budget: it governs the receipt,
      // the close of the custodian and this proof together. The cleanup of a
      // draw that failed has its own action deadlines instead.
      const budget = finalize === undefined
        ? this.#limits.killConfirmMs
        : Math.max(0, finalize.remaining(Date.now()));
      await Promise.race([closed, delay(budget)]);
    }
    if (facts.child === undefined) {
      facts.terminalProven = true;
      return true;
    }
    if (!facts.custodianClosed) {
      facts.cleanup.push(new CacheDrawError("CUSTODIAN_NOT_CLOSED",
        "The custodian of the draw did not close"));
      return false;
    }
    // A child that was NEVER BORN has no exit and no epoch: Node does not emit
    // an exit for a spawn that failed, and there is no process that could be
    // left behind. The CLOSE is the proof - the error alone is not a close.
    if (!facts.custodianBorn) {
      facts.terminalProven = true;
      return true;
    }
    if (facts.custodianExit === null) {
      facts.cleanup.push(new CacheDrawError("CUSTODIAN_EXIT_UNKNOWN",
        "The exit of the custodian was not observed"));
      return false;
    }
    if (facts.custodianExit.signal !== null && facts.authorizeSent) {
      // The custodian was killed AFTER it was allowed to fork: it may have left
      // a worker behind, and the draw stays held until that is proven.
      facts.cleanup.push(new CacheDrawError("CUSTODIAN_KILLED",
        `The custodian of the draw was killed by ${facts.custodianExit.signal}`));
      return false;
    }
    // The ORIGINAL epoch of the custodian is really gone. A number that was
    // reused by another process is not the custodian of this draw, and a
    // custodian that is still there is not gone.
    //
    // The epoch is the observation of the start, or - when that observation
    // could not be made - the epoch the custodian stated in its hello and that
    // was checked against the kernel. It is NEVER skipped: an epoch that was
    // never bound cannot prove anything, and an UNKNOWN observation of the
    // epoch is NOT a proof that the custodian is gone.
    const epoch = facts.custodianEpoch ?? facts.custodianHelloEpoch;
    if (epoch === null) {
      // The original epoch was NEVER bound. The PID that the Host was ISSUED
      // is still a fact of this draw, and it is asked about NOW: a FRESH GONE
      // proves that the original child ended. A KNOWN observation is another
      // process at that number, and it may not be used as the original; an
      // UNKNOWN observation is unknown. The number is never guessed.
      const issued = facts.child.pid;
      if (typeof issued !== "number" || issued <= 0) {
        facts.cleanup.push(new CacheDrawError("CUSTODIAN_EPOCH_UNKNOWN",
          "The original epoch of the custodian was never bound and no number was issued: the end of the custodian cannot be proven"));
        return false;
      }
      const issuedObservation = observeCacheProcessIdentity(issued);
      this.#recordTerminalObservation(
        facts, "custodian-epoch", issued, issuedObservation,
        "the issued child of the draw, whose epoch was never bound");
      if (issuedObservation.presence === "unknown") {
        facts.cleanup.push(new CacheDrawError("CUSTODIAN_EPOCH_UNKNOWN",
          "The issued child of the draw could not be read: the end of the custodian is not proven"));
        return false;
      }
      if (issuedObservation.presence === "known") {
        facts.cleanup.push(new CacheDrawError("CUSTODIAN_EPOCH_UNBOUND",
          "The issued child of the draw is still there and its epoch was never bound: the end of the original custodian is not proven"));
        return false;
      }
      // FRESH GONE: the original child really ended.
    } else {
      const observation = observeCacheProcessIdentity(epoch.pid);
      this.#recordTerminalObservation(
        facts, "custodian-epoch", epoch.pid, observation,
        "the original epoch of the custodian", String(epoch.start_ticks));
      if (observation.presence === "unknown") {
        facts.cleanup.push(new CacheDrawError("CUSTODIAN_EPOCH_UNKNOWN",
          "The original epoch of the custodian could not be read: the end of the custodian is not proven"));
        return false;
      }
      if (observation.presence === "known" && observation.identity !== null
        && String(observation.identity.start_ticks) === String(epoch.start_ticks)) {
        // The VERY SAME process, a zombie included: it is NOT gone, and it is
        // not the end of the custodian.
        facts.cleanup.push(new CacheDrawError("CUSTODIAN_EPOCH_ALIVE",
          "The custodian of the draw is still there"));
        return false;
      }
      // FRESH GONE, or a KNOWN epoch that is really another process: the
      // original generation of the custodian ended.
    }
    if (facts.authorizeSent) {
      const validation = validateCacheDomainReceipt(
        facts.control.receipt,
        this.#receiptExpectation(facts),
        facts.control.accumulator.state(),
      );
      if (!validation.ok) {
        facts.cleanup.push(new CacheDrawError("RECEIPT_NOT_ACCEPTED",
          validation.reason ?? "the receipt of the custodian is not the one this draw expects"));
        return false;
      }
    }
    const worker = facts.worker;
    if (worker !== null) {
      const workerObservation = observeCacheProcessIdentity(worker.pid);
      this.#recordTerminalObservation(
        facts, "worker-epoch", worker.pid, workerObservation,
        "the original epoch of the worker");
      const group = observeCacheProcessGroup(worker.pgid);
      facts.members = [...group.members];
      this.#recordTerminalObservation(facts, "group", worker.pgid, {
        presence: group.presence,
        identity: null,
        reason: group.reason ?? null,
      }, "the group of the worker");
      if (group.presence !== "gone") {
        facts.cleanup.push(new CacheDrawError("GROUP_NOT_GONE",
          `The process domain of the draw is ${group.presence}`));
        return false;
      }
      for (const [pid, startTicks] of facts.recorded) {
        const observation = observeCacheProcessIdentity(pid);
        this.#recordTerminalObservation(
          facts, "known-target", pid, observation,
          "a member of the draw that was recorded while it was alive");
        if (observation.presence === "unknown") {
          facts.cleanup.push(new CacheDrawError("IDENTITY_UNKNOWN",
            "The identity of a member of the draw could not be read"));
          return false;
        }
        if (observation.presence === "known" && observation.identity?.start_ticks === startTicks) {
          // The SAME process, a zombie included: it is not gone.
          facts.cleanup.push(new CacheDrawError("IDENTITY_ALIVE",
            "A member of the draw is still there"));
          return false;
        }
      }
    }
    facts.terminalProven = true;
    return true;
  }

  /**
   * Stop the custodian and the draw it watches.
   *
   * The custodian is asked to cancel. It is outside the group of the draw, so
   * it survives and finishes the cleanup itself. This supervisor never signals
   * a group of its own: the group of the draw belongs to the custodian, and a
   * group that this supervisor cannot prove it owns is never signalled at all.
   */
  async #terminate(facts: DrawFacts, closed: Promise<void>): Promise<void> {
    const child = facts.child;
    if (child === undefined) return;
    facts.phase = "terminating";
    // The custodian is ASKED to stop: it is outside the group of the draw, it
    // is the only wait owner of it, and it finishes the cleanup itself.
    this.#requestCustodianCancel(facts, child.stdio[4] as Socket | undefined, "the draw is over");
    await Promise.race([closed, delay(this.#limits.killConfirmMs)]);
    if (!facts.custodianClosed && facts.custodianExit === null) {
      // The custodian did not leave AND its exit was not observed: it may still
      // be the same process. It is asked once more, politely, and it is NEVER
      // killed: a custodian that is destroyed on a deadline takes the wait
      // owner with it, and the orphans it leaves are nobody's.
      //
      // The number is only used when the kernel confirms that the very same
      // process is still there: a number that Node has already reaped may have
      // been given to somebody else.
      const pid = child.pid;
      if (typeof pid === "number" && pid > 0 && this.#custodianIsStillThisProcess(facts, pid)) {
        try {
          process.kill(pid, "SIGTERM");
          facts.observedSignals.push("SIGTERM:custodian");
        } catch (error) { facts.cleanup.push(error); }
        await Promise.race([closed, delay(this.#limits.termGraceMs)]);
      }
    }
    await Promise.race([closed, delay(this.#limits.killConfirmMs)]);
  }

  /**
   * Whether the custodian is STILL the process this draw started.
   *
   * The absence of the `close` event is NOT a proof that the process is alive:
   * Node closes a ChildProcess when the process ended AND its streams are
   * closed, and the streams of a custodian may be held by a grandchild for a
   * while. The kernel is asked instead.
   */
  #custodianIsStillThisProcess(facts: DrawFacts, pid: number): boolean {
    const observation = observeCacheProcessIdentity(pid);
    if (observation.presence !== "known" || observation.identity === null) return false;
    if (facts.custodian === null) return false;
    return observation.identity.start_ticks === facts.custodian.start_ticks;
  }
}

/** Parse one frame of a private channel. */
function parseFrame(frame: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.toString("utf8"));
  } catch {
    throw new CacheDrawError("MESSAGE_MALFORMED", "A message of the private channel is not JSON");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new CacheDrawError("MESSAGE_MALFORMED", "A message of the private channel is not an object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * The bounded structure of an original failure that crossed the process boundary.
 *
 * It keeps the name, the code, the message, the stack, the cause and the phase -
 * and it cuts every text to a bound, so a hostile or broken worker cannot make
 * the Host carry an unbounded string.
 */
export function normalizeNativeEnvelope(value: unknown): CacheNativeErrorEnvelope {
  const record = (value ?? {}) as Record<string, unknown>;
  const text = (input: unknown, bound: number): string => {
    if (typeof input !== "string") return "";
    return input.length > bound ? input.slice(0, bound) : input;
  };
  const cause = record.cause;
  return {
    name: text(record.name, 256) || "Error",
    code: typeof record.code === "string" ? record.code.slice(0, 256) : null,
    message: text(record.message, 4096),
    stack: typeof record.stack === "string" ? text(record.stack, 8192) : null,
    cause: cause !== undefined && cause !== null ? normalizeNativeEnvelope(cause) : null,
    phase: typeof record.phase === "string" ? record.phase.slice(0, 64) : null,
  };
}
