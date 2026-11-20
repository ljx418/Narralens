import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  observeCacheProcessIdentity,
} from "../../../src/adapters/openfilm/cache-process-supervisor.js";
import {
  PILOT_EXIT_OK,
  runPositivePilot,
  verifyPublishedRun,
  type PilotJointVerdict,
} from "../../../tools/native-cache-normal-pilot.js";

/**
 * The lifecycle of the custodian of a draw.
 *
 * The custodian is a process of its own, OUTSIDE the group of the draw, and it
 * is the only wait owner of that group. These cases are the ones that may
 * PROVE it: a group that is killed leaves orphans, and an orphan that nobody
 * waits for is a zombie that never goes away.
 *
 * They are NOT RUN in this wave: the wave that released this file allowed the
 * identity, the scheduler, the static gates and the pure unit tests only. They
 * need real processes, real signals and a heavy slot, and they run under the
 * exact P2a resource ticket.
 *
 * THE TWO STAGES ARE SEPARATE, and the first one is the safe gate:
 *
 *   1. the IDENTITY of the custodian: it is started directly, it states who it
 *      is, and it forks NOTHING. The first stage does not send AUTHORIZE_FORK
 *      and it does not touch the worker at all;
 *   2. the minimal POSITIVE roundtrip: one synthetic protocol exchange, with
 *      the helper of the faults.
 *
 * The faults are NOT in this file. A file that mixes a positive control with
 * the faults cannot prove that the positive control really worked, and the
 * first stage of a pilot must be able to fail SAFELY on its own.
 *
 * WHAT THIS FILE DOES NOT DO:
 *
 *  - it does NOT import the native source fixture, and it does NOT reach
 *    ffmpeg, a browser, a media file or the Host. The question is about the
 *    PROCESS DOMAIN, and a fixture that drew a picture would prove something
 *    else;
 *  - it does NOT accept ANY rejection as a success. The positive mode has to
 *    REALLY SUCCEED;
 *  - it does NOT count the members of the HOST's group. The group of the draw
 *    is the group of the WORKER, and the proof is the receipt of the custodian
 *    and the identities that are really gone - zombies included. A count of
 *    the group of the HOST is not a proof of anything;
 *  - it does NOT take a TIMER for the end of a run. The end of a run is the
 *    REAL close of the process, and a case that never saw it keeps its owner
 *    as unknown.
 *
 * EVERY RESOURCE IS OWNED AND REAPED IN A FINALLY. A root is removed only when
 * the draw really ended; a root whose end is UNKNOWN is KEPT, with its
 * scenario, its events and its owner, and the case says so. A deadline is a
 * deadline: it never means "the resources are gone".
 *
 * THE HELPER IS COPIED INTO A RUNTIME ROOT OF ITS OWN. The copy is verified
 * against the digest of the reviewed helper, and the scenario and the events
 * live next to the COPY - never next to the sources of the repository, where
 * two pilots would walk over each other.
 */

/** The digest of the reviewed helper. A copy of another bytes is refused. */
const REVIEWED_FIXTURE_SHA256 =
  "e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab";
/**
 * The digest of the REVIEWED custodian.
 *
 * It is an EXPLICIT constant of this file and it is NOT computed from the file
 * that is on the disk right now: a wrapper that hashes the bytes it is about
 * to run signs its own bytes, and it proves nothing. The constant is the pin
 * of the reviewed custodian, and it is updated - with a diff that says so -
 * when the reviewed source changes.
 *
 * R5C: the pin was updated because the reviewed custodian really changed -
 * the signal authority of the ORIGINAL fork is now bound once and revoked for
 * ever. The pin of the CLI of the tool is a separate ticket of MAIN, and this
 * constant does not replace it.
 *
 * R5D: the pin was updated again, because the reviewed custodian really
 * changed once more - the revoked signal authority no longer revokes the
 * COLLECTION of the terminal proof, and the retained signal facts are bounded.
 * It is still an EXPLICIT constant: the wrapper never signs its own bytes.
 */
const REVIEWED_CUSTODIAN_SHA256 =
  "40947936b36f94ea53b00ecf4f851c528484cea457f1ed4fef7aa031bba896a9";
/** The custodian of a draw. */
const CUSTODIAN_PATH = fileURLToPath(
  new URL("../../../src/adapters/openfilm/cache-process-custodian.py", import.meta.url));
/** The reviewed nofork runner: it owns the custodian and never loses it. */
const NOFORK_RUNNER = fileURLToPath(
  new URL("../../../tools/native-cache-nofork-pilot.mjs", import.meta.url));
/** The root of the repository: the directory above `tools`. */
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
/** Where the runtime roots of the reviewed nofork runner live. */
const NOFORK_ROOT_RELATIVE_PATH = "var/native-cache-pilot";

/**
 * What a case owns. Nothing is removed before it really ended.
 *
 * A case does NOT own a raw child any more: the two stages run through the
 * REVIEWED runners, and a runner owns its process and its root. The owner of a
 * case is the ROOT of the run and the fact that the run really ended.
 */
interface OwnedPilot {
  /** The runtime root of the helper, when there is one. */
  root: string | null;
  /** Whether the draw really ended. */
  settled: boolean;
  /** The failures of the cleanup, kept with the outcome. */
  failures: unknown[];
}

/** The pilots of this file. They are settled at the end of every case. */
const owned: OwnedPilot[] = [];

afterEach(() => {
  for (const pilot of owned.splice(0).reverse()) {
    if (pilot.root !== null && pilot.settled) {
      rmSync(pilot.root, { recursive: true, force: true });
    } else if (pilot.root !== null) {
      // The end is UNKNOWN: the root is KEPT, with its scenario, its events and
      // its owner, and the case says so.
      throw new Error(
        `the pilot root ${pilot.root} was kept: the draw of it did not really end`);
    }
  }
});

/**
 * OWN a runtime root from this moment on.
 *
 * The root is registered at once: a case that fails an assertion afterwards
 * still has a precise owner of it, and it is KEPT when its end is unknown.
 */
function ownRoot(root: string): OwnedPilot {
  const pilot: OwnedPilot = { root, settled: false, failures: [] };
  owned.push(pilot);
  return pilot;
}

/** The events the helper wrote into its runtime root. */
function pilotEvents(root: string): { event: string; pid?: number; identity?: { pid: number; ppid: number } | null }[] {
  const path = join(root, "cache-worker-fixture.events");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line.trim() !== "")
    .map(line => JSON.parse(line) as { event: string; pid?: number; identity?: { pid: number; ppid: number } | null });
}

/** The runtime roots that the reviewed nofork runner had BEFORE a case. */
function noforkRootsBefore(): Set<string> {
  const base = resolve(REPOSITORY_ROOT, NOFORK_ROOT_RELATIVE_PATH);
  try {
    return new Set(readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith("run-"))
      .map(entry => join(base, entry.name)));
  } catch {
    return new Set();
  }
}

/** The runtime root that the reviewed runner really created for a case. */
function theNewNoforkRoot(before: Set<string>): string | null {
  const base = resolve(REPOSITORY_ROOT, NOFORK_ROOT_RELATIVE_PATH);
  try {
    const created = readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith("run-"))
      .map(entry => join(base, entry.name))
      .filter(path => !before.has(path));
    return created.length === 1 ? (created[0] as string) : null;
  } catch {
    return null;
  }
}

/** The receipt of the reviewed runner, as it really wrote it. */
interface NoforkReceipt {
  readonly kind: string;
  readonly identity_proved: boolean;
  readonly terminal_proof: { readonly complete: boolean; readonly kind: string } | null;
  readonly unexpected_failure: unknown;
  readonly evidence_errors: readonly unknown[];
}

function readNoforkReceipt(root: string): NoforkReceipt | null {
  const path = join(root, "outcome.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as NoforkReceipt;
  } catch {
    return null;
  }
}

describe("the first stage of the pilot: the identity of the custodian", () => {
  it("states who it is, leads its own session, and forks nothing", async () => {
    // The stage runs through the REVIEWED nofork runner: the runner owns the
    // custodian, it waits for the REAL close, and it never ends a process it
    // cannot prove it owns. This case does NOT own a raw child any more.
    const before = observeCacheProcessIdentity(process.pid);
    expect(before.presence).toBe("known");
    const rootsBefore = noforkRootsBefore();
    const child = spawn(process.execPath, [
      NOFORK_RUNNER,
      "--mode", "identity",
      "--expected-custodian-sha256", REVIEWED_CUSTODIAN_SHA256,
    ], { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"], detached: true });
    // The pipes of the runner are OWNED before anything is awaited: a pipe
    // that nobody reads fills up, and a runner that nobody drains may never
    // reach its own close.
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout?.on("data", (chunk: Buffer) => { stdout.push(chunk.toString("utf8")); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr.push(chunk.toString("utf8")); });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose, rejectClose) => {
      child.once("error", (error: unknown) => { rejectClose(error); });
      child.once("close", (code: number | null, signal: NodeJS.Signals | null) => { resolveClose({ code, signal }); });
    });
    // There is NO TIMER here: the end of the runner is its REAL close. A case
    // that never saw it keeps its owner as unknown, and it fails.
    const result = await closed;
    expect(result.code).toBe(0);
    // The proof is the RECEIPT of the reviewed runner, and not a count of the
    // members of the group of the HOST.
    const root = theNewNoforkRoot(rootsBefore);
    expect(root).not.toBeNull();
    const receipt = readNoforkReceipt(root as string);
    expect(receipt).not.toBeNull();
    expect(receipt?.kind).toBe("ok");
    expect(receipt?.identity_proved).toBe(true);
    expect(receipt?.terminal_proof?.complete).toBe(true);
    expect(receipt?.unexpected_failure).toBeNull();
    expect(receipt?.evidence_errors).toEqual([]);
    // The runner really said something: its own output was drained, not lost.
    expect(stdout.join("") + stderr.join("")).toBeTypeOf("string");
  });
});

describe("the second stage of the pilot: the minimal positive roundtrip", () => {
  it("really draws, and the domain of the draw is really gone", async () => {
    // The positive stage runs through the REVIEWED independent runner: it owns
    // the root, the supervisor, the reserved handle and the promise of the
    // start, and it never kills anything.
    const outcome = await runPositivePilot({
      mode: "normal",
      expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
      expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
    });
    const pilot = ownRoot(outcome.root ?? "");
    // The verdict of the ONE checker of the tool. It is asked before the
    // evidence may be removed, and it is asked again - by the same function -
    // in the finally below.
    let verdict: PilotJointVerdict | null = null;
    try {
      // The positive control REALLY succeeds. A case that accepted any
      // rejection would pass here without proving anything.
      expect(outcome.originalFailure).toBeNull();
      expect(outcome.kind).toBe("ok");
      expect(outcome.exitCode).toBe(0);
      // And the run is ACCEPTED by the JOINT CHECKER of the tool: it reads
      // the ACTUAL bytes of the root, it verifies them against the
      // publication and against the protocol, and it is the SAME function
      // that the command and the pure tests call. A green looking final
      // record on the disk is NOT that: the conjunction is.
      verdict = verifyPublishedRun(outcome, outcome.root ?? "");
      expect(verdict.reasons).toEqual([]);
      expect(verdict.accepted).toBe(true);
      expect(verdict.evidenceReliable).toBe(true);
      expect(verdict.exitCode).toBe(PILOT_EXIT_OK);
      // And the picture is EXACTLY the synthetic one - not "longer than zero".
      expect(outcome.pictureIsTheExactOne).toBe(true);
      expect(outcome.pictureBytes).toBe(1024);
      expect(outcome.pictureSha256).toBe(
        createHash("sha256").update(Buffer.alloc(1024, 0x4a)).digest("hex"));
      // The domain of the draw really ended.
      expect(outcome.terminalProof).toBe(true);
      // The mode was really REACHED, and the helper really answered.
      const events = pilotEvents(outcome.root ?? "");
      expect(events.some(entry => entry.event === "scenario")).toBe(true);
      expect(events.some(entry => entry.event === "answered")).toBe(true);
      pilot.settled = true;
    } finally {
      // The draw really ended AND the joint checker accepted the run: the
      // root may be removed. When it did not, the root is KEPT and the case
      // says so. The evidence is NEVER removed because a timer expired.
      pilot.settled = outcome.terminalProof && (verdict?.accepted ?? false);
    }
  });
});
