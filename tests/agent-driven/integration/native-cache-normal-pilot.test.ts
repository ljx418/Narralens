import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPECTED_ASSERTION_FAILURE,
  PILOT_EXIT_FAULT,
  PILOT_EXIT_OK,
  PILOT_EXIT_REFUSED,
  PILOT_EXIT_UNRELIABLE,
  PILOT_MODES,
  PILOT_PUBLICATION_PROTOCOL,
  PILOT_REGISTRY,
  REPOSITORY_ROOT,
  PICTURE_BYTE,
  PICTURE_BYTES,
  PICTURE_SHA256,
  PositivePilotFailure,
  REAL_DEPENDENCIES,
  isEntryPoint,
  isTheExactPicture,
  main,
  parsePositivePilotArguments,
  runPositivePilot,
  verifyPublishedRun,
  type PositivePilotDependencies,
  type PositivePilotOptions,
  type PositivePilotOutcome,
  type PositivePilotSupervisor,
} from "../../../tools/native-cache-normal-pilot.js";
import {
  CACHE_PROCESS_PROTOCOL,
  CacheProcessSupervisor,
  canonicalCacheReceiptItem,
} from "../../../src/adapters/openfilm/cache-process-supervisor.js";
import type {
  CacheCleanupInspection,
  CacheDiagnosticSnapshot,
  CacheDrawHandle,
  CacheDrawRequest,
  CacheDrawSettlement,
  CacheLatchedOutcome,
  CacheCancelProvenance,
} from "../../../src/adapters/openfilm/cache-process-supervisor.js";

/**
 * The POSITIVE pilot of the native cache custodian, in PURE form.
 *
 * There is NO real C, NO real worker, NO real signal and NO real fork here: the
 * child, the clock, the filesystem and the supervisor are all INJECTED, and
 * the ORCHESTRATION of the pilot - the registry, the root, the copy of the
 * helper, the observation of the worker, the owned cancel, the finally and the
 * evidence - is the real one.
 *
 * The tool NEVER kills anything: it asks the supervisor to cancel the very same
 * handle, and the case proves that it asks and does nothing else.
 *
 * The REPORTING BOUNDARY is not a stub either: it is the ACTUAL factory of the
 * reviewed nofork pilot, and it is driven with a destination of the shape of
 * the real one - a stream that may fail and a write that carries a callback.
 *
 * The stub is FAITHFUL ABOUT THE ORDER of the real startup: a draw may be
 * PENDING for a while before it settles, and the accepted worker may appear
 * only after the custodian really said its hello. A stub that settles the draw
 * inside `start` would hide every ordering defect of the tool.
 */

/**
 * The RAW EDGES of this suite: the calls into the operating system that a
 * PURE case may never make.
 *
 * A raw edge is a signal, a spawn, a fork or an exec. They are DENIED BY
 * DEFAULT: a case that needs one installs an EXPLICIT script, and it says so
 * in the case itself.
 *
 * The ledger of the refusals is SEPARATE from the case, because the
 * production catches the errors of its own kernel calls: a refusal that a
 * production `catch` swallowed would let the case look green. Every case
 * asserts, at its end, that the ledger holds EXACTLY what it declared.
 */
interface RawEdgeState {
  /** The raw edges that were refused. */
  readonly denials: string[];
  /** The raw edges that a case SCRIPTED, in order. */
  readonly scriptedCalls: { readonly operation: string; readonly detail: string }[];
  /** The script of the ONE raw signal edge, when a case needs it. */
  scriptedKill: ((pid: number, signal: NodeJS.Signals | number) => boolean) | null;
  /** The refusals that the running case declared. */
  expectedDenials: string[];
}

const RAW_EDGE_GUARD_MARKER = Symbol.for("narralens.pure-raw-edge-guard");

// The state is built INSIDE the hoisted callback: a hoisted callback runs
// before the module body, and it may not touch a top-level binding that is
// not initialised yet.
const rawEdges = vi.hoisted((): RawEdgeState => {
  const key = Symbol.for("narralens.pure-raw-edge-state");
  const holder = globalThis as unknown as Record<symbol, RawEdgeState | undefined>;
  const existing = holder[key];
  if (existing !== undefined) return existing;
  const state: RawEdgeState = {
    denials: [],
    scriptedCalls: [],
    scriptedKill: null,
    expectedDenials: [],
  };
  holder[key] = state;
  return state;
});

/** REFUSE one raw edge of the operating system, and RECORD the refusal. */
function denyRawEdge(operation: string): never {
  rawEdges.denials.push(operation);
  throw new Error(`the raw edge ${operation} is denied in this suite`);
}

/**
 * Install the guards of the raw edges, BEFORE any case may have an effect.
 *
 * The guard is never removed: a fake operation that is still pending when a
 * case ends is still inside the guarded world.
 */
function installRawEdgeGuards(): void {
  const guard = process.kill as unknown as Record<symbol, unknown>;
  if (guard[RAW_EDGE_GUARD_MARKER] === true) return;
  process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
    const number = signal ?? 0;
    if (scriptedGroupProbe !== null && number === 0 && pid === -scriptedGroupProbe.pgid) {
      rawEdges.scriptedCalls.push({ operation: "process.kill", detail: `${pid}/${String(number)}` });
      if (scriptedGroupProbe.answer === "gone") {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      }
      return true;
    }
    if (rawEdges.scriptedKill !== null) {
      const scripted = rawEdges.scriptedKill(pid, number);
      rawEdges.scriptedCalls.push({
        operation: "process.kill",
        detail: `${pid}/${String(number)}`,
      });
      return scripted;
    }
    return denyRawEdge(`process.kill(${pid}, ${String(number)})`);
  }) as typeof process.kill;
  (process.kill as unknown as Record<symbol, unknown>)[RAW_EDGE_GUARD_MARKER] = true;
}

installRawEdgeGuards();

/**
 * The GROUP PROBE that the running case scripted, if any.
 *
 * It is ONE exact synthetic group and ONE answer: a probe of another number
 * is still REFUSED, and it is never an arbitrary "gone".
 */
let scriptedGroupProbe: { readonly pgid: number; readonly answer: "gone" | "present" } | null = null;

/**
 * Script the GROUP PROBE of the production for ONE exact synthetic group.
 *
 * The case that needs it says so, and it says WHICH group and WHICH answer.
 * Everything else stays refused.
 */
function scriptGroupProbe(pgid: number, answer: "gone" | "present"): void {
  scriptedGroupProbe = { pgid, answer };
}

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  fork: (...args: unknown[]) => denyRawEdge("child_process.fork"),
  exec: (...args: unknown[]) => denyRawEdge("child_process.exec"),
  execFile: (...args: unknown[]) => denyRawEdge("child_process.execFile"),
  execSync: (...args: unknown[]) => denyRawEdge("child_process.execSync"),
  execFileSync: (...args: unknown[]) => denyRawEdge("child_process.execFileSync"),
  spawnSync: (...args: unknown[]) => denyRawEdge("child_process.spawnSync"),
}));

/**
 * The /proc of the cases: the ONLY thing that is faked at the kernel boundary.
 *
 * A process that is not in the table does not exist, and a process that was
 * closed does not exist any more: that is how the REAL kernel behaves.
 */
const procOverride = vi.hoisted(() => ({
  identities: new Map<number, string>(),
  gone: new Set<number>(),
}));

/**
 * The reads of the cases that FAIL on purpose.
 *
 * The failure is injected at the READ BOUNDARY of the filesystem and only
 * for the path that the case armed: the mapper of the artifacts is the REAL
 * one, and it is the mapper that writes the errored row.
 */
const readFailures = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (path: string, options?: unknown) => {
      const failure = readFailures.get(path);
      if (failure !== undefined) {
        throw Object.assign(new Error(`the read of ${path} failed`), { code: failure });
      }
      const match = /^\/proc\/(\d+)\/stat$/u.exec(path);
      if (match !== null) {
        const pid = Number(match[1]);
        const text = procOverride.gone.has(pid) ? undefined : procOverride.identities.get(pid);
        if (text === undefined) {
          throw Object.assign(new Error("no such process"), { code: "ENOENT" });
        }
        return text;
      }
      return actual.readFileSync(path, options as never);
    },
  };
});

/** One /proc/<pid>/stat text, with the fields this module reads. */
function statText(
  pid: number,
  comm: string,
  state: string,
  ppid: number,
  pgrp: number,
  session: number,
  startTicks: number,
): string {
  const tail = [
    state, String(ppid), String(pgrp), String(session),
    ...Array.from({ length: 15 }, () => "0"),
    String(startTicks),
  ];
  return `${pid} (${comm}) ${tail.join(" ")}`;
}

const CUSTODIAN_SHA = "a".repeat(64);
/**
 * The digest of the REVIEWED helper of the cases.
 *
 * It is the digest of the bytes that the cases REALLY write as the copy of
 * the helper: a stub that claims a digest for bytes that are not there is a
 * stub that cannot be verified, and the joint checker reads the bytes.
 */
const HELPER_BYTES = Buffer.from("the copied helper of the run\n", "utf8");
const FIXTURE_SHA = createHash("sha256").update(HELPER_BYTES).digest("hex");
/**
 * The budget of the cases that drive the REAL supervisor over the REAL
 * protocol with REAL timers.
 *
 * It is NOT a semantic deadline: the cleanup deadlines of the production are
 * longer than the default budget of a test, and a loaded machine may exceed
 * it. A case that really fails still fails - it does not hang.
 */
const REAL_SUPERVISOR_CASE_TIMEOUT_MS = 20_000;

const WORKER_PID = 4242;
const WORKER_TICKS = 12345;
const WORKER_PPID = 100;
const TICKET_DIGEST = "d".repeat(64);

beforeEach(() => {
  // The group probe of the production is NOT scripted by default: a case that
  // needs it says so, with its own synthetic group.
  scriptedGroupProbe = null;
});

afterEach(() => {
  // The ledger of the raw edges is asserted at the end of EVERY case: a
  // refusal that the production caught and swallowed is still a fact, and the
  // case must see it. A case that expects one declares it exactly.
  //
  // The cleanup is in a `finally`: a case that FAILS must not leave its
  // ledger or its script behind for the next one, and the failure itself is
  // NOT hidden by the cleanup.
  try {
    expect(rawEdges.denials).toEqual(rawEdges.expectedDenials);
  } finally {
    rawEdges.denials.length = 0;
    rawEdges.expectedDenials = [];
    rawEdges.scriptedKill = null;
    rawEdges.scriptedCalls.length = 0;
    scriptedGroupProbe = null;
  }
  spawnMock.mockReset();
  PILOT_REGISTRY.clear();
});

/** A handle of a draw, as the pilot only ever reads it. */
function handleOf(settlement: Promise<CacheDrawSettlement>): CacheDrawHandle {
  return {
    get phase(): CacheDrawHandle["phase"] { return "reserved"; },
    get candidate_digest(): string | null { return null; },
    get cleanup_required(): boolean { return false; },
    settlement,
  };
}

/** The inspection of a draw that really ended. */
const SETTLED_INSPECTION: CacheCleanupInspection = {
  known: true,
  phase: "execution_settled",
  cleanup_required: false,
  settled: true,
  custodian_pid: 100,
  worker_pid: WORKER_PID,
  worker_start_ticks: String(WORKER_TICKS),
  group: WORKER_PID,
  session: WORKER_PID,
  group_members: 0,
  zombies: 0,
  finalize_after_ok: true,
  observed_signals: [],
  cleanup_failures: 0,
  latched_outcome: { kind: "none", code: null, message: null, native_phase: null },
  run_directory: "/tmp/pilot-root",
  receipt_valid: true,
};

/** The inspection of a draw that is HELD: its end is not proven. */
const HELD_INSPECTION: CacheCleanupInspection = {
  ...SETTLED_INSPECTION,
  phase: "cleanup_required",
  cleanup_required: true,
  settled: false,
  receipt_valid: false,
};

/**
 * A supervisor that is a SCRIPT.
 *
 * It implements EXACTLY the surface the pilot uses, so the pilot may be driven
 * without a process: a draw that succeeds, a draw that fails, a draw that is
 * held, a draw that ends later and a draw whose worker is accepted LATER.
 *
 * It models the REAL production of the cancel: the ORIGINAL error object is
 * kept, the latch is the cancel of the owner, the provenance says whether the
 * cancel became the PRIMARY outcome, and the settlement does NOT arrive at
 * once - it arrives when the domain really ended.
 */
class StubSupervisor implements PositivePilotSupervisor {
  readonly calls: string[] = [];
  readonly cancelErrors: unknown[] = [];
  readonly handle: CacheDrawHandle;
  private resolveSettlement: ((settlement: CacheDrawSettlement) => void) | null = null;
  private settled = false;
  private held = false;
  private pollCount = 0;
  private ticks = 0;
  private latched: CacheLatchedOutcome = { kind: "none", code: null, message: null, native_phase: null };
  private cancelProvenance: CacheCancelProvenance | null = null;
  private pendingError: unknown = null;
  private hasPending = false;

  constructor(private readonly behaviour: {
    readonly picture: Buffer | null;
    readonly error: unknown;
    readonly held: boolean;
    readonly worker: boolean;
    readonly settlesAfterPolls: number;
    /** Whether the start settles the draw by itself. */
    readonly settlesOnStart?: boolean;
    /** A failure that was ALREADY latched before the cancel of the owner. */
    readonly latchedBefore?: CacheLatchedOutcome;
    /** The transport failure of the draw, when there was one. */
    readonly transportFailure?: CacheDiagnosticSnapshot["transport_failure"];
    /** The code of the failure of the reserve, when the reserve fails. */
    readonly reserveFailure?: string;
    /**
     * Whether the cancel of the owner settles the draw at once.
     *
     * The REAL production does not: the settlement comes when the domain
     * really ended, and a draw that is held stays held until the owner
     * reconciles it.
     */
    readonly settlesOnCancel?: boolean;
    /** The tick after which the accepted worker appears. */
    readonly workerAppearsAfterTicks?: number;
    /** The raw cleanup facts of the settlement. */
    readonly cleanup?: readonly unknown[];
    /**
     * Whether the settlement of the draw carries a WRAPPER of the original
     * error instead of the original error itself.
     *
     * The wrapper is a legal shape: the producer accepts it, and the joint
     * checker must accept it too - the relation is the direct cause, never
     * the text of the two errors.
     */
    readonly settlementWrapper?: boolean;
    /** The cleanup failures of the FINAL diagnostic. */
    readonly snapshotCleanupFailures?: number;
  }) {
    this.held = behaviour.held;
    if (behaviour.latchedBefore !== undefined) this.latched = behaviour.latchedBefore;
    this.handle = handleOf(new Promise<CacheDrawSettlement>((resolveOne) => {
      this.resolveSettlement = resolveOne;
    }));
  }

  reserve(_request: CacheDrawRequest): CacheDrawHandle {
    this.calls.push("reserve");
    if (this.behaviour.reserveFailure !== undefined) {
      throw Object.assign(new Error("the reserve failed"), { code: this.behaviour.reserveFailure });
    }
    return this.handle;
  }

  start(_handle: CacheDrawHandle): Promise<CacheDrawSettlement> {
    this.calls.push("start");
    this.ticks += 1;
    if (!this.behaviour.held && this.behaviour.settlesOnStart !== false) {
      this.settled = true;
      this.resolveSettlement?.({
        picture: this.behaviour.picture,
        error: this.behaviour.error,
        cleanup: [...(this.behaviour.cleanup ?? [])],
      });
    }
    return this.handle.settlement;
  }

  inspectCleanup(_handle: unknown): CacheCleanupInspection {
    this.calls.push("inspect");
    this.ticks += 1;
    this.#settleIfPending();
    return this.settled ? SETTLED_INSPECTION : HELD_INSPECTION;
  }

  async reconcileCleanup(_handle: unknown): Promise<CacheCleanupInspection> {
    this.calls.push("reconcile");
    this.ticks += 1;
    this.pollCount += 1;
    if (this.pollCount >= this.behaviour.settlesAfterPolls) {
      this.settled = true;
      // The settlement carries the failure of the cancel of the owner when
      // there was one: the production latches it as the primary outcome.
      const error = this.hasPending ? this.pendingError : this.behaviour.error;
      this.resolveSettlement?.({
        picture: this.behaviour.picture,
        error,
        cleanup: [...(this.behaviour.cleanup ?? [])],
      });
      return SETTLED_INSPECTION;
    }
    this.#settleIfPending();
    return this.settled ? SETTLED_INSPECTION : HELD_INSPECTION;
  }

  requestCancel(_handle: unknown, originalError: unknown): void {
    this.calls.push("cancel");
    this.cancelErrors.push(originalError);
    if (this.settled) return;
    // The REAL production keeps the ORIGINAL error object when the cancel is
    // the FIRST failure, and it does not settle the draw at once.
    if (this.latched.kind !== "failure" && originalError !== null && originalError !== undefined) {
      const record = originalError as { name?: unknown; message?: unknown; code?: unknown };
      const message = String(record.message ?? originalError);
      this.latched = {
        kind: "failure",
        code: "DRAW_CANCELLED",
        message: `the draw was cancelled by its owner: ${message}`,
        native_phase: null,
      };
      this.cancelProvenance = {
        code: "DRAW_CANCELLED",
        message,
        error_name: String(record.name ?? "Error"),
        error_code: typeof record.code === "string" ? record.code : null,
        accepted_as_primary: true,
        superseded_by_earlier_failure: false,
      };
      this.pendingError = this.behaviour.settlementWrapper === true
        ? Object.assign(new Error("the settlement of the cancelled draw"), { cause: originalError })
        : originalError;
      this.hasPending = true;
    }
  }

  diagnosticSnapshot(_handle: unknown): CacheDiagnosticSnapshot {
    this.calls.push("snapshot");
    this.ticks += 1;
    const accepted = this.behaviour.worker
      && this.ticks >= (this.behaviour.workerAppearsAfterTicks ?? 0);
    return {
      known: true,
      phase: "drawing",
      settled: this.settled,
      cleanup_required: this.held && !this.settled,
      draw_id: "draw-0000000000000000",
      ticket_digest: TICKET_DIGEST,
      custodian: { pid: 100, ppid: 7, pgid: 100, sid: 100, start_ticks: 10, state: "S" },
      custodian_born: true,
      custodian_closed: false,
      custodian_exit: null,
      worker: accepted
        ? { pid: WORKER_PID, ppid: WORKER_PPID, pgid: WORKER_PID, sid: WORKER_PID, start_ticks: WORKER_TICKS, state: "S" }
        : null,
      forked: accepted,
      forked_pid: accepted ? WORKER_PID : null,
      exec_ok: true,
      recorded_targets: [],
      receipt_summary: null,
      // The FAKE supervisor of this file computes NO digest: the values are
      // NULL, and they are never invented.
      accumulator_summary: {
        segments: 0, received: 0, events: 0, waits: 0, identities: 0, refused: false,
        events_digest: null, waits_digest: null, identities_digest: null,
      },
      latched_outcome: this.latched,
      cancel_provenance: this.cancelProvenance,
      cancel_secondary: null,
      cleanup_facts: [],
      // The MOCK terminal proof of the stub: it is an EXPLICIT mock fact of
      // this suite, and it is NOT a kernel proof - the production gate is
      // never relaxed for it. The observations are the ones the stub
      // simulated: the custodian and the worker really left in the mock.
      terminal_proof: this.settled ? {
        at: 1000,
        proven: true,
        truncated: false,
        observations: [
          {
            kind: "custodian-epoch", presence: "gone", pid: 100, at: 1000,
            start_ticks: "10", state: null, reason: null,
          },
          {
            kind: "worker-epoch", presence: "gone", pid: WORKER_PID, at: 1000,
            start_ticks: String(WORKER_TICKS), state: null, reason: null,
          },
        ],
      } : null,
      observed_signals: [],
      cleanup_failures: this.behaviour.snapshotCleanupFailures ?? 0,
      run_directory: "/tmp/pilot-root",
      transport_failure: this.behaviour.transportFailure ?? null,
    };
  }

  /** The settlement of a cancel arrives when the domain really ended. */
  #settleIfPending(): void {
    if (this.settled || !this.hasPending) return;
    if (this.behaviour.settlesOnCancel === false) return;
    this.settled = true;
    this.resolveSettlement?.({
      picture: this.behaviour.picture,
      error: this.pendingError,
      cleanup: [...(this.behaviour.cleanup ?? [])],
    });
  }
}

/** The root of the files of a case. It is the root of the run. */
const CASE_ROOT = "/tmp/pilot-root";

/** The digest of a set of bytes. */
function digestOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The boundaries of a case: the clock, the filesystem and the supervisor.
 *
 * The filesystem of a case holds the ACTUAL bytes of the records: a case
 * reads them back, and it never keeps a mutable reference to an object that
 * a later error could change under it.
 */
function depsOf(
  supervisor: PositivePilotSupervisor,
  overrides: Partial<PositivePilotDependencies> = {},
): { deps: PositivePilotDependencies; state: { evidence: { name: string; bytes: Buffer }[]; stderr: string[]; scenario: string | null; copied: string | null; files: Map<string, Buffer> } } {
  const state = {
    evidence: [] as { name: string; bytes: Buffer }[],
    stderr: [] as string[],
    scenario: null as string | null,
    copied: null as string | null,
    files: new Map<string, Buffer>(),
  };
  // The clock of the case: it only moves when the pilot waits, and it moves
  // far enough for a bounded wait to end.
  const clock = { now: 0 };
  // The facts of a file of the case: the digest of the bytes that are really
  // there, and their number. A file that is not there has NO facts.
  const defaultFileFacts = (path: string): { sha256: string; bytes: number } | null => {
    if (path.includes("cache-process-custodian.py")) return { sha256: CUSTODIAN_SHA, bytes: 4096 };
    const bytes = state.files.get(path);
    if (path.endsWith("cache-worker-fixture.mjs")) {
      // The COPY of the helper is the bytes that the case really wrote, and
      // the SOURCE of it is the reviewed one: they have the same digest, and
      // the same number of bytes.
      return bytes === undefined
        ? { sha256: FIXTURE_SHA, bytes: HELPER_BYTES.length }
        : { sha256: digestOf(bytes), bytes: bytes.length };
    }
    return bytes === undefined ? null : { sha256: digestOf(bytes), bytes: bytes.length };
  };
  // The facts of a file are ONE boundary: the manifest and the links of the
  // final record read them through the SAME one, so that a case that
  // replaces it replaces both of them.
  const fileFactsOf = overrides.fileFacts ?? defaultFileFacts;
  const deps: PositivePilotDependencies = {
    createSupervisor: () => supervisor,
    createRoot: () => CASE_ROOT,
    prepareRoot: () => { /* the preparation of the root */ },
    copyHelper: (_source, destination) => {
      // The COPY of the helper is a real file of the case: the manifest names
      // it, and the digest of the manifest is the digest of these bytes.
      state.files.set(destination, HELPER_BYTES);
      state.copied = destination;
    },
    writeScenario: (_root, scenario) => {
      state.scenario = scenario;
      state.files.set(join(CASE_ROOT, "cache-worker-fixture.scenario"), Buffer.from(`${scenario}\n`, "utf8"));
    },
    fileFacts: fileFactsOf,
    readBytes: (path) => state.files.get(path) ?? null,
    writeEvidence: (_root, name, data) => {
      // The bytes that are REALLY written. The case reads them back.
      const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8");
      state.files.set(join(CASE_ROOT, name), bytes);
      state.evidence.push({ name, bytes });
    },
    publishEvidence: (_root, name, data) => {
      const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8");
      state.files.set(join(CASE_ROOT, name), bytes);
      state.evidence.push({ name, bytes });
      return { bytes: bytes.length, sha256: digestOf(bytes) };
    },
    artifactFacts: () => ({
      artifacts: [...state.files.entries()]
        .filter(([path]) => path.startsWith(`${CASE_ROOT}/`))
        .map(([path, bytes]) => {
          const facts = fileFactsOf(path);
          return {
            name: path.slice(`${CASE_ROOT}/`.length),
            digest: facts === null ? null : facts.sha256,
            bytes: facts === null ? null : facts.bytes,
            error: facts === null ? {
              name: "Error",
              message: `the digest of ${path.slice(`${CASE_ROOT}/`.length)} could not be read`,
              code: "EIO",
            } : null,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
      error: null,
    }),
    readHelperEvents: () => [{ event: "go", pid: WORKER_PID, ticket_digest: TICKET_DIGEST }],
    observeIdentity: () => ({
      presence: "known",
      identity: {
        pid: WORKER_PID,
        ppid: WORKER_PPID,
        pgid: WORKER_PID,
        sid: WORKER_PID,
        start_ticks: String(WORKER_TICKS),
        state: "S",
      },
    }),
    now: () => clock.now,
    sleep: async (milliseconds) => { clock.now += Math.max(milliseconds, 1000); },
    writeStderr: (text, callback) => {
      state.stderr.push(text);
      if (typeof callback === "function") callback(undefined);
    },
    reportStream: null,
    custodianPath: "/repo/src/adapters/openfilm/cache-process-custodian.py",
    fixtureSource: "/repo/tests/agent-driven/integration/helpers/cache-worker-fixture.mjs",
    vendorRoot: "/nonexistent/vendor",
    producerFile: "packages/openfilm/studio/server/pageframes.mjs",
    producerSha256: "0".repeat(64),
    pythonExecutable: "/usr/bin/python3.12",
    ...overrides,
  };
  return { deps, state };
}

/**
 * The evidence of a run, by its name.
 *
 * It is read back from the bytes that were REALLY written: a case never
 * keeps the object that was handed to the writer, because a later error
 * could change it under the case.
 */
function evidenceOf(
  state: { evidence: { name: string; bytes: Buffer }[] },
  name: string,
): Record<string, unknown> | null {
  const entry = state.evidence.find(item => item.name === name);
  if (entry === undefined) return null;
  return JSON.parse(entry.bytes.toString("utf8")) as Record<string, unknown>;
}

/** The ACTUAL bytes of a record of a run, or null. */
function evidenceBytes(
  state: { evidence: { name: string; bytes: Buffer }[] },
  name: string,
): Buffer | null {
  const entry = state.evidence.find(item => item.name === name);
  return entry === undefined ? null : entry.bytes;
}

const OPTIONS: PositivePilotOptions = {
  mode: "normal",
  expectedCustodianSha256: CUSTODIAN_SHA,
  expectedFixtureSha256: FIXTURE_SHA,
};

/**
 * The digest of the REVIEWED helper.
 *
 * It is an EXPLICIT constant of this file: a case that hashes the bytes it
 * is about to use signs its own bytes, and it proves nothing.
 */
const REVIEWED_FIXTURE_SHA256 =
  "e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab";

/**
 * The digest of the REVIEWED custodian.
 *
 * It is an EXPLICIT constant as well. It was updated with the R5E repair of
 * the original group proof: the custodian really changed, and the pin
 * follows it.
 */
const REVIEWED_CUSTODIAN_SHA256 =
  "40947936b36f94ea53b00ecf4f851c528484cea457f1ed4fef7aa031bba896a9";

/**
 * The REAL boundaries of the tool, with a REAL temporary root of the case.
 *
 * The filesystem of these cases is the real one: the records are really
 * written, the digests are really computed, and the publication really
 * renames a temporary file of the root.
 */
function realFsDeps(
  supervisor: PositivePilotSupervisor,
  overrides: Partial<PositivePilotDependencies> = {},
): { deps: PositivePilotDependencies; root: string } {
  const root = mkdtempSync(join(tmpdir(), "narralens-pilot-"));
  const clock = { now: 0 };
  // The supervisor and the protocol of the case are the STUB ones, and the
  // FILESYSTEM of the case is the real one: the records are really written,
  // the digests are really computed and the publication really renames a
  // temporary file of the root.
  const { deps: stubDeps } = depsOf(supervisor);
  const deps: PositivePilotDependencies = {
    ...stubDeps,
    createRoot: () => root,
    copyHelper: REAL_DEPENDENCIES.copyHelper,
    writeScenario: REAL_DEPENDENCIES.writeScenario,
    fileFacts: REAL_DEPENDENCIES.fileFacts,
    readBytes: REAL_DEPENDENCIES.readBytes,
    writeEvidence: REAL_DEPENDENCIES.writeEvidence,
    publishEvidence: REAL_DEPENDENCIES.publishEvidence,
    artifactFacts: REAL_DEPENDENCIES.artifactFacts,
    // The REVIEWED bytes of the repository are the ones of the case: the
    // custodian and the helper are really read, really copied and really
    // verified against their pins.
    custodianPath: REAL_DEPENDENCIES.custodianPath,
    fixtureSource: REAL_DEPENDENCIES.fixtureSource,
    now: () => clock.now,
    sleep: async (milliseconds) => { clock.now += Math.max(milliseconds, 1000); },
    writeStderr: (_text, callback) => { if (typeof callback === "function") callback(undefined); },
    reportStream: null,
    ...overrides,
  };
  return { deps, root };
}

/**
 * Change ONE field of ONE record, at the WRITE edge of the REAL writer.
 *
 * The copy is made before the real writer or the real publisher serializes
 * it: the bytes that are really written are the bytes of the changed record,
 * and the real mapper, the real digests and the real lengths correspond to
 * them. No hash is forged anywhere, and the checker reads the real bytes.
 */
function tamperWith(
  deps: PositivePilotDependencies,
  recordName: string,
  change: (record: Record<string, unknown>) => void,
): PositivePilotDependencies {
  return {
    ...deps,
    writeEvidence: (root, name, data) => {
      if (name !== recordName) {
        deps.writeEvidence(root, name, data);
        return;
      }
      const record = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
      change(record);
      deps.writeEvidence(root, name, record);
    },
    publishEvidence: (root, name, data) => {
      if (name !== recordName) return deps.publishEvidence(root, name, data);
      const record = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
      change(record);
      return deps.publishEvidence(root, name, record);
    },
  };
}

describe("the arguments of the positive pilot", () => {
  it("takes exactly a mode and two digests", () => {
    expect(PILOT_MODES).toEqual(["normal", "assertion-failure"]);
    const options = parsePositivePilotArguments([
      "--mode", "normal",
      "--expected-custodian-sha256", CUSTODIAN_SHA,
      "--expected-fixture-sha256", FIXTURE_SHA,
    ]);
    expect(options.mode).toBe("normal");
    for (const argv of [
      ["--mode", "production", "--expected-custodian-sha256", CUSTODIAN_SHA, "--expected-fixture-sha256", FIXTURE_SHA],
      ["--mode", "normal", "--expected-custodian-sha256", CUSTODIAN_SHA],
      ["--mode", "normal", "--expected-custodian-sha256", "not-a-digest", "--expected-fixture-sha256", FIXTURE_SHA],
      ["--pid", "1", "--mode", "normal", "--expected-custodian-sha256", CUSTODIAN_SHA, "--expected-fixture-sha256", FIXTURE_SHA],
      ["--exec", "/bin/true", "--mode", "normal", "--expected-custodian-sha256", CUSTODIAN_SHA, "--expected-fixture-sha256", FIXTURE_SHA],
    ]) {
      expect(() => parsePositivePilotArguments(argv)).toThrow(PositivePilotFailure);
    }
  });

  it("does not run the pilot when its module is imported", () => {
    expect(isEntryPoint()).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("the positive pilot", () => {
  it("really succeeds, and the picture is EXACTLY the synthetic one", async () => {
    const picture = Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE);
    const supervisor = new StubSupervisor({ picture, error: null, held: false, worker: true, settlesAfterPolls: 0 });
    const { deps, state } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).toBe("ok");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.terminalProof).toBe(true);
    expect(outcome.pictureIsTheExactOne).toBe(true);
    expect(outcome.pictureSha256).toBe(PICTURE_SHA256);
    expect(outcome.pictureBytes).toBe(PICTURE_BYTES);
    // The root was registered, the helper was copied next to the copy and the
    // scenario of the normal mode was written there.
    expect(PILOT_REGISTRY.get("/tmp/pilot-root")).toBeDefined();
    expect(state.copied).toBe("/tmp/pilot-root/cache-worker-fixture.mjs");
    expect(state.scenario).toBe("normal");
    // The evidence of the run is in the root: the CANDIDATE facts, the
    // manifest of the artifacts and the FINAL qualification.
    const names = state.evidence.map(entry => entry.name);
    expect(names).toContain("candidate.json");
    expect(names).toContain("manifest.json");
    expect(names).toContain("final.json");
    // And NOTHING was killed: the pilot only asks the supervisor to cancel.
    expect(supervisor.calls).not.toContain("kill");
  });

  it("is NOT a success when the picture is not the exact one", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, 0x41),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).not.toBe("ok");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.pictureIsTheExactOne).toBe(false);
    expect(isTheExactPicture(Buffer.alloc(PICTURE_BYTES, 0x41))).toBe(false);
    expect(isTheExactPicture(Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE))).toBe(true);
    expect(isTheExactPicture(null)).toBe(false);
  });

  it("refuses bytes that are not the reviewed ones, and starts nothing", async () => {
    const supervisor = new StubSupervisor({ picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0 });
    const { deps } = depsOf(supervisor, {
    // ONLY the custodian is not the reviewed one: the records of the run keep
    // their own digests, and the LINKS between them stay true.
    fileFacts: (path) => (path.includes("cache-process-custodian.py")
      ? { sha256: "c".repeat(64), bytes: 16 }
      : { sha256: FIXTURE_SHA, bytes: 8192 }),
  });
    // The refusal is INSIDE the one try of the run: it is a failure of the
    // run and not an exception that escapes it.
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).toBe("failed");
    // The run refused BEFORE its helper was copied, so its manifest does not
    // name a required artifact: the mandatory evidence of the run is not
    // reliable, and the protocol answers 3 for that. The ORIGINAL failure of
    // the run is kept as it is - it is not replaced by the exit code.
    expect(outcome.exitCode).toBe(3);
    expect(outcome.authoritative).toBe(false);
    expect((outcome.originalFailure as { code?: unknown }).code).toBe("CUSTODIAN_NOT_REVIEWED");
    // Nothing was started: the supervisor was never asked for anything.
    expect(supervisor.calls).toEqual([]);
  });

  it("refuses a COPY of the helper that is not the reviewed one, and starts nothing", async () => {
    const supervisor = new StubSupervisor({ picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0 });
    const { deps } = depsOf(supervisor, {
      fileFacts: (path) => ({
        sha256: path.includes("custodian") ? CUSTODIAN_SHA : (path.includes("pilot-root") ? "e".repeat(64) : FIXTURE_SHA),
        bytes: 16,
      }),
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect((outcome.originalFailure as { code?: unknown }).code).toBe("FIXTURE_COPY_NOT_REVIEWED");
    expect(supervisor.calls).toEqual([]);
  });

  it("injects the deliberate failure only after the worker was REALLY alive", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps, state } = depsOf(supervisor);
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    // The scenario of the deliberate mode is the SILENT one: the worker says
    // hello, takes the authorisation and stays.
    expect(state.scenario).toBe("silent");
    // The cancel was asked for with the EXACT deliberate failure.
    expect(supervisor.calls).toContain("cancel");
    expect(supervisor.cancelErrors.length).toBe(1);
    expect((supervisor.cancelErrors[0] as { code?: unknown }).code).toBe(EXPECTED_ASSERTION_FAILURE);
    // The case is the expected fault, and its exit code is 1 - not 0.
    expect(outcome.kind).toBe("fault-observed");
    expect(outcome.faultCasePassed).toBe(true);
    expect(outcome.exitCode).toBe(1);
    // The settlement of the draw is THE SAME error object as the deliberate
    // failure: the original error was kept, and it was not replaced.
    expect(outcome.settlementFailure).toBe(outcome.originalFailure);
  });

  it("does NOT inject the deliberate failure when the worker was not observed", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: false, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    expect((supervisor.cancelErrors[0] as { code?: unknown }).code).toBe("WORKER_NOT_OBSERVED");
    // The case is a FAILURE: an expected fault that was never observed is not
    // an expected fault.
    expect(outcome.kind).toBe("failed");
    expect(outcome.faultCasePassed).toBe(false);
    expect(outcome.exitCode).toBe(1);
  });

  it.each([
    ["a GO of another worker", { event: "go", pid: WORKER_PID + 1, ticket_digest: TICKET_DIGEST }],
    ["a GO of another draw", { event: "go", pid: WORKER_PID, ticket_digest: "e".repeat(64) }],
  ])("does NOT inject the deliberate failure after %s", async (_what, goEvent) => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps } = depsOf(supervisor, { readHelperEvents: () => [goEvent] });
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    expect((supervisor.cancelErrors[0] as { code?: unknown }).code).toBe("WORKER_NOT_OBSERVED");
    expect(outcome.kind).toBe("failed");
    expect(outcome.faultCasePassed).toBe(false);
  });

  it.each([
    ["a zombie", { pid: WORKER_PID, ppid: WORKER_PPID, pgid: WORKER_PID, sid: WORKER_PID, start_ticks: String(WORKER_TICKS), state: "Z" }],
    ["another start time", { pid: WORKER_PID, ppid: WORKER_PPID, pgid: WORKER_PID, sid: WORKER_PID, start_ticks: "999", state: "S" }],
    ["another parent", { pid: WORKER_PID, ppid: 999, pgid: WORKER_PID, sid: WORKER_PID, start_ticks: String(WORKER_TICKS), state: "S" }],
    ["another group", { pid: WORKER_PID, ppid: WORKER_PPID, pgid: 777, sid: WORKER_PID, start_ticks: String(WORKER_TICKS), state: "S" }],
  ])("does NOT inject the deliberate failure when the worker is %s", async (_what, identity) => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps } = depsOf(supervisor, {
      observeIdentity: () => ({ presence: "known", identity }),
    });
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    expect((supervisor.cancelErrors[0] as { code?: unknown }).code).toBe("WORKER_NOT_OBSERVED");
    expect(outcome.faultCasePassed).toBe(false);
  });

  it("does NOT accept an unrelated failure as the expected fault", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
      latchedBefore: { kind: "failure", code: "WORKER_FAILED", message: "the worker failed", native_phase: null },
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    // The cancel of the owner did NOT become the primary outcome: the case is
    // a failure and never an expected fault.
    expect(outcome.kind).toBe("failed");
    expect(outcome.faultCasePassed).toBe(false);
  });

  it("does NOT accept a transport failure as the expected fault", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
      transportFailure: { name: "Error", code: "EPIPE", message: "the pipe broke", stack: null, cause: null, phase: null },
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    expect(outcome.kind).toBe("failed");
    expect(outcome.faultCasePassed).toBe(false);
  });

  it("keeps a failure of the evidence, and it is never a green case", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps } = depsOf(supervisor, {
      writeEvidence: () => { throw Object.assign(new Error("the disk is full"), { code: "ENOSPC" }); },
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).not.toBe("ok");
    // A mandatory evidence that could not be written is NOT an ordinary
    // business failure: the protocol answers 3 for it, so that it may never
    // be read as the expected fault - which is also 1.
    expect(outcome.exitCode).toBe(3);
    expect(outcome.authoritative).toBe(false);
    expect(outcome.evidenceErrors.length).toBeGreaterThan(0);
    expect(outcome.evidenceErrors[0]?.error.code).toBe("ENOSPC");
  });

  it("keeps the owner of a HELD draw and ends with the fresh proof", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: true, worker: true, settlesAfterPolls: 2, settlesOnCancel: false,
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    // The draw was held, and the pilot polled the supervisor for the real
    // proof instead of giving the draw up.
    expect(supervisor.calls).toContain("reconcile");
    expect(outcome.terminalProof).toBe(true);
    // The owner was KEPT: the registry still holds the root, the supervisor,
    // the handle and the promise.
    const entry = PILOT_REGISTRY.get("/tmp/pilot-root");
    expect(entry).toBeDefined();
    expect(entry?.root).toBe("/tmp/pilot-root");
    expect(entry?.supervisor).toBe(supervisor);
    expect(entry?.startPromise).toBeDefined();
  });

  it("keeps the owner when the ROOT could not be prepared, and it starts nothing", async () => {
    const supervisor = new StubSupervisor({ picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0 });
    const { deps } = depsOf(supervisor, {
      prepareRoot: () => { throw Object.assign(new Error("the disk is full"), { code: "ENOSPC" }); },
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    // The root was REGISTERED before the preparation: the owner of it exists.
    expect(PILOT_REGISTRY.get("/tmp/pilot-root")).toBeDefined();
    expect(outcome.kind).toBe("failed");
    expect((outcome.originalFailure as { code?: unknown }).code).toBe("ENOSPC");
    // Nothing was started: there is no phantom child.
    expect(supervisor.calls).toEqual([]);
  });

  it("keeps the owner when the RESERVE failed, and there is no phantom child", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, reserveFailure: "ERESERVE",
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(PILOT_REGISTRY.get("/tmp/pilot-root")).toBeDefined();
    expect(outcome.kind).toBe("failed");
    expect((outcome.originalFailure as { code?: unknown }).code).toBe("ERESERVE");
    // The start was never asked for: there is no phantom child.
    expect(supervisor.calls).not.toContain("start");
  });

  it("reads the ORIGINAL result of a draw that was held and that ended LATE", async () => {
    const picture = Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE);
    const supervisor = new StubSupervisor({
      picture, error: null, held: true, worker: true, settlesAfterPolls: 3, settlesOnCancel: false,
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    // The picture of the LATE settlement was really read: a run that was held
    // and that recovered never loses the result of the draw it owned.
    expect(outcome.pictureSha256).toBe(PICTURE_SHA256);
    expect(outcome.pictureBytes).toBe(PICTURE_BYTES);
    expect(outcome.pictureIsTheExactOne).toBe(true);
    expect(outcome.terminalProof).toBe(true);
  });

  it("keeps the owner when the event reader failed after the start", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps } = depsOf(supervisor, {
      readHelperEvents: () => { throw Object.assign(new Error("the event file is broken"), { code: "EIO" }); },
    });
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    // The failure of the reader is a failure of the run, and the owner of the
    // draw was kept: the draw was cancelled and its settlement was awaited.
    expect((outcome.originalFailure as { code?: unknown }).code).toBe("EIO");
    expect(supervisor.calls).toContain("cancel");
    expect(outcome.kind).toBe("failed");
    expect(outcome.faultCasePassed).toBe(false);
  });

  it("never kills anything: it asks, and it does nothing else", async () => {
    const supervisor = new StubSupervisor({ picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0 });
    const { deps } = depsOf(supervisor);
    await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    const kinds = new Set(supervisor.calls);
    expect(kinds.has("cancel")).toBe(true);
    expect(kinds.has("kill")).toBe(false);
    expect(kinds.has("signal")).toBe(false);
  });

  it("does not lose the owner when the destination fails asynchronously", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, state } = depsOf(supervisor, {
      // The destination fails on a LATER turn, the way a pipe really does.
      writeStderr: (text, callback) => {
        if (typeof callback === "function") {
          setTimeout(() => { callback(Object.assign(new Error("EPIPE"), { code: "EPIPE" })); }, 0);
          return;
        }
      },
    });
    const code = await main([
      "--mode", "normal",
      "--expected-custodian-sha256", CUSTODIAN_SHA,
      "--expected-fixture-sha256", FIXTURE_SHA,
    ], deps);
    // The run really ended: the evidence of it was written, and the owner of
    // the draw was never lost.
    expect(state.evidence.map(entry => entry.name)).toContain("final.json");
    // The failure of the reporting is a fact of the case: it is never green,
    // and it has its OWN exit code - 3, so that it may never be read as the
    // expected fault.
    expect(code).toBe(3);
  });
});

describe("the real asynchronous order of the two modes", () => {
  it("does NOT cancel a draw that is still making progress", async () => {
    // The draw really is PENDING for a while: the custodian is still talking
    // to its worker. A pending draw is ORDINARY PROGRESS, not a failure.
    const picture = Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE);
    const supervisor = new StubSupervisor({
      picture, error: null, held: false, worker: true, settlesAfterPolls: 3, settlesOnStart: false,
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    // NOTHING was cancelled while the draw was pending.
    expect(supervisor.cancelErrors).toEqual([]);
    // And the natural result of the draw is the result of the run.
    expect(outcome.kind).toBe("ok");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.pictureIsTheExactOne).toBe(true);
    expect(outcome.terminalProof).toBe(true);
  });

  it("waits for the accepted worker before it injects the deliberate failure", async () => {
    // The worker is accepted LATER: the draw is STARTING, and a null worker
    // during the startup is not a failed observation.
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
      workerAppearsAfterTicks: 3,
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    // Exactly ONE cancel, and it is the deliberate failure.
    expect(supervisor.cancelErrors.length).toBe(1);
    expect((supervisor.cancelErrors[0] as { code?: unknown }).code).toBe(EXPECTED_ASSERTION_FAILURE);
    expect(outcome.kind).toBe("fault-observed");
    expect(outcome.faultCasePassed).toBe(true);
  });

  it("does NOT inject when the draw REALLY failed before the worker was accepted", async () => {
    // A real native failure of the draw is the OUTCOME: it is never masked by
    // the deliberate failure, and it is never called the expected fault.
    const failure = new PositivePilotFailure("WORKER_FAILED", "the worker really failed");
    const supervisor = new StubSupervisor({
      picture: null, error: failure, held: false, worker: true, settlesAfterPolls: 0,
      workerAppearsAfterTicks: 1_000_000,
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    expect((outcome.originalFailure as { code?: unknown }).code).toBe("WORKER_FAILED");
    expect(outcome.faultCasePassed).toBe(false);
    expect((supervisor.cancelErrors[0] as { code?: unknown }).code).not.toBe(EXPECTED_ASSERTION_FAILURE);
  });

  it("does NOT inject when the GO of this draw never arrives", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps } = depsOf(supervisor, { readHelperEvents: () => [] });
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    expect((supervisor.cancelErrors[0] as { code?: unknown }).code).toBe("WORKER_NOT_OBSERVED");
    expect(outcome.faultCasePassed).toBe(false);
  });
});

describe("the raw cleanup of the draw", () => {
  it("is NOT green when the raw settlement carries a cleanup failure", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
      cleanup: [Object.assign(new Error("the run directory could not be removed"), { code: "EIO" })],
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    // The picture was exact, and the case is STILL not green: a cleanup
    // failure is not erased by a good picture.
    expect(outcome.kind).not.toBe("ok");
    expect(outcome.exitCode).toBe(1);
    const cleanup = (outcome as unknown as { cleanupFacts?: readonly unknown[] }).cleanupFacts ?? [];
    expect(cleanup.length).toBeGreaterThan(0);
  });

  it("is NOT a fault when the raw settlement carries a cleanup failure", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
      cleanup: [Object.assign(new Error("the run directory could not be removed"), { code: "EIO" })],
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    expect(outcome.kind).not.toBe("fault-observed");
    expect(outcome.faultCasePassed).toBe(false);
  });

  it("is NOT green when the FINAL diagnostic carries cleanup failures", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
      snapshotCleanupFailures: 1,
    });
    const { deps } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).not.toBe("ok");
    expect(outcome.exitCode).toBe(1);
  });
});

describe("the ownership of the runtime root", () => {
  it("writes NO evidence at all when the root could not be allocated", async () => {
    const supervisor = new StubSupervisor({ picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0 });
    const { deps, state } = depsOf(supervisor, {
      createRoot: () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); },
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    // There is NO root: there is nothing that may own an evidence file, and
    // the working directory is NOT a substitute for a missing root.
    expect(state.evidence).toEqual([]);
    expect(outcome.root).toBeNull();
    // And there is NO phantom supervisor and NO phantom handle.
    expect(supervisor.calls).toEqual([]);
    expect(PILOT_REGISTRY.size).toBe(0);
  });
});

describe("the final qualification of a run", () => {
  it("commits the final qualification AFTER the report callbacks", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, state } = depsOf(supervisor);
    await runPositivePilot(OPTIONS, deps);
    const candidate = evidenceOf(state, "candidate.json");
    const manifest = evidenceOf(state, "manifest.json");
    const final = evidenceOf(state, "final.json");
    // The CANDIDATE facts are explicitly NOT authoritative.
    expect(candidate?.authoritative).toBe(false);
    // The FINAL record is the authority, and it names the candidate and the
    // manifest it was built from.
    expect(final?.authoritative).toBe(true);
    expect(final?.candidate_sha256).toBeTypeOf("string");
    expect(final?.manifest_sha256).toBeTypeOf("string");
    // The manifest lists the artifacts that really exist, and it says what it
    // EXCLUDES - itself and the final record, which is written after it.
    expect(Array.isArray(manifest?.artifacts)).toBe(true);
    expect(manifest?.excluded).toContain("manifest.json");
    expect(manifest?.excluded).toContain("final.json");
  });

  it("revokes the final qualification when the report destination fails LATE", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps, state } = depsOf(supervisor, {
      writeStderr: (text, callback) => {
        if (typeof callback === "function") {
          setTimeout(() => { callback(Object.assign(new Error("EPIPE"), { code: "EPIPE" })); }, 0);
          return;
        }
      },
    });
    const outcome = await runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    const final = evidenceOf(state, "final.json");
    // The final record says that the run is NOT the expected fault, even
    // though the exit code of the expected fault is 1 anyway.
    expect(final?.fault_case_passed).toBe(false);
    expect(final?.reporting_failure).not.toBeNull();
    expect(outcome.faultCasePassed).toBe(false);
    expect(outcome.kind).not.toBe("fault-observed");
    // And the ACTUAL checker refuses the run: a failed report is an
    // unreliable EVIDENCE (3), and never an ordinary failure (1).
    const verdict = verifyPublishedRun(outcome, outcome.root ?? "", deps.readBytes);
    expect(verdict.evidenceReliable).toBe(false);
    expect(verdict.accepted).toBe(false);
    expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
  });

  it("is NOT green when the manifest of the artifacts could not be built", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, state } = depsOf(supervisor, {
      artifactFacts: () => ({
        artifacts: [],
        error: { name: "Error", message: "the directory could not be read", code: "EIO" },
      }),
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    const final = evidenceOf(state, "final.json");
    // A required read that failed is NOT an empty manifest: the case is not
    // green and the final record says why.
    expect(final?.kind).not.toBe("ok");
    expect(outcome.kind).not.toBe("ok");
    // The manifest is a mandatory evidence: its failure is 3, and never the
    // exit code of the expected fault.
    expect(outcome.exitCode).toBe(3);
    expect(outcome.authoritative).toBe(false);
  });
});

/**
 * The JOINT publication of the final record.
 *
 * The final record is not a file that is written: it is a PUBLICATION - a
 * temporary file of the SAME root, a complete write, a successful close and
 * a rename - and the authority of a run is the conjunction of that
 * publication, the digests of the ACTUAL bytes and the exit code of the
 * protocol.
 *
 * A green looking record on the disk is NOT that authority: it is a fact
 * about a file, and the authority is what the run RETURNED.
 */
describe("the JOINT publication of a run", () => {
  it("publishes the final into the root of the run, and the temporary file is gone", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, state } = depsOf(supervisor);
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.publication.protocol).toBe(PILOT_PUBLICATION_PROTOCOL);
    expect(outcome.publication.published).toBe(true);
    expect(outcome.exitCode).toBe(PILOT_EXIT_OK);
    expect(outcome.authoritative).toBe(true);
    expect(outcome.publication.errors).toEqual([]);
    // The digest of the publication is the digest of the ACTUAL bytes, and
    // the three records are named by their own digests.
    const bytes = evidenceBytes(state, "final.json");
    expect(bytes).not.toBeNull();
    expect(outcome.publication.final_sha256).toBe(digestOf(bytes as Buffer));
    expect(outcome.publication.final_bytes).toBe((bytes as Buffer).length);
    expect(outcome.publication.candidate_sha256)
      .toBe(digestOf(evidenceBytes(state, "candidate.json") as Buffer));
    expect(outcome.publication.manifest_sha256)
      .toBe(digestOf(evidenceBytes(state, "manifest.json") as Buffer));
  });

  it("revokes the qualification when the publication fails BEFORE the bytes are written", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, state } = depsOf(supervisor, {
      publishEvidence: () => { throw Object.assign(new Error("the disk is full"), { code: "ENOSPC" }); },
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    // The publication failed: the run is not authoritative, the fault is not
    // the expected one, and the exit code is the one of an unreliable
    // evidence - 3, and NEVER the 1 of the expected fault.
    expect(outcome.kind).toBe("failed");
    expect(outcome.faultCasePassed).toBe(false);
    expect(outcome.authoritative).toBe(false);
    expect(outcome.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    expect(outcome.publication.published).toBe(false);
    expect(outcome.publication.errors.length).toBeGreaterThan(0);
    // And there is NO final record: the publication wrote nothing.
    expect(evidenceOf(state, "final.json")).toBeNull();
    // The ORIGINAL facts of the draw are kept: they are not replaced by the
    // failure of the publication.
    expect(outcome.pictureIsTheExactOne).toBe(true);
    expect(outcome.pictureBytes).toBe(PICTURE_BYTES);
  });

  it("revokes the qualification when the publication fails AFTER the complete write", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, state } = depsOf(supervisor, {
      publishEvidence: (_root, name, data) => {
        // The bytes are COMPLETE and they are on the disk - and the
        // publication fails anyway: the result of it is UNCERTAIN.
        const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8");
        state.files.set(join(CASE_ROOT, name), bytes);
        state.evidence.push({ name, bytes });
        throw Object.assign(new Error("the device is gone"), { code: "EIO" });
      },
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).toBe("failed");
    expect(outcome.faultCasePassed).toBe(false);
    expect(outcome.authoritative).toBe(false);
    expect(outcome.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    expect(outcome.publication.published).toBe(false);
    // A green looking record IS on the disk - and it is NOT the authority.
    // The run does not accept it, and it does not prove the failure by
    // overwriting it either.
    const final = evidenceOf(state, "final.json");
    expect(final?.authoritative).toBe(true);
    expect(outcome.authoritative).toBe(false);
    expect(outcome.publication.final_sha256).toBeNull();
  });

  it("is NOT green when a REQUIRED artifact of the manifest carries an error", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps } = depsOf(supervisor, {
      // The LISTING succeeded, and ONE required artifact could not be hashed:
      // the error is in the ROW, and the top level error is null.
      artifactFacts: () => ({
        artifacts: [
          { name: "candidate.json", digest: null, bytes: null, error: { name: "Error", message: "the digest of candidate.json could not be read", code: "EIO" } },
          { name: "cache-worker-fixture.mjs", digest: FIXTURE_SHA, bytes: 8192, error: null },
        ],
        error: null,
      }),
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).not.toBe("ok");
    expect(outcome.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    expect(outcome.authoritative).toBe(false);
    // And the problem is a bounded fact that names the artifact.
    expect(outcome.publication.errors.some(error => error.message.includes("candidate.json"))).toBe(true);
  });

  it("is NOT green when a REQUIRED artifact is missing from the manifest", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps } = depsOf(supervisor, {
      artifactFacts: () => ({
        artifacts: [
          { name: "cache-worker-fixture.mjs", digest: FIXTURE_SHA, bytes: 8192, error: null },
        ],
        error: null,
      }),
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).not.toBe("ok");
    expect(outcome.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    expect(outcome.publication.errors.some(error => error.message.includes("candidate.json"))).toBe(true);
  });

  it("is NOT green when the manifest does not name the digest of the candidate that is on the disk", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps } = depsOf(supervisor, {
      // The manifest names a digest that is NOT the digest of the candidate
      // that is really there: the LINK of the final record is broken.
      artifactFacts: () => ({
        artifacts: [
          { name: "candidate.json", digest: "0".repeat(64), bytes: 10, error: null },
          { name: "cache-worker-fixture.mjs", digest: FIXTURE_SHA, bytes: 8192, error: null },
        ],
        error: null,
      }),
    });
    const outcome = await runPositivePilot(OPTIONS, deps);
    expect(outcome.kind).not.toBe("ok");
    expect(outcome.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    expect(outcome.authoritative).toBe(false);
    expect(outcome.publication.errors.some(error => error.code === "EIDMATCH")).toBe(true);
  });

  it("answers 3 when the publication of the run failed", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps } = depsOf(supervisor, {
      publishEvidence: () => { throw Object.assign(new Error("the disk is full"), { code: "ENOSPC" }); },
    });
    const code = await main([
      "--mode", "normal",
      "--expected-custodian-sha256", CUSTODIAN_SHA,
      "--expected-fixture-sha256", FIXTURE_SHA,
    ], deps);
    // The publication is not reliable: the exit code is 3, and it is NOT the
    // exit code of the expected fault.
    expect(code).toBe(PILOT_EXIT_UNRELIABLE);
    expect(code).not.toBe(PILOT_EXIT_FAULT);
    expect(code).not.toBe(PILOT_EXIT_OK);
  });

  it("answers 2 for a refusal of the arguments, and 1 for a fault that was really observed", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps } = depsOf(supervisor);
    expect(await main(["--mode", "production"], deps)).toBe(PILOT_EXIT_REFUSED);
    const fault = await main([
      "--mode", "assertion-failure",
      "--expected-custodian-sha256", CUSTODIAN_SHA,
      "--expected-fixture-sha256", FIXTURE_SHA,
    ], deps);
    // The deliberate failure was really observed: the exit code is 1, and it
    // is a PASS - the publication of it was complete.
    expect(fault).toBe(PILOT_EXIT_FAULT);
  });

  it("the REAL filesystem: the final is published in the root of the run", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const code = await main([
        "--mode", "normal",
        "--expected-custodian-sha256", REVIEWED_CUSTODIAN_SHA256,
        "--expected-fixture-sha256", REVIEWED_FIXTURE_SHA256,
      ], deps);
      expect(code).toBe(PILOT_EXIT_OK);
      // The final is really there, and the temporary file of the publication
      // is NOT: a publication that completed leaves a record and nothing
      // else.
      expect(existsSync(join(root, "final.json"))).toBe(true);
      expect(existsSync(join(root, ".final.json.publishing"))).toBe(false);
      // And the record names the candidate and the manifest by the digests
      // of the bytes that are REALLY there.
      const final = JSON.parse(readFileSync(join(root, "final.json"), "utf8")) as Record<string, unknown>;
      expect(final.authoritative).toBe(true);
      expect(final.kind_of_run).toBe("ok");
      expect(final.publication_protocol).toBe(PILOT_PUBLICATION_PROTOCOL);
      expect(final.candidate_sha256).toBe(digestOf(readFileSync(join(root, "candidate.json"))));
      expect(final.manifest_sha256).toBe(digestOf(readFileSync(join(root, "manifest.json"))));
      // And the manifest names the required artifacts with their digests.
      const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
        artifacts: { name: string; digest: string | null; error: unknown }[];
      };
      const names = manifest.artifacts.map(artifact => artifact.name);
      expect(names).toContain("candidate.json");
      expect(names).toContain("cache-worker-fixture.mjs");
      for (const artifact of manifest.artifacts) {
        expect(artifact.error).toBeNull();
        expect(artifact.digest).toBeTypeOf("string");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a CONSUMER that applies the joint judgement rejects a run whose publication failed", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor, {
      // The publication fails AFTER the complete write: a green looking
      // final record IS on the disk.
      publishEvidence: (rootName, name, data) => {
        const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8");
        writeFileSync(join(rootName, name), bytes);
        throw Object.assign(new Error("the device is gone"), { code: "EIO" });
      },
    });
    try {
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      // The record on the disk really looks green.
      const final = JSON.parse(readFileSync(join(root, "final.json"), "utf8")) as Record<string, unknown>;
      expect(final.authoritative).toBe(true);
      expect(final.kind_of_run).toBe("ok");
      // And the ACTUAL checker rejects it: the conjunction is not satisfied.
      // This is the SAME function that the command and the legacy consumer
      // call - there is no copy of it in this file.
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.accepted).toBe(false);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      // And the run itself says so.
      expect(outcome.authoritative).toBe(false);
      expect(outcome.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the REAL filesystem: a required record that was not written is not a green case", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor, {
      // The candidate is LOST: the write of it does not happen.
      writeEvidence: (rootName, name, data) => {
        if (name === "candidate.json") return;
        REAL_DEPENDENCIES.writeEvidence(rootName, name, data);
      },
    });
    try {
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      expect(outcome.kind).not.toBe("ok");
      expect(outcome.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      expect(outcome.authoritative).toBe(false);
      // And the manifest really does not name the candidate: the fact is in
      // the FILE, and not only in the return of the run.
      const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
        artifacts: { name: string }[];
      };
      expect(manifest.artifacts.map(artifact => artifact.name)).not.toContain("candidate.json");
      expect(outcome.publication.errors.some(error => error.message.includes("candidate.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * The JOINT CHECKER of a published run.
 *
 * It is the ONE checker of this repository: the command calls it, the legacy
 * consumer calls it, and these cases call it. There is no copy of it here.
 *
 * The cases below run a REAL publisher in a REAL temporary root, and then
 * they break the evidence on purpose: a read that fails, a record that is
 * gone, a record that is tampered with. The checker must refuse every one
 * of them, and it must never remove the evidence.
 */
describe("the JOINT checker of a published run", () => {
  /** The stub of a run that really succeeded. */
  const normalSupervisor = (): StubSupervisor => new StubSupervisor({
    picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
    error: null, held: false, worker: true, settlesAfterPolls: 0,
  });

  /** The options of a run against the REVIEWED bytes. */
  const reviewedOptions = (mode: "normal" | "assertion-failure"): PositivePilotOptions => ({
    mode,
    expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
    expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
  });

  it("accepts a normal run that really succeeded", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.reasons).toEqual([]);
      expect(verdict.evidenceReliable).toBe(true);
      expect(verdict.accepted).toBe(true);
      expect(verdict.exitCode).toBe(PILOT_EXIT_OK);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts the deliberate fault that was really observed", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot(reviewedOptions("assertion-failure"), deps);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.reasons).toEqual([]);
      expect(verdict.accepted).toBe(true);
      expect(verdict.exitCode).toBe(PILOT_EXIT_FAULT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT accept an ordinary business failure", async () => {
    // The draw really failed, and the evidence of it is complete: the exit
    // code is 1, and it is NOT a pass.
    const supervisor = new StubSupervisor({
      picture: null, error: new Error("the draw really failed"), held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(true);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_FAULT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT accept a fault that carries an extra failure", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
      transportFailure: {
        name: "Error", code: "EPIPE", message: "the transport really failed",
        stack: null, cause: null, phase: null,
      },
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot(reviewedOptions("assertion-failure"), deps);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(true);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_FAULT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses when the final record cannot be read, and it keeps the evidence", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      // The read of the final fails: the reader is the boundary of the case.
      const refusing = (path: string): Buffer | null => (
        path.endsWith("final.json") ? null : readFileSync(path)
      );
      const verdict = verifyPublishedRun(outcome, root, refusing);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      // And the evidence is STILL there: the checker never removes it.
      expect(existsSync(join(root, "final.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses when the candidate cannot be read", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      const refusing = (path: string): Buffer | null => (
        path.endsWith("candidate.json") ? null : readFileSync(path)
      );
      const verdict = verifyPublishedRun(outcome, root, refusing);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses when the helper cannot be read", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      const refusing = (path: string): Buffer | null => (
        path.endsWith("cache-worker-fixture.mjs") ? null : readFileSync(path)
      );
      const verdict = verifyPublishedRun(outcome, root, refusing);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      expect(existsSync(join(root, "cache-worker-fixture.mjs"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses when a third listed artifact cannot be read", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      const refusing = (path: string): Buffer | null => (
        path.endsWith("cache-worker-fixture.scenario") ? null : readFileSync(path)
      );
      const verdict = verifyPublishedRun(outcome, root, refusing);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses when a record is GONE from the root", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      rmSync(join(root, "candidate.json"));
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      // The other records are still there: the checker removed nothing.
      expect(existsSync(join(root, "final.json"))).toBe(true);
      expect(existsSync(join(root, "manifest.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a record with a LEGITIMATE digest but another mode", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      // The final record is TAMPERED with, and the digest of the tampered
      // bytes is LEGITIMATE: the checker may not accept it because the
      // record says another mode.
      const record = JSON.parse(readFileSync(join(root, "final.json"), "utf8")) as Record<string, unknown>;
      record.mode = "assertion-failure";
      const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      writeFileSync(join(root, "final.json"), bytes);
      const tampered = {
        ...outcome,
        publication: {
          ...outcome.publication,
          final_sha256: digestOf(bytes),
          final_bytes: bytes.length,
        },
      };
      const verdict = verifyPublishedRun(tampered, root);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a record with a LEGITIMATE digest but another protocol", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      const record = JSON.parse(readFileSync(join(root, "final.json"), "utf8")) as Record<string, unknown>;
      record.publication_protocol = "positive-pilot-publication-v1";
      const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      writeFileSync(join(root, "final.json"), bytes);
      const tampered = {
        ...outcome,
        publication: {
          ...outcome.publication,
          final_sha256: digestOf(bytes),
          final_bytes: bytes.length,
        },
      };
      const verdict = verifyPublishedRun(tampered, root);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a record with a LEGITIMATE digest but a broken link", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      const record = JSON.parse(readFileSync(join(root, "final.json"), "utf8")) as Record<string, unknown>;
      record.candidate_sha256 = "0".repeat(64);
      const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      writeFileSync(join(root, "final.json"), bytes);
      const tampered = {
        ...outcome,
        publication: {
          ...outcome.publication,
          final_sha256: digestOf(bytes),
          final_bytes: bytes.length,
        },
      };
      const verdict = verifyPublishedRun(tampered, root);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a record with a LEGITIMATE digest but another number of bytes", async () => {
    const { deps, root } = realFsDeps(normalSupervisor());
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      const record = JSON.parse(readFileSync(join(root, "final.json"), "utf8")) as Record<string, unknown>;
      record.candidate_bytes = 7;
      const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      writeFileSync(join(root, "final.json"), bytes);
      const tampered = {
        ...outcome,
        publication: {
          ...outcome.publication,
          final_sha256: digestOf(bytes),
          final_bytes: bytes.length,
        },
      };
      const verdict = verifyPublishedRun(tampered, root);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("answers 3 from the COMMAND when the evidence cannot be read", async () => {
    const { deps, root } = realFsDeps(normalSupervisor(), {
      // The read of the final fails for the WHOLE run: the command itself
      // may not answer 0 while its evidence is not readable.
      readBytes: (path: string): Buffer | null => (
        path.endsWith("final.json") ? null : readFileSync(path)
      ),
    });
    try {
      const code = await main([
        "--mode", "normal",
        "--expected-custodian-sha256", REVIEWED_CUSTODIAN_SHA256,
        "--expected-fixture-sha256", REVIEWED_FIXTURE_SHA256,
      ], deps);
      expect(code).toBe(PILOT_EXIT_UNRELIABLE);
      expect(code).not.toBe(PILOT_EXIT_OK);
      // And the root is KEPT: a refused run does not remove its evidence.
      expect(existsSync(join(root, "final.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the REAL mapper: a single EIO on a third artifact makes the run unreliable", async () => {
    // The scenario of the run is a THIRD listed artifact: nothing reads it
    // before the scan of the artifacts, so the EIO happens IN the scan - and
    // the REAL mapper writes the errored row with a NULL top level error.
    const { deps, root } = realFsDeps(normalSupervisor());
    const scenario = join(root, "cache-worker-fixture.scenario");
    readFailures.set(scenario, "EIO");
    try {
      const outcome = await runPositivePilot(reviewedOptions("normal"), deps);
      expect(outcome.kind).toBe("failed");
      expect(outcome.faultCasePassed).toBe(false);
      expect(outcome.authoritative).toBe(false);
      expect(outcome.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      // The manifest really carries the errored row, and the listing itself
      // did NOT fail: the top level error is null.
      const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
        listing_error: unknown;
        artifacts: { name: string; digest: string | null; error: unknown }[];
      };
      expect(manifest.listing_error).toBeNull();
      const row = manifest.artifacts.find(artifact => artifact.name === "cache-worker-fixture.scenario");
      expect(row).toBeDefined();
      expect(row?.digest).toBeNull();
      expect(row?.error).not.toBeNull();
      // And the checker refuses the run as well.
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      readFailures.delete(scenario);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * The RESULT FACTS of a published run.
 *
 * Every mandatory field of the contract (F01..F10) is checked in THREE
 * classes: the field is DELETED, the field has the WRONG TYPE, and the field
 * has a LEGAL type but CONTRADICTS another record or the actual run.
 *
 * The change is made at the WRITE edge of the REAL writer or of the REAL
 * publisher: the bytes that are really written are the bytes of the changed
 * record, and the real mapper, the real digests and the real lengths
 * correspond to them. No hash is forged anywhere, and there is no copy of the
 * consumer in this file: every case calls the ACTUAL checker.
 */
describe("the RESULT FACTS of a published run", () => {
  /** One mandatory field and the three classes of its failure. */
  interface ResultFactCase {
    /** The row of the contract that the case belongs to. */
    readonly id: string;
    /** The mode of the run that the case needs. */
    readonly mode: "normal" | "assertion-failure";
    /** The record that carries the field. */
    readonly record: "candidate" | "final";
    /** The name of the field. */
    readonly field: string;
    /** The field is DELETED. */
    readonly deleted: (record: Record<string, unknown>) => void;
    /** The field has the WRONG TYPE. */
    readonly wrongType: (record: Record<string, unknown>) => void;
    /** The field has a LEGAL type but contradicts the rest. */
    readonly contradictory: (record: Record<string, unknown>) => void;
  }

  /** A legal bounded error that is NOT the failure of the run. */
  const ANOTHER_FAILURE = { name: "Error", message: "another failure", code: "EIO" };
  /** A legal digest that is NOT the digest of the run. */
  const ANOTHER_DIGEST = "0".repeat(64);
  /** A legal native envelope that is NOT the failure of the run. */
  const ANOTHER_ENVELOPE = {
    name: "Error", code: "EPIPE", message: "the pipe broke",
    stack: null, cause: null, phase: null,
  };

  /** Delete one field of a record. */
  const remove = (field: string) => (record: Record<string, unknown>): void => {
    delete record[field];
  };
  /** Replace one field of a record with a string. */
  const asString = (field: string) => (record: Record<string, unknown>): void => {
    record[field] = "not a fact";
  };
  /** Replace one field of a record with an array. */
  const asArray = (field: string) => (record: Record<string, unknown>): void => {
    record[field] = [];
  };
  /** Replace one field of a record with an empty object. */
  const asObject = (field: string) => (record: Record<string, unknown>): void => {
    record[field] = {};
  };

  const RESULT_FACT_CASES: readonly ResultFactCase[] = [
    {
      id: "F01", mode: "normal", record: "final", field: "kind_of_run",
      deleted: remove("kind_of_run"),
      wrongType: asArray("kind_of_run"),
      contradictory: (record) => { record.kind_of_run = "fault-observed"; },
    },
    {
      id: "F01", mode: "normal", record: "final", field: "exit_code",
      deleted: remove("exit_code"),
      wrongType: asString("exit_code"),
      contradictory: (record) => { record.exit_code = 1; },
    },
    {
      id: "F01", mode: "normal", record: "final", field: "fault_case_passed",
      deleted: remove("fault_case_passed"),
      wrongType: asString("fault_case_passed"),
      contradictory: (record) => { record.fault_case_passed = true; },
    },
    {
      id: "F01", mode: "normal", record: "candidate", field: "authoritative",
      deleted: remove("authoritative"),
      wrongType: asString("authoritative"),
      contradictory: (record) => { record.authoritative = true; },
    },
    {
      id: "F01", mode: "normal", record: "final", field: "mode",
      deleted: remove("mode"),
      wrongType: asObject("mode"),
      contradictory: (record) => { record.mode = "assertion-failure"; },
    },
    {
      id: "F02", mode: "normal", record: "candidate", field: "original_failure",
      deleted: remove("original_failure"),
      wrongType: asObject("original_failure"),
      contradictory: (record) => { record.original_failure = ANOTHER_FAILURE; },
    },
    {
      id: "F02", mode: "normal", record: "final", field: "original_failure",
      deleted: remove("original_failure"),
      wrongType: asArray("original_failure"),
      contradictory: (record) => { record.original_failure = ANOTHER_FAILURE; },
    },
    {
      id: "F03", mode: "normal", record: "candidate", field: "settlement_failure",
      deleted: remove("settlement_failure"),
      wrongType: asArray("settlement_failure"),
      contradictory: (record) => { record.settlement_failure = ANOTHER_FAILURE; },
    },
    {
      id: "F03", mode: "normal", record: "final", field: "settlement_failure",
      deleted: remove("settlement_failure"),
      wrongType: asObject("settlement_failure"),
      contradictory: (record) => { record.settlement_failure = ANOTHER_FAILURE; },
    },
    {
      id: "F04", mode: "normal", record: "candidate", field: "cleanup_facts",
      deleted: remove("cleanup_facts"),
      wrongType: asString("cleanup_facts"),
      contradictory: (record) => { record.cleanup_facts = [ANOTHER_FAILURE]; },
    },
    {
      id: "F04", mode: "normal", record: "final", field: "cleanup_facts",
      deleted: remove("cleanup_facts"),
      wrongType: asObject("cleanup_facts"),
      contradictory: (record) => { record.cleanup_facts = [ANOTHER_FAILURE]; },
    },
    {
      id: "F05", mode: "normal", record: "candidate", field: "terminal_proof",
      deleted: remove("terminal_proof"),
      wrongType: asString("terminal_proof"),
      contradictory: (record) => { record.terminal_proof = false; },
    },
    {
      id: "F05", mode: "normal", record: "final", field: "terminal_proof",
      deleted: remove("terminal_proof"),
      wrongType: asString("terminal_proof"),
      contradictory: (record) => { record.terminal_proof = false; },
    },
    {
      id: "F06", mode: "normal", record: "candidate", field: "actual_image",
      deleted: remove("actual_image"),
      wrongType: asString("actual_image"),
      contradictory: (record) => { record.actual_image = { sha256: ANOTHER_DIGEST, bytes: 1024, is_the_exact_one: true }; },
    },
    {
      id: "F06", mode: "normal", record: "final", field: "picture_sha256",
      deleted: remove("picture_sha256"),
      wrongType: asArray("picture_sha256"),
      contradictory: (record) => { record.picture_sha256 = ANOTHER_DIGEST; },
    },
    {
      id: "F06", mode: "normal", record: "final", field: "picture_bytes",
      deleted: remove("picture_bytes"),
      wrongType: asString("picture_bytes"),
      contradictory: (record) => { record.picture_bytes = 7; },
    },
    {
      id: "F07", mode: "normal", record: "final", field: "diagnostic_snapshot",
      deleted: remove("diagnostic_snapshot"),
      wrongType: asString("diagnostic_snapshot"),
      contradictory: (record) => { record.diagnostic_snapshot = ANOTHER_ENVELOPE; },
    },
    {
      id: "F07", mode: "normal", record: "candidate", field: "accumulator_summary",
      deleted: remove("accumulator_summary"),
      wrongType: asString("accumulator_summary"),
      contradictory: (record) => {
        record.accumulator_summary = { ...(record.accumulator_summary as Record<string, unknown>), segments: 99 };
      },
    },
    {
      id: "F07", mode: "normal", record: "candidate", field: "terminal_proof_observations",
      deleted: remove("terminal_proof_observations"),
      wrongType: asString("terminal_proof_observations"),
      contradictory: (record) => {
        record.terminal_proof_observations = {
          at: 1000, proven: true, truncated: false,
          observations: [{
            kind: "custodian-epoch", presence: "gone", pid: 100, at: 1000,
            start_ticks: "10", state: null, reason: null,
          }],
        };
      },
    },
    {
      id: "F08", mode: "normal", record: "final", field: "diagnostic_snapshot.cleanup_failures",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        delete snapshot.cleanup_failures;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.cleanup_failures = "none";
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.cleanup_failures = 3;
      },
    },
    {
      id: "F08", mode: "normal", record: "final", field: "diagnostic_snapshot.transport_failure",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        delete snapshot.transport_failure;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.transport_failure = "EPIPE";
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.transport_failure = ANOTHER_ENVELOPE;
      },
    },
    {
      id: "F08", mode: "normal", record: "final", field: "diagnostic_snapshot.latched_outcome",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        delete snapshot.latched_outcome;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.latched_outcome = "failure";
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.latched_outcome = {
          kind: "failure", code: "DRAW_PROTOCOL", message: "an extra failure", native_phase: null,
        };
      },
    },
    {
      id: "F09", mode: "assertion-failure", record: "final", field: "diagnostic_snapshot.cancel_provenance",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        delete snapshot.cancel_provenance;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.cancel_provenance = "DRAW_CANCELLED";
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        provenance.error_code = "OTHER";
      },
    },
    {
      id: "F01", mode: "normal", record: "final", field: "authoritative",
      deleted: remove("authoritative"),
      wrongType: asString("authoritative"),
      contradictory: (record) => { record.authoritative = false; },
    },
    {
      id: "F01", mode: "normal", record: "final", field: "publication_protocol",
      deleted: remove("publication_protocol"),
      wrongType: asArray("publication_protocol"),
      contradictory: (record) => { record.publication_protocol = "positive-pilot-publication-v1"; },
    },
    {
      id: "F01", mode: "normal", record: "final", field: "root",
      deleted: remove("root"),
      wrongType: asObject("root"),
      contradictory: (record) => { record.root = "/tmp/another-root"; },
    },
    {
      id: "F05", mode: "normal", record: "final", field: "diagnostic_snapshot.terminal_proof",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        delete snapshot.terminal_proof;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.terminal_proof = "proven";
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const proof = snapshot.terminal_proof as Record<string, unknown>;
        proof.proven = false;
      },
    },
    {
      id: "F06", mode: "normal", record: "candidate", field: "expected_image",
      deleted: remove("expected_image"),
      wrongType: asString("expected_image"),
      contradictory: (record) => {
        record.expected_image = { sha256: ANOTHER_DIGEST, bytes: 1024 };
      },
    },
    {
      id: "F07", mode: "normal", record: "candidate", field: "receipt_summary",
      deleted: remove("receipt_summary"),
      wrongType: asString("receipt_summary"),
      contradictory: (record) => {
        record.receipt_summary = { kind: "DOMAIN_REAPED", outcome: "reaped", waits_count: 99 };
      },
    },
    {
      id: "F08", mode: "normal", record: "final", field: "diagnostic_snapshot.cleanup_facts",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        delete snapshot.cleanup_facts;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.cleanup_facts = "none";
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.cleanup_facts = [ANOTHER_FAILURE];
      },
    },
    {
      id: "F09", mode: "assertion-failure", record: "final", field: "diagnostic_snapshot.cancel_provenance.error_code",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        delete provenance.error_code;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        provenance.error_code = 7;
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        provenance.error_code = "OTHER";
      },
    },
    {
      id: "F10", mode: "normal", record: "final", field: "evidence_errors",
      deleted: remove("evidence_errors"),
      wrongType: asString("evidence_errors"),
      contradictory: (record) => { record.evidence_errors = [ANOTHER_FAILURE]; },
    },
    {
      id: "F10", mode: "normal", record: "final", field: "reporting_failures",
      deleted: remove("reporting_failures"),
      wrongType: asString("reporting_failures"),
      contradictory: (record) => { record.reporting_failures = [ANOTHER_FAILURE]; },
    },
    {
      id: "F09", mode: "assertion-failure", record: "final", field: "diagnostic_snapshot.cancel_provenance.error_name",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        delete provenance.error_name;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        provenance.error_name = 42;
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        provenance.error_name = "AnotherError";
      },
    },
    {
      id: "F09", mode: "assertion-failure", record: "final", field: "diagnostic_snapshot.cancel_provenance.message",
      deleted: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        delete provenance.message;
      },
      wrongType: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        provenance.message = ["a message"];
      },
      contradictory: (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        const provenance = snapshot.cancel_provenance as Record<string, unknown>;
        provenance.message = "another message of another error";
      },
    },
  ];

  /** The three classes of every mandatory field, as one flat matrix. */
  const MATRIX = RESULT_FACT_CASES.flatMap(entry => [
    { ...entry, id: `${entry.id} ${entry.record}.${entry.field} deleted`, change: entry.deleted },
    { ...entry, id: `${entry.id} ${entry.record}.${entry.field} wrong type`, change: entry.wrongType },
    { ...entry, id: `${entry.id} ${entry.record}.${entry.field} contradicted`, change: entry.contradictory },
  ]);

  it.each(MATRIX)("refuses $id", async ({ id, mode, record, change }) => {
    const supervisor = mode === "normal"
      ? new StubSupervisor({
        picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
        error: null, held: false, worker: true, settlesAfterPolls: 0,
      })
      : new StubSupervisor({
        picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
      });
    const { deps, root } = realFsDeps(supervisor);
    try {
      // The record is changed at the WRITE edge of the REAL writer: the bytes
      // that are really written are the bytes of the changed record, and the
      // real digests and the real lengths correspond to them.
      const tampered = tamperWith(deps, record === "candidate" ? "candidate.json" : "final.json", change);
      const outcome = await runPositivePilot({
        mode,
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      const verdict = verifyPublishedRun(outcome, root);
      // The field is not reliable: the run is refused, and the exit code is 3.
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      expect(verdict.reasons.join(" ")).not.toBe("");
      // And the evidence is KEPT: a refused run never removes it.
      expect(existsSync(join(root, "final.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a record that says NULL where the run really failed", async () => {
    // An explicit null is NOT a missing field, and it is NOT the truth either:
    // the run really failed with the deliberate error, and the record says
    // that it did not fail at all.
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const tampered = tamperWith(deps, "final.json", (record) => {
        record.original_failure = null;
      });
      const outcome = await runPositivePilot({
        mode: "assertion-failure",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a candidate that carries a failure, a cleanup and a missing field at once", async () => {
    // C01: the candidate carries a failure of its own, a cleanup that the run
    // did not have, and it does not carry the settlement at all.
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const tampered = tamperWith(deps, "candidate.json", (record) => {
        record.original_failure = { name: "Error", message: "candidate EIO", code: "EIO" };
        record.cleanup_facts = [ANOTHER_FAILURE];
        delete record.settlement_failure;
      });
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      expect(existsSync(join(root, "candidate.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a final whose diagnostic carries an extra failure", async () => {
    // C03: the final carries a transport failure and a latched failure, and
    // the ACTUAL outcome of the run is unchanged: the contradiction between
    // the record and the actual facts is the refusal.
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const tampered = tamperWith(deps, "final.json", (record) => {
        const snapshot = record.diagnostic_snapshot as Record<string, unknown>;
        snapshot.transport_failure = ANOTHER_ENVELOPE;
        snapshot.latched_outcome = {
          kind: "failure", code: "DRAW_PROTOCOL", message: "an extra failure", native_phase: null,
        };
      });
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      // The ACTUAL baseline of the outcome is unchanged.
      expect(outcome.diagnosticSnapshot?.transport_failure).toBeNull();
      expect(outcome.diagnosticSnapshot?.latched_outcome.kind).not.toBe("failure");
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an outcome whose own facts contradict the records", async () => {
    // C04: the OUTCOME carries a cleanup that the records do not have, and
    // the records claim a success: the contradiction is the refusal.
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      const forged = {
        ...outcome,
        cleanupFacts: [{ name: "Error", message: "a cleanup that did not happen", code: "EIO" }],
      };
      const verdict = verifyPublishedRun(forged, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an outcome whose kind, exit and fault flags contradict the records", async () => {
    // C04: the records say "ok" with the exit code 0, and the outcome claims
    // the deliberate fault: the contradiction is the refusal.
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      const forged = {
        ...outcome,
        kind: "fault-observed" as const,
        exitCode: PILOT_EXIT_FAULT,
        faultCasePassed: true,
      };
      const verdict = verifyPublishedRun(forged, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a fault whose settlement is an unrelated failure", async () => {
    // C05: the final claims the deliberate fault, and its settlement is an
    // unrelated EPIPE: the settlement is not the original error nor its
    // cause, and the text of the two errors is never the relation.
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const tampered = tamperWith(deps, "final.json", (record) => {
        record.settlement_failure = ANOTHER_ENVELOPE;
      });
      const outcome = await runPositivePilot({
        mode: "assertion-failure",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a fault whose ACTUAL settlement is another object with the same text", async () => {
    // C06: the records are consistent, and the ACTUAL objects are not: the
    // original error and the settlement are DIFFERENT objects that carry the
    // same text. The relation is the identity or the direct cause, and it
    // does not hold.
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot({
        mode: "assertion-failure",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      const text = "the deliberate assertion failure of the positive pilot (EXPECTED_ASSERTION_FAILURE)";
      const original = Object.assign(new Error(text), {
        code: "EXPECTED_ASSERTION_FAILURE", name: "PositivePilotFailure",
      });
      const settlement = Object.assign(new Error(text), {
        code: "EXPECTED_ASSERTION_FAILURE", name: "PositivePilotFailure",
      });
      expect(settlement).not.toBe(original);
      const forged = {
        ...outcome,
        originalFailure: original,
        settlementFailure: settlement,
      };
      const verdict = verifyPublishedRun(forged, root);
      // The records claim the deliberate fault and the ACTUAL relation does
      // not hold: that is an unreliable evidence, and never a pass.
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ACCEPTS a fault whose settlement is the WRAPPER of the original error", async () => {
    // C07: the legal wrapper: the settlement carries the original error as
    // its direct cause. The relation holds, and the fault is accepted.
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
      settlementWrapper: true,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot({
        mode: "assertion-failure",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.reasons).toEqual([]);
      expect(verdict.evidenceReliable).toBe(true);
      expect(verdict.accepted).toBe(true);
      expect(verdict.exitCode).toBe(PILOT_EXIT_FAULT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an ordinary business failure reliable, not accepted, and at the exit code 1", async () => {
    // C07: a real and consistent failure is NOT a pass, and it is NOT an
    // unreliable evidence either.
    const supervisor = new StubSupervisor({
      picture: null, error: new Error("the draw really failed"), held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(true);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_FAULT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an ordinary failure of the FAULT mode reliable, not accepted, and at the exit code 1", async () => {
    // C07: the fault mode that failed for another reason is an ordinary
    // failure as well.
    const supervisor = new StubSupervisor({
      picture: null, error: new Error("the transport really failed"), held: false, worker: true, settlesAfterPolls: 0,
      settlesOnStart: false,
      transportFailure: {
        name: "Error", code: "EPIPE", message: "the transport really failed",
        stack: null, cause: null, phase: null,
      },
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot({
        mode: "assertion-failure",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(true);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_FAULT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("answers 3 from the COMMAND when a result fact of the candidate is wrong", async () => {
    // The decisive case: the ACTUAL command, the ACTUAL publisher and the
    // ACTUAL checker. A result fact that is not legal is not a pass.
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor, {
      writeEvidence: (rootName, name, data) => {
        if (name !== "candidate.json") {
          REAL_DEPENDENCIES.writeEvidence(rootName, name, data);
          return;
        }
        const record = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
        record.original_failure = { name: "Error", message: "candidate EIO", code: "EIO" };
        REAL_DEPENDENCIES.writeEvidence(rootName, name, record);
      },
    });
    try {
      const code = await main([
        "--mode", "normal",
        "--expected-custodian-sha256", REVIEWED_CUSTODIAN_SHA256,
        "--expected-fixture-sha256", REVIEWED_FIXTURE_SHA256,
      ], deps);
      expect(code).toBe(PILOT_EXIT_UNRELIABLE);
      expect(code).not.toBe(PILOT_EXIT_OK);
      // And the root is KEPT.
      expect(existsSync(join(root, "final.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT change when the snapshot is read again", async () => {
    // C08: the ACTUAL frozen snapshot of the run does not change under a
    // second read, and it is the baseline of the result facts.
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      const first = outcome.diagnosticSnapshot;
      expect(first).not.toBeNull();
      expect(outcome.diagnosticSnapshot).toBe(first);
      expect(first?.terminal_proof?.proven).toBe(true);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.accepted).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * The run WITHOUT a root.
 *
 * There is no root: there is nothing that may own an evidence file, and the
 * working directory is NOT a substitute for it. The command refuses before it
 * reads anything, and it writes nothing.
 */
describe("the run WITHOUT a root", () => {
  it("answers 3 and it writes NOTHING", async () => {
    const { deps } = realFsDeps(new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    }), {
      createRoot: () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); },
    });
    const code = await main([
      "--mode", "normal",
      "--expected-custodian-sha256", REVIEWED_CUSTODIAN_SHA256,
      "--expected-fixture-sha256", REVIEWED_FIXTURE_SHA256,
    ], deps);
    // The evidence is not reliable: there is no root that may own it.
    expect(code).toBe(PILOT_EXIT_UNRELIABLE);
    expect(code).not.toBe(PILOT_EXIT_OK);
    // And the working directory was NOT used as a substitute for the root.
    expect(existsSync(join(REPOSITORY_ROOT, "final.json"))).toBe(false);
    expect(existsSync(join(REPOSITORY_ROOT, "candidate.json"))).toBe(false);
    expect(existsSync(join(REPOSITORY_ROOT, "manifest.json"))).toBe(false);
  });
});

/**
 * The PRESENCE of every published field.
 *
 * The producer ALWAYS publishes the fields below, and the checker must
 * refuse a record that does not carry one of them: a MISSING field is not a
 * field with an explicit null, and it is not an answer.
 *
 * The lists are declared HERE, independently of the tool: a key that the
 * tool does not require would make the deletion of that key ACCEPTED, and
 * the case below would fail. The list is therefore the CONTRACT, and the
 * tool is the IMPLEMENTATION of it.
 */
const PUBLISHED_CANDIDATE_KEYS = [
  "kind", "authoritative", "mode", "root",
  "custodian_sha256", "fixture_sha256", "copied_fixture_sha256", "scenario",
  "expected_image", "actual_image",
  "original_failure", "settlement_failure", "cleanup_facts", "terminal_proof",
  "terminal_proof_observations", "receipt_summary", "accumulator_summary",
  "raw_segments_saved", "timeline",
] as const;
const PUBLISHED_MANIFEST_KEYS = [
  "kind", "authoritative", "root", "artifacts", "listing_error",
  "excluded", "exclusion_reason", "required_artifacts",
] as const;
const PUBLISHED_FINAL_KEYS = [
  "kind", "authoritative", "publication_protocol", "mode", "root",
  "exit_code", "kind_of_run", "fault_case_passed", "terminal_proof",
  "picture_sha256", "picture_bytes", "picture_is_the_exact_one",
  "original_failure", "settlement_failure", "cleanup_facts",
  "reporting_failure", "reporting_failures", "evidence_errors",
  "evidence_problems", "manifest_error", "required_artifacts",
  "candidate_sha256", "candidate_bytes", "manifest_sha256", "manifest_bytes",
  "terminal_proof_observations", "diagnostic_snapshot",
] as const;

describe("the PRESENCE of every published field", () => {
  /** The cases of the published keys: one case per key of the three records. */
  const PUBLISHED_KEY_CASES = [
    ...PUBLISHED_CANDIDATE_KEYS.map(key => ({ id: `candidate.${key}`, record: "candidate.json" as const, key })),
    ...PUBLISHED_MANIFEST_KEYS.map(key => ({ id: `manifest.${key}`, record: "manifest.json" as const, key })),
    ...PUBLISHED_FINAL_KEYS.map(key => ({ id: `final.${key}`, record: "final.json" as const, key })),
  ];

  it.each(PUBLISHED_KEY_CASES)("refuses the publication without $id", async ({ id, record, key }) => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      // The key is DELETED at the write edge of the REAL writer: the bytes
      // that are really written are the bytes of the record without that
      // key, and the real mapper, the real digests and the real lengths
      // correspond to them.
      const tampered = tamperWith(deps, record, (data) => { delete data[key]; });
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      // And the evidence is KEPT.
      expect(existsSync(join(root, "final.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a manifest whose artifact row does not carry its error", async () => {
    // The row of the helper: its `error` is DELETED, so the row does not
    // say that it has no error - it says nothing at all.
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const tampered = tamperWith(deps, "manifest.json", (data) => {
        const artifacts = data.artifacts as Record<string, unknown>[];
        const row = artifacts.find(entry => entry.name === "cache-worker-fixture.mjs");
        if (row !== undefined) delete row.error;
      });
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["final.reporting_failure", "final.json", "final"],
    ["manifest.listing_error", "manifest.json", "manifest"],
  ])("refuses a %s that carries a REAL failure", async (_id, record, where) => {
    // The field that says "there is no failure here" carries one: the error
    // is a legal bounded failure, and it disqualifies the evidence.
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const tampered = tamperWith(deps, record, (data) => {
        const field = where === "final" ? "reporting_failure" : "listing_error";
        data[field] = { name: "Error", message: "the pipe broke", code: "EPIPE" };
      });
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an artifact row that carries a REAL failure", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps, root } = realFsDeps(supervisor);
    try {
      const tampered = tamperWith(deps, "manifest.json", (data) => {
        const artifacts = data.artifacts as Record<string, unknown>[];
        const row = artifacts.find(entry => entry.name === "cache-worker-fixture.mjs");
        if (row !== undefined) {
          row.error = { name: "Error", message: "the digest could not be read", code: "EIO" };
        }
      });
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, tampered);
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * The run WITHOUT a snapshot.
 *
 * The helper was copied and then the supervisor could not be built: the root
 * and the three records are complete, the ACTUAL snapshot is null, and the
 * run is an ordinary business failure - reliable, not accepted, exit 1.
 *
 * The four summaries of the terminal proof must still be published, and they
 * must say that there is none: a missing field is not an explicit null, and
 * no mock proof is invented for a run that never had one.
 */
describe("the run WITHOUT a snapshot", () => {
  /** The dependencies of a run whose supervisor could not be built. */
  function noSupervisorDeps(): {
    deps: PositivePilotDependencies;
    root: string;
  } {
    return realFsDeps(new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0,
    }), {
      // The helper was copied BEFORE the supervisor was built: the root, the
      // helper and the three records are complete, and the snapshot is null.
      createSupervisor: () => { throw new Error("the supervisor could not be built"); },
    });
  }

  /**
   * The four summaries of the terminal proof, with the field that carries
   * each of them and the record that carries it.
   *
   * The label and the TARGET are the same field: the case says which field it
   * changes, and it changes THAT field.
   */
  const NULL_BASELINE_FIELDS = [
    ["candidate.receipt_summary", "candidate.json", "candidate", "receipt_summary"],
    ["candidate.accumulator_summary", "candidate.json", "candidate", "accumulator_summary"],
    ["candidate.terminal_proof_observations", "candidate.json", "candidate", "terminal_proof_observations"],
    ["final.terminal_proof_observations", "final.json", "final", "terminal_proof_observations"],
  ] as const;

  it("keeps it reliable, not accepted, and at the exit code 1", async () => {
    const { deps, root } = noSupervisorDeps();
    try {
      const outcome = await runPositivePilot({
        mode: "normal",
        expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
        expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
      }, deps);
      expect(outcome.diagnosticSnapshot).toBeNull();
      expect(outcome.kind).toBe("failed");
      const verdict = verifyPublishedRun(outcome, root);
      expect(verdict.evidenceReliable).toBe(true);
      expect(verdict.accepted).toBe(false);
      expect(verdict.exitCode).toBe(PILOT_EXIT_FAULT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(NULL_BASELINE_FIELDS)(
    "refuses the run without the snapshot when %s is missing",
    async (id, record, where, field) => {
      expect(id).toBe(`${where}.${field}`);
      const { deps, root } = noSupervisorDeps();
      try {
        const tampered = tamperWith(deps, record, (data) => { delete data[field]; });
        const outcome = await runPositivePilot({
          mode: "normal",
          expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
          expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
        }, tampered);
        const verdict = verifyPublishedRun(outcome, root);
        expect(verdict.evidenceReliable).toBe(false);
        expect(verdict.accepted).toBe(false);
        expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(NULL_BASELINE_FIELDS)(
    "refuses the run without the snapshot when %s is explicitly undefined",
    async (id, record, where, field) => {
      // An explicit `undefined` is DROPPED by the serialization: it is not a
      // field with a null, and it is not an answer.
      expect(id).toBe(`${where}.${field}`);
      const { deps, root } = noSupervisorDeps();
      try {
        const tampered = tamperWith(deps, record, (data) => { data[field] = undefined; });
        const outcome = await runPositivePilot({
          mode: "normal",
          expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
          expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
        }, tampered);
        const verdict = verifyPublishedRun(outcome, root);
        expect(verdict.evidenceReliable).toBe(false);
        expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(NULL_BASELINE_FIELDS)(
    "refuses the run without the snapshot when %s has the wrong type",
    async (id, record, where, field) => {
      expect(id).toBe(`${where}.${field}`);
      const { deps, root } = noSupervisorDeps();
      try {
        const tampered = tamperWith(deps, record, (data) => { data[field] = "not a summary"; });
        const outcome = await runPositivePilot({
          mode: "normal",
          expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
          expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
        }, tampered);
        const verdict = verifyPublishedRun(outcome, root);
        expect(verdict.evidenceReliable).toBe(false);
        expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(NULL_BASELINE_FIELDS)(
    "refuses the run without the snapshot when %s carries a legal object",
    async (id, record, where, field) => {
      // A LEGAL object is not the explicit null of a run without a snapshot:
      // the field says that there is a summary, and there is none.
      expect(id).toBe(`${where}.${field}`);
      const { deps, root } = noSupervisorDeps();
      try {
        const tampered = tamperWith(deps, record, (data) => {
          data[field] = { kind: "DOMAIN_REAPED", outcome: "reaped", waits_count: 1 };
        });
        const outcome = await runPositivePilot({
          mode: "normal",
          expectedCustodianSha256: REVIEWED_CUSTODIAN_SHA256,
          expectedFixtureSha256: REVIEWED_FIXTURE_SHA256,
        }, tampered);
        const verdict = verifyPublishedRun(outcome, root);
        expect(verdict.evidenceReliable).toBe(false);
        expect(verdict.exitCode).toBe(PILOT_EXIT_UNRELIABLE);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

/**
 * A channel of a private draw, as a fake: it records what the Host wrote and
 * it delivers what the custodian sends.
 */
class ProtocolChannel extends EventEmitter {
  readonly written: Buffer[] = [];

  constructor(private readonly onFrame: (message: Record<string, unknown>) => void) {
    super();
  }

  write(payload: Buffer): boolean {
    this.written.push(payload);
    try {
      this.onFrame(JSON.parse(payload.subarray(4).toString("utf8")) as Record<string, unknown>);
    } catch {
      // It was not a frame of the protocol: the caller does not care.
    }
    return true;
  }
}

/**
 * The custodian of a draw, as a fake that speaks the REAL protocol.
 *
 * The ORDER is the real one, and it matters:
 *
 *   1. the custodian states its identity (C_HELLO, seq 1);
 *   2. the Host authorises the fork, and the custodian reports it (FORKED,
 *      seq 2);
 *   3. the worker states its identity (N_HELLO) - and ONLY THEN does the
 *      Host send the GO;
 *   4. the worker answers with the picture, or it stays silent;
 *   5. the domain ends: the receipt goes out, and the custodian closes.
 *
 * It NEVER starts a process: the spawn is the only boundary that is faked,
 * and the /proc of the cases is the other one.
 */
class FakeCustodian extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdio: unknown[];
  readonly control: ProtocolChannel;
  readonly draw: ProtocolChannel;
  private ticketDigest = "";
  private drawId = "";
  /** The C_HELLO was the sequence number 1: the next one is the second. */
  private sequence = 1;
  private goSeen = false;

  constructor(
    readonly pid: number,
    private readonly workerPid: number,
    private readonly scenario: "answers" | "silent",
  ) {
    super();
    this.control = new ProtocolChannel(message => this.#onControl(message));
    this.draw = new ProtocolChannel(message => this.#onDraw(message));
    this.stdio = [null, this.stdout, this.stderr, this.draw, this.control];
  }

  /** The events of the helper of this run, as they really happened. */
  helperEvents(): { event: string; pid: number; ticket_digest: string }[] {
    if (!this.goSeen) return [];
    return [{ event: "go", pid: this.workerPid, ticket_digest: this.ticketDigest }];
  }

  /** One frame of a private channel, as the custodian writes it. */
  #frame(payload: Record<string, unknown>): Buffer {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(body.length, 0);
    return Buffer.concat([header, body]);
  }

  #onControl(message: Record<string, unknown>): void {
    if (message.kind === "AUTHORIZE_FORK") {
      this.drawId = String(message.draw_id ?? "");
      this.ticketDigest = String(message.ticket_digest ?? "");
      // The custodian really forked: it says so, with the next sequence.
      this.sequence += 1;
      this.control.emit("data", this.#frame({
        kind: "FORKED",
        protocol: CACHE_PROCESS_PROTOCOL,
        draw_id: this.drawId,
        ticket_digest: this.ticketDigest,
        seq: this.sequence,
        pid: this.workerPid,
        exec: { ok: true },
      }));
      // The worker REALLY stated its identity, on a later turn. The Host waits
      // for it BEFORE it sends the GO, so it may not wait for the GO here.
      setTimeout(() => {
        this.draw.emit("data", this.#frame({
          kind: "N_HELLO",
          protocol: CACHE_PROCESS_PROTOCOL,
          pid: this.workerPid,
          pgid: this.workerPid,
          sid: this.workerPid,
          start_ticks: Number(WORKER_TICKS),
        }));
      }, 0);
      return;
    }
    if (message.kind === "FINALIZE" || message.kind === "CANCEL") {
      // The domain really ended: the receipt goes out and the custodian
      // really closes.
      this.#sendReceipt();
    }
  }

  #onDraw(message: Record<string, unknown>): void {
    if (message.kind !== "GO") return;
    const ticket = String(message.ticket ?? "");
    this.ticketDigest = createHash("sha256")
      .update(Buffer.from(ticket, "utf8")).digest("hex");
    this.goSeen = true;
    if (this.scenario === "silent") {
      // The SILENT scenario: the worker takes the authorisation and stays.
      // It never answers, so the picture of the draw is NULL.
      return;
    }
    // And it REALLY answered with the synthetic picture.
    this.draw.emit("data", this.#frame({
      kind: "result",
      protocol: CACHE_PROCESS_PROTOCOL,
      ticket_digest: this.ticketDigest,
      ok: true,
      sha256: PICTURE_SHA256,
      bytes: PICTURE_BYTES,
    }));
    const picture = Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(picture.length, 0);
    this.draw.emit("data", Buffer.concat([header, picture]));
  }

  /** The receipt of the domain, with the SEGMENT that the summary names. */
  #sendReceipt(): void {
    // The wait of the worker, as the C writes it: the FULL epoch, the
    // increasing number of the wait and the category of the wait.
    const wait = {
      t: "w",
      v: {
        pid: this.workerPid,
        status: { kind: "exited", code: 0 },
        order: 1,
        category: "worker",
        epoch: {
          pid: this.workerPid, ppid: this.pid, pgid: this.workerPid, sid: this.workerPid,
          start_ticks: String(WORKER_TICKS),
        },
      },
    };
    const items = [wait];
    const digest = createHash("sha256");
    for (const item of items) {
      digest.update(`${canonicalCacheReceiptItem(item as { t: string; v: unknown })}\n`);
    }
    const waitsDigest = createHash("sha256");
    waitsDigest.update(`${canonicalCacheReceiptItem(wait as { t: string; v: unknown })}\n`);
    const empty = createHash("sha256").digest("hex");
    this.sequence += 1;
    this.control.emit("data", this.#frame({
      kind: "RECEIPT_SEGMENT",
      protocol: CACHE_PROCESS_PROTOCOL,
      receipt_version: 2,
      draw_id: this.drawId,
      ticket_digest: this.ticketDigest,
      seq: this.sequence,
      index: 0,
      count: 1,
      items,
      items_digest: digest.digest("hex"),
    }));
    this.sequence += 1;
    this.control.emit("data", this.#frame({
      kind: "DOMAIN_REAPED",
      protocol: CACHE_PROCESS_PROTOCOL,
      receipt_version: 2,
      proof_kind: "complete-v2",
      creative_eligible: true,
      startup_kind: "forked-exec-succeeded",
      fork_attempt_state: "born",
      fork_errno: null,
      forked_pid: this.workerPid,
      worker_epoch: {
        pid: this.workerPid, pgid: this.workerPid, sid: this.workerPid,
        start_ticks: String(WORKER_TICKS),
      },
      worker_wait: {
        pid: this.workerPid,
        status: { kind: "exited", code: 0 },
        order: 1,
        category: "worker",
        epoch: {
          pid: this.workerPid, ppid: this.pid, pgid: this.workerPid, sid: this.workerPid,
          start_ticks: String(WORKER_TICKS),
        },
      },
      last_actual_wait_ordinal: 1,
      echild_after_wait_ordinal: 1,
      group_disposition: "established-gone",
      stream_disposition: {
        stdout: { ownership: "acquired", bytes: 0, tail_bytes: 0, eof: true, read_error: null, disposition: "eof" },
        stderr: { ownership: "acquired", bytes: 0, tail_bytes: 0, eof: true, read_error: null, disposition: "eof" },
      },
      failed_terminal: null,
      draw_id: this.drawId,
      ticket_digest: this.ticketDigest,
      seq: this.sequence,
      outcome: "reaped",
      custodian: {
        pid: this.pid, ppid: process.pid, pgid: this.pid, sid: this.pid,
        start_ticks: String(FAKE_CUSTODIAN_TICKS),
      },
      worker: {
        pid: this.workerPid, ppid: this.pid, pgid: this.workerPid, sid: this.workerPid,
        start_ticks: String(WORKER_TICKS),
      },
      exec: { ok: true },
      signals: ["SIGTERM:group"],
      events_count: 0,
      events_digest: empty,
      waits_count: 1,
      waits_digest: waitsDigest.digest("hex"),
      identities_count: 0,
      identities_digest: empty,
      segments: 1,
      events_truncated: false,
      identity_overflow: false,
      anchor_retained: true,
      echild: true,
      group_esrch: true,
      known_ids_gone: true,
      diagnostics_lost: false,
      stdout_bytes: 0,
      stderr_bytes: 0,
      failure: null,
      state: "exit",
    }));
    // The custodian really closed, on a later turn: the receipt is read first.
    setTimeout(() => { this.close(); }, 0);
  }

  /** The custodian really closed, and the worker of the domain with it. */
  close(): void {
    procOverride.gone.add(this.pid);
    procOverride.gone.add(this.workerPid);
    this.emit("exit", 0, null);
    this.emit("close", 0, null);
  }
}

/** The number of the custodian of the fake, and the epoch it claims. */
const FAKE_CUSTODIAN_PID = 5150;
const FAKE_CUSTODIAN_TICKS = 24680;

/** The hello of the custodian, as the real one writes it. */
function helloFrame(custodian: FakeCustodian): Buffer {
  const body = Buffer.from(JSON.stringify({
    kind: "C_HELLO",
    protocol: CACHE_PROCESS_PROTOCOL,
    seq: 1,
    pid: custodian.pid,
    ppid: process.pid,
    pgid: custodian.pid,
    sid: custodian.pid,
    start_ticks: FAKE_CUSTODIAN_TICKS,
    subreaper: true,
  }), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** The dependencies of a case that drives the REAL supervisor. */
function realDeps(custodian: FakeCustodian): {
  deps: PositivePilotDependencies;
  cancels: unknown[];
  state: { evidence: { name: string; bytes: Buffer }[]; stderr: string[]; scenario: string | null; copied: string | null; files: Map<string, Buffer> };
} {
  const cancels: unknown[] = [];
  const { deps, state } = depsOf(new StubSupervisor({
    picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0,
  }), {
    createSupervisor: (options) => {
      const instance = new CacheProcessSupervisor(options);
      const original = instance.requestCancel.bind(instance);
      instance.requestCancel = (handle: unknown, error: unknown): void => {
        cancels.push(error);
        original(handle, error);
      };
      return instance;
    },
    // The events of the helper are the ones the REAL draw produced: the GO
    // of THIS draw, with ITS digest and ITS worker.
    readHelperEvents: () => custodian.helperEvents(),
    // And the observation of the kernel is the REAL worker of THIS draw.
    observeIdentity: () => ({
      presence: "known",
      identity: {
        pid: WORKER_PID,
        ppid: FAKE_CUSTODIAN_PID,
        pgid: WORKER_PID,
        sid: WORKER_PID,
        start_ticks: String(WORKER_TICKS),
        state: "S",
      },
    }),
    // The REAL clock of this case: the wait really yields to the macrotask
    // queue, the way the tool does. A wait that resolves at once would
    // starve the timers of the fake custodian, and the case would never
    // reach the protocol.
    now: () => Date.now(),
    sleep: async (milliseconds) => {
      await new Promise((resolveSleep) => { setTimeout(resolveSleep, milliseconds); });
    },
  });
  // The group of the worker of these cases is SYNTHETIC: it never existed,
  // and the probe of it is SCRIPTED for this one exact group. The answer is
  // the answer of the case - the domain of the draw really ended - and the
  // probe never reaches a real process.
  scriptGroupProbe(WORKER_PID, "gone");
  spawnMock.mockImplementation(() => custodian);
  return { deps, cancels, state };
}


describe("the ORCHESTRATION over the ACTUAL supervisor", () => {
  afterEach(() => {
    procOverride.identities.clear();
    procOverride.gone.clear();
  });

  it("waits for the REAL asynchronous start of the normal mode, and cancels NOTHING", async () => {
    // The supervisor is the REAL one, and the custodian is a fake that speaks
    // the REAL protocol. The draw really is PENDING while the runner waits.
    procOverride.identities.set(
      FAKE_CUSTODIAN_PID,
      statText(
        FAKE_CUSTODIAN_PID, "custodian", "S", process.pid,
        FAKE_CUSTODIAN_PID, FAKE_CUSTODIAN_PID, FAKE_CUSTODIAN_TICKS),
    );
    procOverride.identities.set(
      WORKER_PID,
      statText(WORKER_PID, "node", "S", FAKE_CUSTODIAN_PID, WORKER_PID, WORKER_PID, Number(WORKER_TICKS)),
    );
    const custodian = new FakeCustodian(FAKE_CUSTODIAN_PID, WORKER_PID, "answers");
    const { deps, cancels, state } = realDeps(custodian);
    const promise = runPositivePilot(OPTIONS, deps);
    // The custodian speaks AFTER the runner started waiting: the hello goes
    // out on a later turn, exactly like a real process.
    await new Promise((resolveTick) => { setTimeout(resolveTick, 5); });
    custodian.control.emit("data", helloFrame(custodian));
    const outcome = await promise;
    // The draw really succeeded, and NOTHING was cancelled while it was
    // pending.
    expect(cancels).toEqual([]);
    expect(outcome.kind).toBe("ok");
    expect(outcome.pictureIsTheExactOne).toBe(true);
    expect(outcome.pictureBytes).toBe(PICTURE_BYTES);
    expect(outcome.terminalProof).toBe(true);
    // The bounded digest facts of the receipt, as the production REALLY
    // computed them: the counts and the flags of the accumulator, and the
    // summary of the receipt. They are facts, and they are bounded.
    const snapshot = (evidenceOf(state, "final.json")?.diagnostic_snapshot ?? null) as {
      readonly receipt_summary?: Record<string, unknown> | null;
      readonly accumulator_summary?: Record<string, unknown> | null;
    } | null;
    expect(snapshot?.accumulator_summary).toEqual({
      segments: 1, received: 1, events: 0, waits: 1, identities: 0, refused: false,
      // The digests that the ACCUMULATOR really computed: the digest of
      // nothing for the empty classes, and the digest of the one wait.
      events_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      waits_digest: "5aec5debdb9dc918f59a1a45c45abaf2ecb575d2c1fee4835756fa40457e05f1",
      identities_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(snapshot?.receipt_summary).toMatchObject({
      kind: "DOMAIN_REAPED",
      outcome: "reaped",
      segments: 1,
      waits_count: 1,
      exec_ok: true,
      echild: true,
      group_esrch: true,
      known_ids_gone: true,
    });
    // The digests of the RECEIPT are the ones that the custodian really
    // computed: the digest of the one wait is the digest of the accumulator,
    // and a value that is not a complete digest is NULL.
    expect(snapshot?.receipt_summary).toMatchObject({
      waits_digest: "5aec5debdb9dc918f59a1a45c45abaf2ecb575d2c1fee4835756fa40457e05f1",
      events_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      identities_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    // The two ends of the protocol AGREE on the bytes: the digest of the
    // receipt and the digest of the accumulator are the same values.
    expect(snapshot?.receipt_summary?.waits_digest).toBe(snapshot?.accumulator_summary?.waits_digest);
    expect(snapshot?.receipt_summary?.events_digest).toBe(snapshot?.accumulator_summary?.events_digest);
    // And the raw segments of the receipt are NOT saved: the candidate says
    // so, and the summary is not a transcript.
    expect(evidenceOf(state, "candidate.json")?.raw_segments_saved).toBe(false);
    // TWO reads of the snapshot - the one of the candidate and the one of the
    // final - carry the SAME summaries: a snapshot that changed under a
    // reader would not be a fact.
    const candidateRecord = evidenceOf(state, "candidate.json");
    const finalRecord = evidenceOf(state, "final.json");
    const finalSnapshot = (finalRecord?.diagnostic_snapshot ?? null) as {
      readonly receipt_summary?: unknown;
      readonly accumulator_summary?: unknown;
    } | null;
    expect(candidateRecord?.receipt_summary).toEqual(finalSnapshot?.receipt_summary);
    expect(candidateRecord?.accumulator_summary).toEqual(finalSnapshot?.accumulator_summary);
  }, REAL_SUPERVISOR_CASE_TIMEOUT_MS);

  it("waits for the LATE worker of the fault mode before it injects", async () => {
    // The worker is accepted LATER: the draw is STARTING, and a null worker
    // during the startup is not a failed observation.
    procOverride.identities.set(
      FAKE_CUSTODIAN_PID,
      statText(
        FAKE_CUSTODIAN_PID, "custodian", "S", process.pid,
        FAKE_CUSTODIAN_PID, FAKE_CUSTODIAN_PID, FAKE_CUSTODIAN_TICKS),
    );
    procOverride.identities.set(
      WORKER_PID,
      statText(WORKER_PID, "node", "S", FAKE_CUSTODIAN_PID, WORKER_PID, WORKER_PID, Number(WORKER_TICKS)),
    );
    const custodian = new FakeCustodian(FAKE_CUSTODIAN_PID, WORKER_PID, "silent");
    const { deps } = realDeps(custodian);
    const promise = runPositivePilot({ ...OPTIONS, mode: "assertion-failure" }, deps);
    await new Promise((resolveTick) => { setTimeout(resolveTick, 5); });
    custodian.control.emit("data", helloFrame(custodian));
    const outcome = await promise;
    // The deliberate failure was injected only after the SAME epoch of the
    // worker was really observed, and the case is the expected fault.
    expect(outcome.faultCasePassed).toBe(true);
    expect(outcome.kind).toBe("fault-observed");
  }, REAL_SUPERVISOR_CASE_TIMEOUT_MS);
});

/**
 * The ORDER of the terminal channels of a draw.
 *
 * The custodian ends the domain on its own once the FINALIZE was authorised,
 * and the draw channel of the worker ends with it. The Host must not answer
 * that end with a COMMAND: a CANCEL that arrives after the custodian stopped
 * reading its control channel is a byte that the peer never reads, and the
 * close of a socket with unread data is a RESET, not an EOF.
 *
 * The cases below drive the ACTUAL supervisor with the fake custodian that
 * speaks the REAL protocol, and they read the ACTUAL control writes of the
 * Host - there is no oracle of their own.
 */
describe("the ORDER of the terminal channels of a draw", () => {
  beforeEach(() => {
    // The fake identities of the cases are ISOLATED: a fake custodian that
    // really closed in an earlier case is gone for the next one.
    procOverride.identities.clear();
    procOverride.gone.clear();
  });

  /**
   * Run ONE normal draw with the ACTUAL supervisor and the fake custodian
   * that speaks the REAL protocol.
   */
  async function runTheNormalDraw(): Promise<{
    custodian: FakeCustodian;
    outcome: Awaited<ReturnType<typeof runPositivePilot>>;
  }> {
    procOverride.identities.set(
      FAKE_CUSTODIAN_PID,
      statText(
        FAKE_CUSTODIAN_PID, "custodian", "S", process.pid,
        FAKE_CUSTODIAN_PID, FAKE_CUSTODIAN_PID, Number(FAKE_CUSTODIAN_TICKS)),
    );
    procOverride.identities.set(
      WORKER_PID,
      statText(WORKER_PID, "node", "S", FAKE_CUSTODIAN_PID, WORKER_PID, WORKER_PID, Number(WORKER_TICKS)),
    );
    const custodian = new FakeCustodian(FAKE_CUSTODIAN_PID, WORKER_PID, "answers");
    const { deps } = realDeps(custodian);
    const promise = runPositivePilot(OPTIONS, deps);
    await new Promise((resolveTick) => { setTimeout(resolveTick, 5); });
    custodian.control.emit("data", helloFrame(custodian));
    const outcome = await promise;
    return { custodian, outcome };
  }

  /** The messages that the Host wrote on the control channel, in order. */
  function controlMessages(custodian: FakeCustodian): string[] {
    return custodian.control.written.map((payload) => {
      try {
        const message = JSON.parse(payload.subarray(4).toString("utf8")) as { kind?: unknown };
        return String(message.kind ?? "?");
      } catch {
        return "?";
      }
    });
  }

  it("does NOT send a CANCEL when the finalisation was already authorised", async () => {
    // The candidate arrives, the FINALIZE is authorised, the receipt of the
    // custodian arrives and the draw channel ends: the custodian is finishing
    // the domain ON ITS OWN, and a CANCEL would be a command to a process
    // that is already gone.
    const { custodian, outcome } = await runTheNormalDraw();
    custodian.draw.emit("end");
    // The ACTUAL control writes of the Host: the fork was authorised and the
    // finalisation was asked for - and NO cancel was sent.
    expect(controlMessages(custodian)).toEqual(["AUTHORIZE_FORK", "FINALIZE"]);
    // And the draw really succeeded: the picture is there and the run is ok.
    expect(outcome.kind).toBe("ok");
    expect(outcome.exitCode).toBe(PILOT_EXIT_OK);
    expect(outcome.pictureBytes).toBe(PICTURE_BYTES);
    expect(outcome.pictureSha256).toBe(PICTURE_SHA256);
    expect(outcome.terminalProof).toBe(true);
    expect(outcome.originalFailure).toBeNull();
  });

  it("sends the CANCEL and FAILS when the draw ended WITHOUT the finalisation", async () => {
    // The draw channel ends before the candidate: the answer that was in it
    // may never be complete, and the custodian has to stop the domain. The
    // failure is REAL, and the cleanup is owned.
    // The SILENT custodian: the worker never answers, so the candidate can
    // NEVER be complete and the draw end below is DETERMINISTICALLY the
    // unauthorised one.
    const custodian = new FakeCustodian(FAKE_CUSTODIAN_PID, WORKER_PID, "silent");
    procOverride.identities.set(
      FAKE_CUSTODIAN_PID,
      statText(
        FAKE_CUSTODIAN_PID, "custodian", "S", process.pid,
        FAKE_CUSTODIAN_PID, FAKE_CUSTODIAN_PID, Number(FAKE_CUSTODIAN_TICKS)),
    );
    procOverride.identities.set(
      WORKER_PID,
      statText(WORKER_PID, "node", "S", FAKE_CUSTODIAN_PID, WORKER_PID, WORKER_PID, Number(WORKER_TICKS)),
    );
    const { deps } = realDeps(custodian);
    const promise = runPositivePilot(OPTIONS, deps);
    await new Promise((resolveTick) => { setTimeout(resolveTick, 5); });
    custodian.control.emit("data", helloFrame(custodian));
    // The draw really started: the custodian stated its identity and the
    // fork was authorised.
    await new Promise((resolveTick) => { setTimeout(resolveTick, 20); });
    // The draw channel ends BEFORE the candidate: the answer may never be
    // complete.
    custodian.draw.emit("end");
    // And the custodian really leaves: the owned cleanup of the failed draw
    // ends with it.
    custodian.close();
    const outcome = await promise;
    // The custodian was asked to stop: the CANCEL is the command that ends
    // the domain, and it is the OWNED cleanup of a failed draw.
    expect(controlMessages(custodian)).toContain("CANCEL");
    // And the finalisation was NEVER authorised: there is no FINALIZE.
    expect(controlMessages(custodian)).not.toContain("FINALIZE");
    // And the draw FAILED: it is not a success, and it is not a picture.
    expect(outcome.kind).toBe("failed");
    expect(outcome.pictureBytes).toBeNull();
    expect(outcome.originalFailure).not.toBeNull();
  });
});

describe("the reporting over a REAL destination", () => {
  /** A destination of the shape of the real one: a Writable that may fail. */
  class RealDestination extends Writable {
    readonly written: string[] = [];
    failWith: Error | null = null;

    override _write(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void {
      this.written.push(chunk.toString("utf8"));
      callback(this.failWith);
    }
  }

  it("revokes the final qualification when the destination fails LATE", async () => {
    // The ACTUAL command, the ACTUAL factory and a REAL destination: the
    // fault is really observed, and the destination really breaks when the
    // final report is written.
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const destination = new RealDestination();
    destination.failWith = Object.assign(new Error("EPIPE"), { code: "EPIPE" });
    const { deps, state } = depsOf(supervisor, {
      reportStream: destination,
      writeStderr: (text, callback) => { destination.write(text, callback); },
    });
    const code = await main([
      "--mode", "assertion-failure",
      "--expected-custodian-sha256", CUSTODIAN_SHA,
      "--expected-fixture-sha256", FIXTURE_SHA,
    ], deps);
    const final = evidenceOf(state, "final.json");
    // The final record says that the run is NOT the expected fault, even
    // though the exit code of the expected fault is 1 anyway.
    expect(final?.fault_case_passed).toBe(false);
    expect(final?.reporting_failure).not.toBeNull();
    // The report of the run really failed: the exit code of the command is
    // the one of an unreliable evidence (3), and it is NOT the exit code of
    // the expected fault (1).
    expect(code).toBe(3);
  });

  it("does NOT lose the owner when the destination breaks while the settlement is PENDING", async () => {
    // The draw is PENDING, the destination breaks, and the owner of the draw
    // keeps waiting for the SAME settlement: the barrier is not lost, and the
    // delivery happens after the terminal.
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 3, settlesOnStart: false,
    });
    const destination = new RealDestination();
    const { deps, state } = depsOf(supervisor, {
      reportStream: destination,
      writeStderr: (text, callback) => { destination.write(text, callback); },
      // The REAL clock of this case: the draw really stays pending while the
      // destination breaks.
      now: () => Date.now(),
      sleep: async (milliseconds) => {
        await new Promise((resolveSleep) => { setTimeout(resolveSleep, milliseconds); });
      },
    });
    const promise = main([
      "--mode", "normal",
      "--expected-custodian-sha256", CUSTODIAN_SHA,
      "--expected-fixture-sha256", FIXTURE_SHA,
    ], deps);
    // The destination breaks while the original settlement is still pending.
    await new Promise((resolveTick) => { setTimeout(resolveTick, 20); });
    destination.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    // The owner is still waiting for the SAME settlement: the draw was NOT
    // cancelled and it was NOT given up.
    expect(supervisor.cancelErrors).toEqual([]);
    expect(supervisor.calls.filter(call => call === "start").length).toBe(1);
    const code = await promise;
    // The failure of the reporting is a fact of the case, and the run ended
    // with the SAME owner: the final record was written after the terminal.
    // The exit code is the one of an unreliable evidence (3).
    expect(code).toBe(3);
    const final = evidenceOf(state, "final.json");
    expect(final?.reporting_failure).not.toBeNull();
    expect(final?.fault_case_passed).toBe(false);
  });
});

describe("the command of the positive pilot", () => {
  it("answers 2 for arguments it does not take", async () => {
    const supervisor = new StubSupervisor({ picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0 });
    const { deps, state } = depsOf(supervisor);
    const code = await main(["--mode", "production"], deps);
    expect(code).toBe(2);
    expect(state.stderr.join("")).toContain("REFUSED");
  });

  it("answers 0 for a normal draw that really succeeded", async () => {
    const supervisor = new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    });
    const { deps } = depsOf(supervisor);
    const { deps: probeDeps } = depsOf(new StubSupervisor({
      picture: Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE),
      error: null, held: false, worker: true, settlesAfterPolls: 0,
    }));
    const outcome = await runPositivePilot(OPTIONS, probeDeps);
    const verdict = verifyPublishedRun(outcome, outcome.root ?? "", probeDeps.readBytes);
    expect(verdict.accepted).toBe(true);
    expect(verdict.reasons).toEqual([]);
    const code = await main([
      "--mode", "normal",
      "--expected-custodian-sha256", CUSTODIAN_SHA,
      "--expected-fixture-sha256", FIXTURE_SHA,
    ], deps);
    expect(code).toBe(0);
  });

  it("answers 1 for the deliberate failure that was really observed", async () => {
    const supervisor = new StubSupervisor({
      picture: null, error: null, held: false, worker: true, settlesAfterPolls: 0, settlesOnStart: false,
    });
    const { deps } = depsOf(supervisor);
    const code = await main([
      "--mode", "assertion-failure",
      "--expected-custodian-sha256", CUSTODIAN_SHA,
      "--expected-fixture-sha256", FIXTURE_SHA,
    ], deps);
    expect(code).toBe(1);
  });
});

describe("the digest of the synthetic picture", () => {
  it("is the digest of exactly 1024 bytes of 0x4a", () => {
    expect(PICTURE_BYTES).toBe(1024);
    expect(PICTURE_BYTE).toBe(0x4a);
    expect(PICTURE_SHA256).toBe(
      createHash("sha256").update(Buffer.alloc(1024, 0x4a)).digest("hex"));
  });
});
