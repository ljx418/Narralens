import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import {
  CACHE_PROCESS_PROTOCOL,
  CacheChannelDecoder,
  CacheDeadline,
  CacheDrawError,
  CacheFrameQueue,
  CacheProcessSupervisor,
  CacheReceiptAccumulator,
  cacheDrawEndFailure,
  cacheEventChainDigest,
  canonicalCacheReceiptItem,
  cacheInterpretControlMessage,
  cacheInterpretDrawTerminal,
  cacheOpenControlState,
  collectCacheCleanupCauses,
  latchCacheOutcome,
  observeCacheProcessGroup,
  observeCacheProcessIdentity,
  parseCacheProcStat,
  validateCacheDomainReceipt,
  validateCacheExecutionReceipt,
} from "../../../src/adapters/openfilm/cache-process-supervisor.js";
import type {
  CacheDrawRequest,
  CacheReceiptExpectation,
} from "../../../src/adapters/openfilm/cache-process-supervisor.js";

/**
 * The identity of a process, as this Host reads it.
 *
 * These cases are PURE: they parse text, they read the identity of THIS process
 * from the kernel, and they ask one supervisor about the handles of another. No
 * child is born, no browser is started and no Host is run: a helper that was
 * spawned here would be a process whose own identity the case could not prove.
 *
 * The spawn is MOCKED, and the cases that do not start a draw say EXACTLY that
 * nothing was spawned. The P1R bytes of this file called `start` and claimed
 * that no process was born: the spawn really happened, the interpreter of the
 * custodian really started, and it really failed to find its script. The report
 * of that wave said "no real process" and that was not true.
 *
 * What they prove:
 *
 *  - the layout of /proc/<pid>/stat is read the way the kernel writes it: the
 *    PID is BEFORE the first parenthesis, the command name may hold spaces AND
 *    parentheses, and the field after the closing parenthesis is the STATE and
 *    never a number;
 *  - a process that cannot be read is UNKNOWN, and UNKNOWN is never "gone";
 *  - a handle of ANOTHER supervisor is refused - a real handle, not a lookalike;
 *  - the decoder of a private channel is bounded on EVERY arrival;
 *  - the SEGMENTS of a receipt are accumulated in order, and a segment that is
 *    missing, repeated, cut or forged is REFUSED;
 *  - the proof of the DOMAIN and the ELIGIBILITY of a success are two different
 *    questions: a draw whose resources really ended may still have failed;
 *  - the messages of the channels are interpreted by the REAL code of the pump:
 *    a message out of order, a `closed:false` and an EOF before the
 *    finalisation are failures, and they are failures HERE;
 *  - a candidate may still be UNDONE by a failure that came after it, and the
 *    first failure is never replaced;
 *  - the cleanup causes do not grow while they are walked.
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


/**
 * Script the ONE raw signal edge that a case needs.
 *
 * The script is EXPLICIT and the case asserts the call it received: a pure
 * case may never aim at a real process, not even at a synthetic number.
 */
function scriptRawKill(): { pid: number; signal: NodeJS.Signals | number }[] {
  const calls: { pid: number; signal: NodeJS.Signals | number }[] = [];
  rawEdges.scriptedKill = (pid, signal) => {
    rawEdges.scriptedCalls.push({ operation: "process.kill", detail: `${pid}/${String(signal)}` });
    if (signal === 0) {
      // The GROUP PROBE keeps the answer of the suite: the group is gone.
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    }
    calls.push({ pid, signal });
    return true;
  };
  return calls;
}
const spawnMock = vi.hoisted(() => vi.fn());
/**
 * The /proc of the cases: ONE process of this machine that the kernel may be
 * asked about. It is the ONLY thing that is faked at the kernel boundary, and
 * the process it describes leads its own session and its own group.
 */
const procOverride = vi.hoisted(() => ({
  path: null as string | null,
  text: "" as string,
  /** The errno of a read that could not be made, when there is one. */
  code: null as string | null,
}));
/** The errno of a removal that could not be made, when there is one. */
const rmOverride = vi.hoisted(() => ({ code: null as string | null }));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  fork: (...args: unknown[]) => denyRawEdge("child_process.fork"),
  exec: (...args: unknown[]) => denyRawEdge("child_process.exec"),
  execFile: (...args: unknown[]) => denyRawEdge("child_process.execFile"),
  execSync: (...args: unknown[]) => denyRawEdge("child_process.execSync"),
  execFileSync: (...args: unknown[]) => denyRawEdge("child_process.execFileSync"),
  spawnSync: (...args: unknown[]) => denyRawEdge("child_process.spawnSync"),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (path: string, options?: unknown) => {
      if (procOverride.path !== null && path === procOverride.path) {
        if (procOverride.code !== null) {
          throw Object.assign(new Error("the file could not be read"), { code: procOverride.code });
        }
        return procOverride.text;
      }
      return actual.readFileSync(path, options as never);
    },
    rmSync: (path: string, options?: unknown) => {
      if (rmOverride.code !== null) {
        throw Object.assign(new Error("the directory could not be removed"), { code: rmOverride.code });
      }
      return actual.rmSync(path, options as never);
    },
  };
});

const REQUEST: CacheDrawRequest = {
  root: "/tmp", base: "http://127.0.0.1:1", rel: "film.html", ms: -1, width: 480, overrides: null,
};

beforeEach(() => {
  // The group probe of the production is NOT scripted by default: a case that
  // needs it says so, with its own synthetic group.
  scriptedGroupProbe = null;
  spawnMock.mockReset();
  procOverride.path = null;
  procOverride.text = "";
  procOverride.code = null;
  rmOverride.code = null;
  // The mocked spawn NEVER starts anything: the draw that asks for it fails
  // with CUSTODIAN_NOT_BORN, and no process of this machine is involved.
  spawnMock.mockImplementation(() => {
    throw new Error("the pure cases must not start a process");
  });
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
});

/** A supervisor that is never started: it is a fact about the handles, not a draw. */
function supervisor(): CacheProcessSupervisor {
  return new CacheProcessSupervisor({
    vendorRoot: "/nonexistent/vendor",
    producerFile: "packages/openfilm/studio/server/pageframes.mjs",
    producerSha256: "0".repeat(64),
    workerPath: "/nonexistent/worker.mjs",
    custodianPath: "/nonexistent/custodian.py",
    pythonExecutable: "/usr/bin/python3.12",
  });
}

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
  // The real layout has its fields after the closing parenthesis: state, ppid,
  // pgrp, session, ... and the start time is the twentieth of them. Only the
  // ones this module reads have to be right, and the rest are placeholders.
  const tail = [
    state, String(ppid), String(pgrp), String(session),
    ...Array.from({ length: 15 }, () => "0"),
    String(startTicks),
  ];
  return `${pid} (${comm}) ${tail.join(" ")}`;
}

/**
 * The digest of the items of a segment.
 *
 * It is computed with the REAL function of the module: a second implementation
 * of the same text would be a second thing that may be wrong.
 */
function itemsDigest(items: readonly unknown[]): string {
  const digest = createHash("sha256");
  for (const item of items) {
    digest.update(`${canonicalCacheReceiptItem(item as { t: string; v: unknown })}\n`);
  }
  return digest.digest("hex");
}

describe("the identity of a process", () => {
  it("reads the PID before the first parenthesis and the STATE as a state", () => {
    const identity = parseCacheProcStat(statText(4242, "chrome", "S", 7, 4242, 4242, 987654));
    expect(identity).not.toBeNull();
    expect(identity?.pid).toBe(4242);
    expect(identity?.ppid).toBe(7);
    expect(identity?.pgid).toBe(4242);
    expect(identity?.sid).toBe(4242);
    expect(identity?.start_ticks).toBe(987654);
    expect(identity?.state).toBe("S");
  });

  it("reads a command name that holds spaces", () => {
    const identity = parseCacheProcStat(statText(11, "my process name", "R", 1, 11, 11, 5));
    expect(identity?.pid).toBe(11);
    expect(identity?.state).toBe("R");
    expect(identity?.start_ticks).toBe(5);
  });

  it("reads a command name that holds parentheses", () => {
    const identity = parseCacheProcStat(statText(12, "weird (name) here", "Z", 1, 12, 12, 6));
    expect(identity?.pid).toBe(12);
    expect(identity?.state).toBe("Z");
    expect(identity?.start_ticks).toBe(6);
  });

  it.each(["S", "R", "Z", "T", "D", "I"])("reads the state %s as a state and never as a number", (state) => {
    const identity = parseCacheProcStat(statText(13, "worker", state, 1, 13, 13, 7));
    expect(identity?.state).toBe(state);
    // The state is NOT a number, and it is never mistaken for the PID.
    expect(Number.isNaN(Number(identity?.state))).toBe(true);
    expect(identity?.pid).toBe(13);
  });

  it.each([
    ["an empty text", ""],
    ["a text without parentheses", "4242 S 1 2 3"],
    ["a text with too few fields", "4242 (chrome) S 1 2 3"],
    ["a text whose PID is not a number", "chrome (chrome) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19"],
    ["a text whose fields are not numbers", "4242 (chrome) S x 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19"],
  ])("refuses %s instead of inventing an identity", (_name, text) => {
    expect(parseCacheProcStat(text)).toBeNull();
  });

  it("reads the identity of THIS process from the kernel", () => {
    const observation = observeCacheProcessIdentity(process.pid);
    expect(observation.presence).toBe("known");
    expect(observation.identity?.pid).toBe(process.pid);
    expect(observation.identity?.ppid).toBeGreaterThan(0);
    expect(observation.identity?.pgid).toBeGreaterThan(0);
    expect(observation.identity?.sid).toBeGreaterThan(0);
    expect(observation.identity?.start_ticks).toBeGreaterThan(0);
    expect(observation.identity?.state).toMatch(/^[A-Za-z]$/u);
    // The PID is a number and the STATE is not: the old parser read the state as
    // the PID, so every identity came back null and every group looked empty.
    expect(Number.isNaN(Number(observation.identity?.pid))).toBe(false);
    expect(Number.isNaN(Number(observation.identity?.state))).toBe(true);
  });

  it("says that a process that is not there is gone", () => {
    const observation = observeCacheProcessIdentity(0x7ffffff0);
    expect(observation.presence).toBe("gone");
    expect(observation.identity).toBeNull();
  });

  it("tells the three states of a group apart", () => {
    // The group of THIS process is read from the kernel first: the pid of a
    // process is NOT the number of its group.
    const self = observeCacheProcessIdentity(process.pid);
    expect(self.presence).toBe("known");
    const pgid = self.identity!.pgid;
    const own = observeCacheProcessGroup(pgid);
    expect(own.presence).toBe("known");
    expect(own.members.some(member => member.pid === process.pid)).toBe(true);
    // A group that does not exist is gone - and only that is gone.
    //
    // The probe of a group is a RAW edge, and this case SCRIPTS it for this
    // ONE exact synthetic group: the answer of the kernel is the answer of
    // the script, and the number never reaches a real process.
    scriptGroupProbe(0x7ffffff0, "gone");
    const absent = observeCacheProcessGroup(0x7ffffff0);
    expect(absent.presence).toBe("gone");
    expect(absent.members).toEqual([]);
    // The probe REALLY happened, and it was the probe of THAT group: the
    // answer of the case is not the answer of a default.
    expect(rawEdges.scriptedCalls.some(call => call.detail === "-2147483632/0")).toBe(true);
  });
});

describe("the handles of a draw", () => {
  it("refuses a REAL handle of another supervisor", async () => {
    const mine = supervisor();
    const theirs = supervisor();
    const handle = mine.reserve(REQUEST);
    // The handle is real: this supervisor knows it.
    expect(mine.inspectCleanup(handle).known).toBe(true);
    // And the OTHER supervisor does not: the table is module wide, the authority
    // is not.
    expect(theirs.inspectCleanup(handle).known).toBe(false);
    await expect(theirs.reconcileCleanup(handle)).rejects.toMatchObject({ code: "DRAW_FOREIGN" });
    await expect(theirs.start(handle)).rejects.toMatchObject({ code: "DRAW_FOREIGN" });
    // NOTHING was spawned: the cases that do not start a draw really do not.
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty object", {}],
    ["a copy of the facts", { phase: "reserved", candidate_digest: null, cleanup_required: false }],
    ["a number", 4711],
    ["a string", "handle"],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s as a handle", async (_name, value) => {
    const owner = supervisor();
    expect(owner.inspectCleanup(value).known).toBe(false);
    await expect(owner.reconcileCleanup(value)).rejects.toMatchObject({ code: "DRAW_FOREIGN" });
    await expect(owner.start(value as never)).rejects.toMatchObject({ code: "DRAW_FOREIGN" });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("starts a draw only once", async () => {
    const owner = supervisor();
    const handle = owner.reserve(REQUEST);
    // The first start takes the reservation; the second one is a refusal and not
    // a second worker.
    const first = owner.start(handle);
    await expect(owner.start(handle)).rejects.toMatchObject({ code: "DRAW_ALREADY_STARTED" });
    // The mocked spawn refuses to start anything, so the draw ends as a SETTLED
    // failure - and exactly ONE spawn was asked for.
    const settlement = await first;
    expect(settlement.error).toBeInstanceOf(CacheDrawError);
    expect((settlement.error as CacheDrawError).code).toBe("CUSTODIAN_NOT_BORN");
    expect(spawnMock).toHaveBeenCalledTimes(1);
    // The argument vector of the custodian is FIXED: the interpreter, the
    // isolated flags and the script. The ticket of the draw is not in it.
    const argv = spawnMock.mock.calls[0] as unknown as [string, string[], unknown];
    expect(argv[0]).toBe("/usr/bin/python3.12");
    expect(argv[1]).toEqual(["-I", "-S", "-B", "/nonexistent/custodian.py"]);
    const options = argv[2] as { detached?: boolean; env?: Record<string, string> };
    // The custodian is the leader of its own session and its own group.
    expect(options.detached).toBe(true);
    // The HOME of the child is the PRIVATE one of the draw, and never the one of
    // the Host.
    expect(options.env?.HOME).not.toBe(process.env.HOME);
    expect(options.env?.HOME).toContain("narralens-cache-run-");
  });
});

describe("the decoder of a private channel", () => {
  it("takes the frames that are complete and keeps the rest", () => {
    const decoder = new CacheChannelDecoder(1024);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(5, 0);
    const frames = decoder.feed(Buffer.concat([header, Buffer.from("hello")]));
    expect(frames.map(frame => frame.toString("utf8"))).toEqual(["hello"]);
    expect(decoder.buffered).toBe(0);
  });

  it("refuses a frame that claims more than the channel may hold", () => {
    const decoder = new CacheChannelDecoder(64);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(1024, 0);
    expect(() => decoder.feed(header)).toThrow(CacheDrawError);
  });

  it("refuses the bytes that nobody reads when they grow past the limit", () => {
    const decoder = new CacheChannelDecoder(64);
    expect(() => decoder.feed(Buffer.alloc(128, 1))).toThrow(CacheDrawError);
  });

  it("accepts a frame of exactly the limit", () => {
    const decoder = new CacheChannelDecoder(64);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(60, 0);
    const frames = decoder.feed(Buffer.concat([header, Buffer.alloc(60, 2)]));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.length).toBe(60);
  });
});

describe("the queue of the decoded frames", () => {
  it("may not grow without a limit, in frames and in bytes", () => {
    const queue = new CacheFrameQueue<Buffer>(2, 100, frame => frame.length);
    expect(queue.push(Buffer.alloc(10))).toBe(true);
    expect(queue.push(Buffer.alloc(10))).toBe(true);
    expect(queue.full).toBe(true);
    expect(queue.push(Buffer.alloc(10))).toBe(false);
    expect(queue.length).toBe(2);
    expect(queue.bytes).toBe(20);
    // Taking a frame gives its bytes back.
    expect(queue.shift()?.length).toBe(10);
    expect(queue.bytes).toBe(10);
    expect(queue.push(Buffer.alloc(10))).toBe(true);
  });

  it("refuses a frame that does not fit in the bytes that are left", () => {
    const queue = new CacheFrameQueue<Buffer>(8, 100, frame => frame.length);
    expect(queue.push(Buffer.alloc(60))).toBe(true);
    expect(queue.push(Buffer.alloc(60))).toBe(false);
    expect(queue.length).toBe(1);
  });
});

describe("the segments of a receipt", () => {
  const eventItem = { t: "e", v: "an-event" };
  const waitItem = {
    t: "w",
    v: {
      pid: 200,
      status: { kind: "exited", code: 0 },
      order: 1,
      category: "worker",
      epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
    },
  };
  const identityItem = {
    t: "i",
    v: {
      pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20",
      completion: "waited-by-custodian",
    },
  };

  it("takes the segments in order and adds them up", () => {
    const accumulator = new CacheReceiptAccumulator();
    expect(accumulator.take({
      index: 0, count: 2, items: [eventItem, waitItem], items_digest: itemsDigest([eventItem, waitItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    expect(accumulator.take({
      index: 1, count: 2, items: [identityItem], items_digest: itemsDigest([identityItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    expect(state.segments).toBe(2);
    expect(state.events).toBe(1);
    expect(state.waits).toBe(1);
    expect(state.identities).toBe(1);
  });

  it("refuses a segment whose order is not a NUMBER", () => {
    // C06-ORDER: the wire types are STRICT. A string that looks like a
    // number is not a number, and Number("1") is not a segment order.
    const accumulator = new CacheReceiptAccumulator();
    expect(accumulator.take({
      index: "0", count: 1, items: [], items_digest: cacheEventChainDigest([]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/segment order/);
    const other = new CacheReceiptAccumulator();
    expect(other.take({
      index: 0, count: "1", items: [], items_digest: cacheEventChainDigest([]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/segment order/);
    const third = new CacheReceiptAccumulator();
    const identity = [{
      t: "i",
      v: {
        pid: "200", ppid: 100, pgid: 200, sid: 200, start_ticks: "20",
        completion: "waited-by-custodian",
      },
    }];
    expect(third.take({
      index: 0, count: 1, items: identity,
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
      items_digest: itemsDigest(identity),
    })).toMatch(/legal epoch/);
  });

  it("refuses a segment that arrives out of order, or twice", () => {
    const accumulator = new CacheReceiptAccumulator();
    expect(accumulator.take({
      index: 1, count: 2, items: [eventItem], items_digest: itemsDigest([eventItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/out of order/);
    const other = new CacheReceiptAccumulator();
    expect(other.take({
      index: 0, count: 2, items: [eventItem], items_digest: itemsDigest([eventItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    expect(other.take({
      index: 0, count: 2, items: [eventItem], items_digest: itemsDigest([eventItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/out of order/);
  });

  it("refuses segments that disagree about their number", () => {
    const accumulator = new CacheReceiptAccumulator();
    expect(accumulator.take({
      index: 0, count: 2, items: [eventItem], items_digest: itemsDigest([eventItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    expect(accumulator.take({
      index: 1, count: 3, items: [eventItem], items_digest: itemsDigest([eventItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/disagree/);
  });

  it("refuses a segment whose items do not match its digest", () => {
    const accumulator = new CacheReceiptAccumulator();
    expect(accumulator.take({
      index: 0, count: 1, items: [eventItem], items_digest: "0".repeat(64),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/digest/);
  });

  it("refuses the same identity twice", () => {
    const accumulator = new CacheReceiptAccumulator();
    expect(accumulator.take({
      index: 0, count: 2, items: [identityItem], items_digest: itemsDigest([identityItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    expect(accumulator.take({
      index: 1, count: 2, items: [identityItem], items_digest: itemsDigest([identityItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/twice/);
  });

  it("refuses an item of an unknown kind", () => {
    const accumulator = new CacheReceiptAccumulator();
    const item = { t: "x", v: 1 };
    expect(accumulator.take({
      index: 0, count: 1, items: [item], items_digest: itemsDigest([item]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/unknown kind/);
  });

  it("reads its state again and again, and it never consumes the accumulator", () => {
    const accumulator = new CacheReceiptAccumulator();
    // An EMPTY accumulator may be read: the digest of nothing is the digest of
    // nothing, and reading it does not close anything.
    const empty = accumulator.state();
    expect(empty.received).toBe(0);
    expect(empty.events_digest).toBe(itemsDigest([]));
    expect(accumulator.state()).toEqual(empty);
    // A PARTIAL state may be read as well.
    expect(accumulator.take({
      index: 0, count: 2, items: [eventItem, waitItem], items_digest: itemsDigest([eventItem, waitItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const partial = accumulator.state();
    expect(partial.events).toBe(1);
    expect(partial.waits).toBe(1);
    expect(partial.received).toBe(1);
    // The reading did NOT close the accumulator: the next segment is still
    // taken, and it is still counted.
    expect(accumulator.take({
      index: 1, count: 2, items: [identityItem], items_digest: itemsDigest([identityItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const finalState = accumulator.state();
    expect(finalState.received).toBe(2);
    expect(finalState.identities).toBe(1);
    // The FINAL state may be read as many times as one wants, and it is the
    // SAME every time.
    expect(accumulator.state()).toEqual(finalState);
    expect(accumulator.state()).toEqual(finalState);
  });

  it("still refuses a segment that arrives out of order, or with a forged digest", () => {
    const accumulator = new CacheReceiptAccumulator();
    expect(accumulator.take({
      index: 0, count: 2, items: [eventItem], items_digest: itemsDigest([eventItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    // The state was read: the accumulator was NOT weakened by the reading.
    accumulator.state();
    expect(accumulator.take({
      index: 2, count: 2, items: [eventItem], items_digest: itemsDigest([eventItem]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/out of order/);
    const forged = new CacheReceiptAccumulator();
    expect(forged.take({
      index: 0, count: 1, items: [eventItem], items_digest: "0".repeat(64),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/digest/);
    forged.state();
    expect(forged.reason).toMatch(/digest/);
  });
});

describe("the proof of the domain and the eligibility of a success", () => {
  const EVENTS = ["forked:200", "reaped:200"];
  const IDENTITY_ITEM = {
    t: "i",
    v: {
      pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20",
      completion: "waited-by-custodian",
    },
  };
  const WAIT_ITEM = {
    t: "w",
    v: {
      pid: 200,
      status: { kind: "exited", code: 0 },
      order: 1,
      category: "worker",
      epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
    },
  };

  function accumulatorOf(items: readonly unknown[] = [WAIT_ITEM, IDENTITY_ITEM]): CacheReceiptAccumulator {
    const accumulator = new CacheReceiptAccumulator();
    accumulator.take({
      index: 0, count: 1, items: [...items], items_digest: itemsDigest(items),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    });
    return accumulator;
  }

  const RECEIPT = {
    kind: "DOMAIN_REAPED",
    protocol: CACHE_PROCESS_PROTOCOL,
    receipt_version: 2,
    proof_kind: "complete-v2",
    creative_eligible: true,
    startup_kind: "forked-exec-succeeded",
    fork_attempt_state: "born",
    fork_errno: null,
    forked_pid: 200,
    worker_epoch: { pid: 200, pgid: 200, sid: 200, start_ticks: "20" },
    worker_wait: {
      pid: 200,
      status: { kind: "exited", code: 0 },
      order: 1,
      category: "worker",
      epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
    },
    last_actual_wait_ordinal: 1,
    echild_after_wait_ordinal: 1,
    group_disposition: "established-gone",
    stream_disposition: {
      stdout: { ownership: "acquired", bytes: 10, tail_bytes: 10, eof: true, read_error: null, disposition: "eof" },
      stderr: { ownership: "acquired", bytes: 10, tail_bytes: 10, eof: true, read_error: null, disposition: "eof" },
    },
    failed_terminal: null,
    draw_id: "draw-1",
    ticket_digest: "ticket-1",
    seq: 3,
    outcome: "reaped",
    custodian: { pid: 100, ppid: 7, pgid: 100, sid: 100, start_ticks: "10" },
    worker: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
    exec: { ok: true },
    signals: ["SIGTERM:group"],
    events_count: 2,
    events_digest: cacheEventChainDigest(EVENTS),
    waits_count: 1,
    waits_digest: "",
    identities_count: 1,
    identities_digest: "",
    segments: 1,
    events_truncated: false,
    identity_overflow: false,
    anchor_retained: true,
    echild: true,
    group_esrch: true,
    known_ids_gone: true,
    diagnostics_lost: false,
    stdout_bytes: 10,
    stderr_bytes: 10,
    failure: null,
    state: "exit",
  };

  const EXPECTED: CacheReceiptExpectation = {
    protocol: CACHE_PROCESS_PROTOCOL,
    draw_id: "draw-1",
    ticket_digest: "ticket-1",
    seq: 3,
    custodian: { pid: 100, ppid: 7, pgid: 100, sid: 100, start_ticks: "10" },
    worker: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
    forked_pid: 200,
  };

  /** A receipt whose digests agree with the accumulator. */
  function matching(): Record<string, unknown> {
    const state = accumulatorOf().state();
    return {
      ...RECEIPT,
      waits_digest: state.waits_digest,
      identities_digest: state.identities_digest,
      waits_count: state.waits,
      identities_count: state.identities,
      events_count: state.events,
      events_digest: state.events_digest,
    };
  }

  it("accepts a receipt that really proves the domain", () => {
    const receipt = matching();
    const state = accumulatorOf().state();
    expect(validateCacheDomainReceipt(receipt, EXPECTED, state)).toEqual({ ok: true, reason: null });
    expect(validateCacheExecutionReceipt(receipt, EXPECTED, state)).toEqual({ ok: true, reason: null });
  });

  it("proves the domain and checks the eligibility on the SAME accumulator", () => {
    // The production reads the state of the SAME accumulator twice: the proof
    // of the domain comes first, the eligibility of the success comes next,
    // and the inspection that follows reads it again. The bytes of a receipt
    // are digested ONCE, at the end: the second read threw, and the draw
    // could not finish even when the kernel and the receipt were perfect.
    const accumulator = new CacheReceiptAccumulator();
    expect(accumulator.take({
      index: 0, count: 1, items: [WAIT_ITEM, IDENTITY_ITEM], items_digest: itemsDigest([WAIT_ITEM, IDENTITY_ITEM]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    const receipt = {
      ...RECEIPT,
      waits_digest: state.waits_digest,
      identities_digest: state.identities_digest,
      waits_count: state.waits,
      identities_count: state.identities,
      events_count: state.events,
      events_digest: state.events_digest,
    };
    // The FIRST read: the proof of the domain.
    expect(validateCacheDomainReceipt(receipt, EXPECTED, state)).toEqual({ ok: true, reason: null });
    // The SECOND read of the SAME accumulator: the eligibility of the success.
    expect(validateCacheExecutionReceipt(receipt, EXPECTED, accumulator.state())).toEqual({ ok: true, reason: null });
    // And once more, for the inspection that comes after the proof.
    expect(validateCacheDomainReceipt(receipt, EXPECTED, accumulator.state())).toEqual({ ok: true, reason: null });
    // The counts and the digests of the receipt are the ones of the segments
    // that really arrived.
    expect(state.waits).toBe(1);
    expect(state.identities).toBe(1);
    expect(state.received).toBe(1);
    expect(receipt.waits_digest).toBe(state.waits_digest);
    expect(receipt.identities_digest).toBe(state.identities_digest);
  });

  it("refuses a receipt that is not there", () => {
    expect(validateCacheDomainReceipt(null, EXPECTED, null).ok).toBe(false);
    expect(validateCacheDomainReceipt(null, EXPECTED, accumulatorOf().state()).ok).toBe(false);
  });

  it("refuses a receipt of another draw, another request or another protocol", () => {
    const state = accumulatorOf().state();
    expect(validateCacheDomainReceipt({ ...matching(), draw_id: "draw-2" }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), ticket_digest: "ticket-2" }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), protocol: "other@1" }, EXPECTED, state).ok).toBe(false);
  });

  it("refuses a receipt that carries the wrong sequence number", () => {
    const state = accumulatorOf().state();
    expect(validateCacheDomainReceipt({ ...matching(), seq: 4 }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), seq: 2 }, EXPECTED, state).ok).toBe(false);
  });

  it("refuses a receipt that does not claim a reaped domain", () => {
    const state = accumulatorOf().state();
    expect(validateCacheDomainReceipt({ ...matching(), outcome: "unknown" }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), echild: false }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), group_esrch: false }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), known_ids_gone: false }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), events_truncated: true }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), identity_overflow: true }, EXPECTED, state).ok).toBe(false);
  });

  it("refuses a receipt whose chain of events was cut or changed", () => {
    const state = accumulatorOf().state();
    expect(validateCacheDomainReceipt({ ...matching(), events_count: 99 }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), events_digest: "0".repeat(64) }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), waits_count: 0 }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({ ...matching(), identities_count: 0 }, EXPECTED, state).ok).toBe(false);
  });

  it("refuses a receipt with NO wait at all", () => {
    // The counts agree with the segments that arrived, and there is no wait of
    // the worker among them: an empty list is not a proof of a reap.
    const accumulator = accumulatorOf([IDENTITY_ITEM]);
    const state = accumulator.state();
    const receipt = {
      ...matching(),
      waits_count: state.waits,
      waits_digest: state.waits_digest,
      identities_count: state.identities,
      identities_digest: state.identities_digest,
      events_count: state.events,
      events_digest: state.events_digest,
    };
    expect(validateCacheDomainReceipt(receipt, EXPECTED, state).ok).toBe(false);
  });

  it("refuses a receipt about another custodian, another worker or another epoch", () => {
    const state = accumulatorOf().state();
    expect(validateCacheDomainReceipt({
      ...matching(), custodian: { pid: 101, ppid: 7, pgid: 100, sid: 100, start_ticks: "10" },
    }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({
      ...matching(), custodian: { pid: 100, ppid: 7, pgid: 101, sid: 100, start_ticks: "10" },
    }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({
      ...matching(), custodian: { pid: 100, ppid: 7, pgid: 100, sid: 100, start_ticks: "11" },
    }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({
      ...matching(), worker: { pid: 201, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
    }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({
      ...matching(), worker: { pid: 200, ppid: 100, pgid: 201, sid: 200, start_ticks: "20" },
    }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt({
      ...matching(), worker: { pid: 200, ppid: 101, pgid: 200, sid: 200, start_ticks: "20" },
    }, EXPECTED, state).ok).toBe(false);
  });

  it("never delivers a receipt whose exec did not work", () => {
    const state = accumulatorOf().state();
    const receipt = { ...matching(), exec: { ok: false, errno: 2 } };
    // The DOMAIN may really be gone - the failed worker was really waited
    // for, and that is the proof that the resources really ended.
    expect(validateCacheDomainReceipt(receipt, EXPECTED, state).ok).toBe(true);
    // And the draw may NEVER be delivered: the exec did not work.
    expect(validateCacheExecutionReceipt(receipt, EXPECTED, state).ok).toBe(false);
  });

  it("keeps the proof of the domain and the eligibility of a success apart", () => {
    const state = accumulatorOf().state();
    // The diagnostics were lost: the domain may really be gone, but the draw may
    // NOT be delivered, and it may not be held for ever either.
    const lost = { ...matching(), diagnostics_lost: true };
    expect(validateCacheDomainReceipt(lost, EXPECTED, state).ok).toBe(true);
    expect(validateCacheExecutionReceipt(lost, EXPECTED, state).ok).toBe(false);
    // The same for a budget that was exceeded and for a failure of the
    // custodian itself.
    expect(validateCacheExecutionReceipt({ ...matching(), stdout_bytes: 70000 }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheExecutionReceipt({
      ...matching(), failure: { code: "DIAGNOSTIC_BUDGET", message: "too much" },
    }, EXPECTED, state).ok).toBe(false);
    expect(validateCacheExecutionReceipt({ ...matching(), state: "recovery_held" }, EXPECTED, state).ok).toBe(false);
  });

/**
 * The receipt of the VERSION 2 of the private protocol.
 *
 * The version, the kind of the proof and the startup kind are DISCRIMINANTS:
 * a receipt that does not name one of them is refused, and there is no
 * fallback to an older version.
 */
describe("the receipt of the version 2 of this protocol", () => {
  /** A receipt of the version 2 that proves a domain that really ended. */
  function complete(): Record<string, unknown> {
    const state = accumulatorOf().state();
    return {
      ...RECEIPT,
      waits_digest: state.waits_digest,
      waits_count: state.waits,
      events_digest: state.events_digest,
      events_count: state.events,
      identities_digest: state.identities_digest,
      identities_count: state.identities,
    };
  }

  it("keeps the wait of the WORKER when the retained facts did not fit", () => {
    // C06-BOUND: more than 256 adopted waits and no more than 512
    // identities. The retained facts are bounded, and the wait of the worker
    // has a slot of its own: it is never lost to that bound.
    const accumulator = new CacheReceiptAccumulator();
    const adopted = Array.from({ length: 300 }, (_value, index) => ({
      t: "w",
      v: {
        pid: 1000 + index,
        status: { kind: "exited", code: 0 },
        order: index + 1,
        category: "adopted",
        epoch: { pid: 1000 + index, ppid: 100, pgid: 1000 + index, sid: 1000 + index, start_ticks: String(index + 1) },
      },
    }));
    const worker = {
      t: "w",
      v: {
        pid: 200,
        status: { kind: "exited", code: 0 },
        order: 301,
        category: "worker",
        epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
      },
    };
    const items = [...adopted, worker];
    expect(accumulator.take({
      index: 0, count: 1, items, items_digest: itemsDigest(items),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    // The facts are bounded, and the fact that they did not fit is not
    // hidden.
    expect(state.wait_facts.length).toBeLessThanOrEqual(256);
    expect(state.wait_facts_truncated).toBe(true);
    // And the wait of the WORKER is still there: it has a slot of its own,
    // and it was the LAST wait that really happened.
    expect(state.worker_wait?.pid).toBe(200);
    expect(state.worker_wait?.order).toBe(301);
    expect(state.last_wait_order).toBe(301);
  });

  it("treats the same number with another epoch as ANOTHER identity", () => {
    // C06-EPOCH: the identity of a process is its number AND its ticks.
    const accumulator = new CacheReceiptAccumulator();
    const first = {
      t: "i",
      v: {
        pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20",
        completion: "waited-by-custodian",
      },
    };
    const second = {
      t: "i",
      v: {
        pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "21",
        completion: "waited-by-custodian",
      },
    };
    expect(accumulator.take({
      index: 0, count: 2, items: [first], items_digest: itemsDigest([first]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    // Another epoch of the same number is another process: it is accepted.
    expect(accumulator.take({
      index: 1, count: 2, items: [second], items_digest: itemsDigest([second]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    expect(accumulator.state().identities).toBe(2);
    // And the SAME epoch twice is refused.
    const other = new CacheReceiptAccumulator();
    expect(other.take({
      index: 0, count: 2, items: [first], items_digest: itemsDigest([first]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    expect(other.take({
      index: 1, count: 2, items: [first], items_digest: itemsDigest([first]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/same identity twice/);
  });

  it("refuses a segment that belongs to ANOTHER draw", () => {
    // C06-BIND: the binding of the segments is immutable, and a segment of
    // another draw is a segment of another receipt.
    const accumulator = new CacheReceiptAccumulator();
    const items = [{ t: "e", v: "an-event" }];
    expect(accumulator.take({
      index: 0, count: 2, items, items_digest: itemsDigest(items),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    expect(accumulator.take({
      index: 1, count: 2, items, items_digest: itemsDigest(items),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-2", ticket_digest: "ticket-1",
    })).toMatch(/another draw/);
  });

  it("refuses a wait that is not a TERMINAL one", () => {
    // C06-WAIT: stopped, continued and unknown are not the end of a
    // process.
    const accumulator = new CacheReceiptAccumulator();
    const stopped = {
      t: "w",
      v: {
        pid: 200,
        status: { kind: "stopped", signal: "SIGSTOP" },
        order: 1,
        category: "worker",
        epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
      },
    };
    expect(accumulator.take({
      index: 0, count: 1, items: [stopped], items_digest: itemsDigest([stopped]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toMatch(/legal terminal fact/);
  });

  it("accepts the FAILED proof of a draw whose worker was NOT the last wait", () => {
    // C08-LATEWAIT: the worker was really waited for, and a LATER wait
    // happened - the domain really ended, and the draw really failed. The
    // complete result is refused, and the FAILED proof of the resources still
    // holds.
    const accumulator = new CacheReceiptAccumulator();
    const worker = {
      t: "w",
      v: {
        pid: 200,
        status: { kind: "exited", code: 0 },
        order: 1,
        category: "worker",
        epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
      },
    };
    const late = {
      t: "w",
      v: {
        pid: 201,
        status: { kind: "exited", code: 0 },
        order: 2,
        category: "adopted",
        epoch: { pid: 201, ppid: 100, pgid: 201, sid: 201, start_ticks: "21" },
      },
    };
    const items = [worker, late];
    expect(accumulator.take({
      index: 0, count: 1, items, items_digest: itemsDigest(items),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    const certificate = {
      ...((failedExecReceipt().failed_terminal) as Record<string, unknown>),
      worker_wait: {
        pid: 200,
        status: { kind: "exited", code: 0 },
        order: 1,
        category: "worker",
        epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
      },
      worker_wait_was_last: false,
      post_worker_wait_count: 1,
      echild_after_wait_ordinal: 2,
    };
    const receipt = {
      ...failedExecReceipt(),
      waits_digest: state.waits_digest,
      waits_count: state.waits,
      events_digest: state.events_digest,
      events_count: state.events,
      identities_digest: state.identities_digest,
      identities_count: state.identities,
      failed_terminal: certificate,
    };
    const unbound: CacheReceiptExpectation = { ...EXPECTED, worker: null };
    // The DOMAIN really ended, and the draw really failed: the FAILED proof
    // holds even though the worker was not the last wait.
    expect(validateCacheDomainReceipt(receipt, unbound, state).reason).toBe(null);
    expect(validateCacheDomainReceipt(receipt, unbound, state).ok).toBe(true);
    // And it is NEVER a result.
    expect(validateCacheExecutionReceipt(receipt, unbound, state).ok).toBe(false);
  });

  it("refuses the DOMAIN of a draw that never had a receipt", () => {
    // C06-EXEC: the Host-only branches. A draw that never came to life, or a
    // custodian that was never authorised, has NO receipt - and the proof of
    // the domain may not be invented from the absence of one.
    const accumulator = new CacheReceiptAccumulator();
    const state = accumulator.state();
    expect(validateCacheDomainReceipt(null, EXPECTED, state).ok).toBe(false);
    expect(validateCacheDomainReceipt(failedExecReceipt(), EXPECTED, null).ok).toBe(false);
  });

  it("refuses a receipt that does not carry the version", () => {
    // C06-BIND: the receipt is of an older version, and there is NO fallback
    // to it: the two ends of the protocol are released together.
    const { receipt_version: _omittedVersion, ...withoutVersion } = complete();
    const receipt = withoutVersion as Record<string, unknown>;
    const state = accumulatorOf().state();
    expect(validateCacheDomainReceipt(receipt, EXPECTED, state).ok).toBe(false);
    const older = { ...complete(), receipt_version: 1 };
    expect(validateCacheDomainReceipt(older, EXPECTED, state).ok).toBe(false);
  });

  it("refuses a segment that does not carry the version", () => {
    // C06-BIND: the segment of the receipt is of an older version.
    const state = cacheOpenControlState();
    const older = {
      seq: 1, kind: "RECEIPT_SEGMENT", index: 0, count: 1,
      items: [], items_digest: cacheEventChainDigest([]),
    };
    expect(cacheInterpretControlMessage(state, older).ok).toBe(false);
    expect(state.failure?.code).toBe("PROTOCOL_UNEXPECTED");
    // And the version 2 of the very same segment is accepted.
    const fresh = cacheOpenControlState();
    expect(cacheInterpretControlMessage(fresh, { ...older, receipt_version: 2 }).ok).toBe(true);
  });

  it("refuses a receipt of another draw, another request or another protocol", () => {
    // C06-BIND: the binding is checked before anything else.
    const state = accumulatorOf().state();
    for (const receipt of [
      { ...complete(), draw_id: "draw-2" },
      { ...complete(), ticket_digest: "ticket-2" },
      { ...complete(), protocol: "narralens.openfilm-cache-process@2" },
    ]) {
      expect(validateCacheDomainReceipt(receipt, EXPECTED, state).ok).toBe(false);
    }
  });

  it("refuses a receipt that does not name a kind of proof", () => {
    // C08-FORGE: the kind of the proof is a discriminant.
    const state = accumulatorOf().state();
    for (const receipt of [
      { ...complete(), proof_kind: "complete-v1" },
      { ...complete(), proof_kind: null },
      { ...complete(), proof_kind: 2 },
    ]) {
      expect(validateCacheDomainReceipt(receipt, EXPECTED, state).ok).toBe(false);
    }
  });

  it("refuses a complete receipt that does not claim the creative result", () => {
    // C08-FORGE: the creative eligibility of a complete proof is REQUIRED: it
    // may not be missing and it may not be of another type.
    const state = accumulatorOf().state();
    for (const receipt of [
      { ...complete(), creative_eligible: undefined },
      { ...complete(), creative_eligible: "true" },
      { ...complete(), creative_eligible: null },
    ]) {
      // The first one has NO creative_eligible at all: the serialization of
      // a missing field is a missing field.
      const without = { ...receipt } as Record<string, unknown>;
      if (without.creative_eligible === undefined) {
        const { creative_eligible: _omitted, ...rest } = without;
        expect(validateCacheExecutionReceipt(rest, EXPECTED, state).ok).toBe(false);
        continue;
      }
      expect(validateCacheExecutionReceipt(without, EXPECTED, state).ok).toBe(false);
    }
  });

  it("accepts the FAILED TERMINAL proof of the resources, and NEVER a result", () => {
    // The worker of a draw that never execed was NEVER BOUND: the Host does
    // not know its epoch, and the certificate says so with an explicit null.
    const unbound: CacheReceiptExpectation = { ...EXPECTED, worker: null };
    // C08-END: the resources of a failed draw really ended, and the draw
    // really failed: the two facts are separate.
    const accumulator = new CacheReceiptAccumulator();
    const wait = {
      t: "w",
      v: {
        pid: 200,
        status: { kind: "exited", code: 1 },
        order: 1,
        category: "worker",
        epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
      },
    };
    expect(accumulator.take({
      index: 0, count: 1, items: [wait], items_digest: itemsDigest([wait]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    const receipt = {
      ...failedExecReceipt(),
      waits_digest: state.waits_digest,
      waits_count: state.waits,
      events_digest: state.events_digest,
      events_count: state.events,
      identities_digest: state.identities_digest,
      identities_count: state.identities,
      failed_terminal: {
        ...(failedExecReceipt().failed_terminal as Record<string, unknown>),
        lifetime: {
          ...((failedExecReceipt().failed_terminal as Record<string, unknown>).lifetime as Record<string, unknown>),
          events_digest: state.events_digest,
          events_count: state.events,
          waits_digest: state.waits_digest,
          waits_count: state.waits,
          identities_digest: state.identities_digest,
          identities_count: state.identities,
        },
      },
    };
    // The DOMAIN is really gone: the failed worker was really waited for.
    expect(validateCacheDomainReceipt(receipt, unbound, state).ok).toBe(true);
    // And the draw is NEVER a success: a failed terminal proof delivers no
    // result, and it is not an expected fault either.
    expect(validateCacheExecutionReceipt(receipt, unbound, state).ok).toBe(false);
  });

  it("refuses a failed terminal proof that is forged", () => {
    // C08-FORGE: every one of these claims a resource end that it does not
    // prove, and each of them is refused.
    const accumulator = new CacheReceiptAccumulator();
    const wait = {
      t: "w",
      v: {
        pid: 200,
        status: { kind: "exited", code: 1 },
        order: 1,
        category: "worker",
        epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
      },
    };
    expect(accumulator.take({
      index: 0, count: 1, items: [wait], items_digest: itemsDigest([wait]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    const base = {
      ...failedExecReceipt(),
      waits_digest: state.waits_digest,
      waits_count: state.waits,
      events_digest: state.events_digest,
      events_count: state.events,
      identities_digest: state.identities_digest,
      identities_count: state.identities,
    };
    const without = (field: string): Record<string, unknown> => {
      const copy = { ...base } as Record<string, unknown>;
      delete copy[field];
      return copy;
    };
    const withCertificate = (change: (proof: Record<string, unknown>) => void): Record<string, unknown> => {
      const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      change(copy.failed_terminal as Record<string, unknown>);
      return copy;
    };
    for (const receipt of [
      // The creative eligibility may not be true, and it may not be missing.
      { ...base, creative_eligible: true },
      without("creative_eligible"),
      without("failed_terminal"),
      { ...base, failed_terminal: null },
      { ...base, failed_terminal: "ended" },
      { ...base, failure: null },
      // The certificate may not claim a resource end that it does not prove.
      withCertificate(proof => { proof.resource_proof_complete = false; }),
      withCertificate(proof => { proof.subreaper_before_fork = false; }),
      withCertificate(proof => { proof.sole_wait_owner = false; }),
      withCertificate(proof => { proof.no_new_fork_after_termination = false; }),
      withCertificate(proof => { proof.retained_epochs_gone = false; }),
      withCertificate(proof => { proof.original_group_state = "unknown"; }),
      withCertificate(proof => { proof.worker_wait_was_last = false; }),
      withCertificate(proof => { proof.post_worker_echild = false; }),
      withCertificate(proof => { proof.echild_after_wait_ordinal = 0; }),
      withCertificate(proof => { proof.worker_wait = { pid: 999, status: { kind: "exited", code: 1 }, ordinal: 1 }; }),
      withCertificate(proof => { proof.custodian_epoch = { pid: 999, start_ticks: "10" }; }),
    ]) {
      expect(validateCacheDomainReceipt(receipt, EXPECTED, state).ok).toBe(false);
    }
  });

  it("refuses a failed terminal proof whose wait never arrived", () => {
    // C08-FORGE: a count of waits is not a proof, and the wait of ANOTHER
    // process is not the wait of the worker that failed.
    const accumulator = new CacheReceiptAccumulator();
    const other = {
      t: "w",
      v: {
        pid: 999,
        status: { kind: "exited", code: 0 },
        order: 1,
        category: "adopted",
        epoch: { pid: 999, ppid: 100, pgid: 999, sid: 999, start_ticks: "30" },
      },
    };
    expect(accumulator.take({
      index: 0, count: 1, items: [other], items_digest: itemsDigest([other]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    expect(validateCacheDomainReceipt(failedExecReceipt(), EXPECTED, state).ok).toBe(false);
  });


});
});

describe("the interpretation of the messages of the channels", () => {
  it("refuses a control message that arrived out of order", () => {
    const state = cacheOpenControlState();
    expect(cacheInterpretControlMessage(state, { seq: 1, kind: "C_HELLO" }).ok).toBe(true);
    expect(cacheInterpretControlMessage(state, { seq: 3, kind: "FORKED" }).ok).toBe(false);
    expect(state.failure?.code).toBe("PROTOCOL_UNEXPECTED");
  });

  it("accumulates the segments and captures the receipt", () => {
    const state = cacheOpenControlState();
    expect(cacheInterpretControlMessage(state, { seq: 1, kind: "RECEIPT_SEGMENT", receipt_version: 2, index: 0, count: 1, items: [], items_digest: cacheEventChainDigest([]) }).ok).toBe(true);
    expect(cacheInterpretControlMessage(state, { seq: 2, kind: "DOMAIN_REAPED" }).ok).toBe(true);
    expect(state.receipt?.kind).toBe("DOMAIN_REAPED");
    expect(state.receiptSeq).toBe(2);
    expect(state.accumulator.state().segments).toBe(1);
  });

  it("refuses a segment after the summary, and a second summary", () => {
    // C06-ORDER: the summary is the LAST message of the receipt, it happens
    // once, and neither of them rewrites the facts that are already there.
    const state = cacheOpenControlState();
    expect(cacheInterpretControlMessage(state, {
      seq: 1, kind: "RECEIPT_SEGMENT", receipt_version: 2, index: 0, count: 1,
      items: [], items_digest: cacheEventChainDigest([]),
    }).ok).toBe(true);
    expect(cacheInterpretControlMessage(state, { seq: 2, kind: "DOMAIN_REAPED" }).ok).toBe(true);
    const first = state.receipt;
    // A segment after the summary is refused.
    const late = cacheOpenControlState();
    expect(cacheInterpretControlMessage(late, {
      seq: 1, kind: "RECEIPT_SEGMENT", receipt_version: 2, index: 0, count: 1,
      items: [], items_digest: cacheEventChainDigest([]),
    }).ok).toBe(true);
    expect(cacheInterpretControlMessage(late, { seq: 2, kind: "DOMAIN_REAPED" }).ok).toBe(true);
    expect(cacheInterpretControlMessage(late, {
      seq: 3, kind: "RECEIPT_SEGMENT", receipt_version: 2, index: 1, count: 1,
      items: [], items_digest: cacheEventChainDigest([]),
    }).ok).toBe(false);
    // And a SECOND summary does not replace the first one.
    const twice = cacheOpenControlState();
    expect(cacheInterpretControlMessage(twice, { seq: 1, kind: "DOMAIN_REAPED" }).ok).toBe(true);
    const kept = twice.receipt;
    expect(cacheInterpretControlMessage(twice, { seq: 2, kind: "DOMAIN_REAPED" }).ok).toBe(false);
    expect(twice.receipt).toBe(kept);
    expect(first).not.toBeNull();
  });

  it("refuses a segment that was cut", () => {
    const state = cacheOpenControlState();
    expect(cacheInterpretControlMessage(state, {
      seq: 1, kind: "RECEIPT_SEGMENT", receipt_version: 2, index: 0, count: 1, items: [{ t: "e", v: "x" }], items_digest: "0".repeat(64),
    }).ok).toBe(false);
    expect(state.failure?.code).toBe("RECEIPT_SEGMENT_REFUSED");
  });

  it("reads a closed message that failed as a failure of the draw", () => {
    expect(cacheInterpretDrawTerminal({ kind: "closed", closed: true })).toBeNull();
    const failed = cacheInterpretDrawTerminal({
      kind: "closed", closed: false,
      error: { name: "Error", message: "the browser did not close" },
    });
    expect(failed?.code).toBe("WORKER_CLOSE_FAILED");
    expect(failed?.message).toContain("the browser did not close");
    const fatal = cacheInterpretDrawTerminal({
      kind: "fatal", error: { name: "Error", message: "the producer failed" },
    });
    expect(fatal?.code).toBe("WORKER_FAILED");
    expect(cacheInterpretDrawTerminal({ kind: "whatever" })?.code).toBe("PROTOCOL_UNEXPECTED");
  });

  it("reads the end of the draw channel as a failure only BEFORE the finalisation", () => {
    // The worker is gone and the answer may never be complete.
    expect(cacheDrawEndFailure(false)?.code).toBe("DRAW_EOF_BEFORE_FINALIZE");
    // After the finalisation it is the normal end of the worker.
    expect(cacheDrawEndFailure(true)).toBeNull();
  });
});

describe("the latch of the outcome", () => {
  it("latches the first failure", () => {
    const first = latchCacheOutcome({ kind: "none", code: null, message: null, native_phase: null },
      "FIRST", "the first thing that went wrong");
    expect(first.kind).toBe("failure");
    expect(first.code).toBe("FIRST");
  });

  it("undoes a candidate that a later failure took away", () => {
    // The P1R bytes REFUSED to latch a failure once a candidate was there: a
    // fatal error after the candidate was ignored, and the draw was delivered
    // as a success.
    const candidate = { kind: "candidate" as const, code: null, message: null, native_phase: null };
    const latched = latchCacheOutcome(candidate, "AFTER", "the failure that came after the candidate");
    expect(latched.kind).toBe("failure");
    expect(latched.code).toBe("AFTER");
  });

  it("never replaces a failure that is already there", () => {
    const failure = { kind: "failure" as const, code: "FIRST", message: "first", native_phase: null };
    const latched = latchCacheOutcome(failure, "SECOND", "second");
    expect(latched.code).toBe("FIRST");
    expect(latched).toBe(failure);
  });
});

describe("the cleanup causes of a held draw", () => {
  it("does not grow while it is walked", () => {
    // The P1R bytes walked the very array they wrote to: the loop never ended
    // and the Host ran out of memory.
    const causes: unknown[] = [new Error("the first cause")];
    const collected = collectCacheCleanupCauses(causes, causes);
    expect(collected.causes.length).toBe(1);
    expect(collected.truncated).toBe(false);
    // The array that was handed over is NOT the array that was returned.
    expect(collected.causes).not.toBe(causes);
  });

  it("keeps the causes that are new, and says so when they did not fit", () => {
    const first = new Error("one");
    const second = new Error("two");
    const collected = collectCacheCleanupCauses([first], [second]);
    expect(collected.causes).toEqual([first, second]);
    const many = Array.from({ length: 200 }, (_value, index) => new Error(`cause ${index}`));
    const bounded = collectCacheCleanupCauses([], many);
    expect(bounded.causes.length).toBeLessThanOrEqual(64);
    expect(bounded.truncated).toBe(true);
  });
});

describe("the deadline of the startup chain", () => {
  it("is ONE budget that is never restarted", () => {
    const deadline = new CacheDeadline(1_000);
    expect(deadline.remaining(0)).toBe(1_000);
    // The second step of the chain spends the budget of the chain: it does not
    // get a fresh budget of its own.
    expect(deadline.remaining(700)).toBe(300);
    expect(deadline.remaining(1_500)).toBe(0);
    expect(deadline.expired(1_000)).toBe(true);
    expect(deadline.expired(999)).toBe(false);
  });
});

/**
 * A channel of a private draw, as a fake: it receives what the Host writes and
 * it delivers what the custodian sends.
 */
class FakeChannel extends EventEmitter {
  readonly written: Buffer[] = [];

  write(payload: Buffer): boolean {
    this.written.push(payload);
    return true;
  }
}

/** A child of the Host, as a fake: it is driven by the case, never by a kernel. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly draw = new FakeChannel();
  readonly control = new FakeChannel();
  readonly stdio: unknown[];
  exitCode: number | null = null;
  signalCode: string | null = null;

  constructor(readonly pid: number | undefined) {
    super();
    this.stdio = [null, this.stdout, this.stderr, this.draw, this.control];
  }
}

/** One frame of a private channel, as the custodian writes it. */
function frameOf(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/** The number of the custodian of the cases, and the epoch it claims. */
const CUSTODIAN_PID = 4242;
const CUSTODIAN_TICKS = "12345";

describe("the startup of a draw that never came to life", () => {
  it("ends as the ORIGINAL failure of the start, and it is NOT held", async () => {
    // The spawn failed: there was never a child, and Node does not emit an
    // exit for it. The error and the REAL close are the facts.
    const child = new FakeChild(undefined);
    spawnMock.mockImplementation(() => child);
    const instance = supervisor();
    const handle = instance.reserve({
      root: "/tmp", base: "http://127.0.0.1:1", rel: "film.html",
      ms: -1, width: 480, overrides: null,
    });
    setImmediate(() => {
      child.emit("error", Object.assign(new Error("spawn EAGAIN"), { code: "EAGAIN" }));
      child.control.emit("close");
      child.emit("close", -2, null);
    });
    const settlement = await instance.start(handle);
    // The draw ENDED: it is not held for ever, and there is nothing to wait for.
    expect(settlement.error).not.toBeNull();
    expect((settlement.error as { code?: string }).code).toBe("CUSTODIAN_NOT_BORN");
    expect((settlement.error as { message?: string }).message).toContain("EAGAIN");
    const inspection = instance.inspectCleanup(handle);
    expect(inspection.settled).toBe(true);
    expect(inspection.cleanup_required).toBe(false);
    // And no child was ever born: there is no epoch and no worker.
    expect(inspection.custodian_pid).toBeNull();
    expect(inspection.worker_pid).toBeNull();
});
});


/**
 * The receipt of a draw whose worker really FAILED to exec.
 *
 * It is the FAILED TERMINAL proof of the resources: the resources of the
 * draw really ended, and the draw really failed. It never carries a result.
 */
const failedExecReceipt = (): Record<string, unknown> => ({
  kind: "DOMAIN_REAPED",
  protocol: CACHE_PROCESS_PROTOCOL,
  receipt_version: 2,
  proof_kind: "failed-terminal-v1",
  creative_eligible: false,
  failure: { code: "EXEC_FAILED", message: "the worker could not be execed" },
  startup_kind: "forked-setup-failed",
  fork_attempt_state: "born",
  fork_errno: null,
  forked_pid: 200,
  worker_epoch: null,
  worker_wait: {
    pid: 200,
    status: { kind: "exited", code: 1 },
    order: 1,
    category: "worker",
    epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
  },
  last_actual_wait_ordinal: 1,
  echild_after_wait_ordinal: 1,
  group_disposition: "established-gone",
  stream_disposition: {
    stdout: { ownership: "acquired", bytes: 0, tail_bytes: 0, eof: true, read_error: null, disposition: "eof" },
    stderr: { ownership: "acquired", bytes: 0, tail_bytes: 0, eof: true, read_error: null, disposition: "eof" },
  },
  failed_terminal: {
    version: 1,
    root_scope: "sole-custodian-subtree",
    custodian_epoch: { pid: 100, ppid: 7, pgid: 100, sid: 100, start_ticks: "10" },
    forked_pid: 200,
    worker_epoch: null,
    subreaper_before_fork: true,
    sole_wait_owner: true,
    no_new_fork_after_termination: true,
    worker_wait: {
      pid: 200,
      status: { kind: "exited", code: 1 },
      order: 1,
      category: "worker",
      epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
    },
    post_worker_echild: true,
    echild_after_wait_ordinal: 1,
    original_group_state: "gone",
    retained_epochs_gone: true,
    anchor_preserved_until_worker_wait: true,
    worker_wait_was_last: true,
    post_worker_wait_count: 0,
    authority_revoked: true,
    lifetime: {
      events: 0, waits: 1, identities: 0,
      events_digest: cacheEventChainDigest([]),
      waits_digest: cacheEventChainDigest([]), identities_digest: cacheEventChainDigest([]),
      events_truncated: false, identity_overflow: false, transcript_complete: false,
    },
    stream_disposition: {
      stdout: { ownership: "acquired", bytes: 0, tail_bytes: 0, eof: true, read_error: null, disposition: "eof" },
      stderr: { ownership: "acquired", bytes: 0, tail_bytes: 0, eof: true, read_error: null, disposition: "eof" },
    },
    resource_proof_complete: true,
  },
  draw_id: "draw-1",
  ticket_digest: "ticket-1",
  seq: 3,
  outcome: "reaped",
  custodian: { pid: 100, ppid: 7, pgid: 100, sid: 100, start_ticks: "10" },
  worker: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
  exec: { ok: false, errno: 13 },
  signals: ["SIGTERM:group"],
  events_count: 0,
  events_digest: cacheEventChainDigest([]),
  waits_count: 1,
  waits_digest: "",
  identities_count: 0,
  identities_digest: "",
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
  state: "exit",
});

describe("a worker that never execed", () => {

  const EXPECTED: CacheReceiptExpectation = {
    protocol: CACHE_PROCESS_PROTOCOL,
    draw_id: "draw-1",
    ticket_digest: "ticket-1",
    seq: 3,
    custodian: { pid: 100, ppid: 7, pgid: 100, sid: 100, start_ticks: "10" },
    worker: null,
    forked_pid: 200,
  };

  it("may PROVE that the domain ended, and is NEVER a success", () => {
    const accumulator = new CacheReceiptAccumulator();
    const wait = {
      t: "w",
      v: {
        pid: 200,
        status: { kind: "exited", code: 0 },
        order: 1,
        category: "worker",
        epoch: { pid: 200, ppid: 100, pgid: 200, sid: 200, start_ticks: "20" },
      },
    };
    expect(accumulator.take({
      index: 0, count: 1, items: [wait], items_digest: itemsDigest([wait]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    const receipt = {
      ...failedExecReceipt(),
      waits_digest: state.waits_digest,
      waits_count: state.waits,
      events_digest: state.events_digest,
      events_count: state.events,
      identities_digest: state.identities_digest,
      identities_count: state.identities,
      failed_terminal: {
        ...(failedExecReceipt().failed_terminal as Record<string, unknown>),
        lifetime: {
          ...((failedExecReceipt().failed_terminal as Record<string, unknown>).lifetime as Record<string, unknown>),
          events_digest: state.events_digest,
          events_count: state.events,
          waits_digest: state.waits_digest,
          waits_count: state.waits,
          identities_digest: state.identities_digest,
          identities_count: state.identities,
        },
      },
    };
    // The DOMAIN is really gone: the failed worker was really waited for.
    expect(validateCacheDomainReceipt(receipt, EXPECTED, state).ok).toBe(true);
    // And the draw is NEVER a success: the exec did not work.
    expect(validateCacheExecutionReceipt(receipt, EXPECTED, state).ok).toBe(false);
  });

  it("is NOT a proof when the wait of the failed worker is missing", () => {
    const accumulator = new CacheReceiptAccumulator();
    const other = {
      t: "w",
      v: {
        pid: 999,
        status: { kind: "exited", code: 0 },
        order: 1,
        category: "adopted",
        epoch: { pid: 999, ppid: 100, pgid: 999, sid: 999, start_ticks: "30" },
      },
    };
    expect(accumulator.take({
      index: 0, count: 1, items: [other], items_digest: itemsDigest([other]),
      protocol: CACHE_PROCESS_PROTOCOL, draw_id: "draw-1", ticket_digest: "ticket-1",
    })).toBeNull();
    const state = accumulator.state();
    // A count of waits is not a proof: the wait of ANOTHER process is not the
    // wait of the worker that failed.
    expect(validateCacheDomainReceipt(failedExecReceipt(), EXPECTED, state).ok).toBe(false);
  });
});

describe("the owned cancel of a draw", () => {
  it("refuses a handle of ANOTHER supervisor before any side effect", () => {
    const mine = supervisor();
    const other = supervisor();
    const handle = other.reserve({
      root: "/tmp", base: "http://127.0.0.1:1", rel: "film.html",
      ms: -1, width: 480, overrides: null,
    });
    expect(() => mine.requestCancel(handle, new Error("stop"))).toThrow(/not one this supervisor issued/iu);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("makes a draw that was never started end as a failure of a child that was never born", async () => {
    const instance = supervisor();
    const handle = instance.reserve({
      root: "/tmp", base: "http://127.0.0.1:1", rel: "film.html",
      ms: -1, width: 480, overrides: null,
    });
    instance.requestCancel(handle, new Error("the owner changed its mind"));
    const settlement = await instance.start(handle);
    // NOTHING was spawned: the start refused.
    expect(spawnMock).not.toHaveBeenCalled();
    expect(settlement.error).not.toBeNull();
    expect(settlement.picture).toBeNull();
    const inspection = instance.inspectCleanup(handle);
    expect(inspection.settled).toBe(true);
    expect(inspection.cleanup_required).toBe(false);
  });

  it("never replaces the FIRST error", () => {
    const instance = supervisor();
    const handle = instance.reserve({
      root: "/tmp", base: "http://127.0.0.1:1", rel: "film.html",
      ms: -1, width: 480, overrides: null,
    });
    instance.requestCancel(handle, new Error("the first failure"));
    instance.requestCancel(handle, new Error("a later failure"));
    const inspection = instance.inspectCleanup(handle);
    expect(inspection.latched_outcome.message).toContain("the first failure");
    expect(inspection.latched_outcome.message).not.toContain("a later failure");
  });
});

describe("the reconcile of a draw whose worker never stated its identity", () => {
  it("is refused for the DOMAIN, and not for a missing worker", async () => {
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "S", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, Number(CUSTODIAN_TICKS));
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = supervisor();
    const handle = instance.reserve({
      root: "/tmp", base: "http://127.0.0.1:1", rel: "film.html",
      ms: -1, width: 480, overrides: null,
    });
    setImmediate(() => {
      child.control.emit("data", frameOf({
        kind: "C_HELLO", protocol: CACHE_PROCESS_PROTOCOL, seq: 1,
        pid: CUSTODIAN_PID, ppid: process.pid, pgid: CUSTODIAN_PID, sid: CUSTODIAN_PID,
        start_ticks: Number(CUSTODIAN_TICKS), subreaper: true,
      }));
      child.control.emit("data", frameOf({
        kind: "FORKED", protocol: CACHE_PROCESS_PROTOCOL, seq: 2,
        pid: 4343, exec: { ok: false, errno: 13 },
      }));
      child.emit("exit", 0, null);
      child.emit("close", 0, null);
    });
    try {
      // The draw is HELD: the epoch of the custodian is still there.
      const startPromise = instance.start(handle);
      startPromise.catch(() => { /* the draw stays pending: it is held */ });
      for (let round = 0; round < 200; round += 1) {
        if (instance.inspectCleanup(handle).cleanup_required) break;
        await new Promise((resolveTick) => { setTimeout(resolveTick, 10); });
      }
      const inspection = instance.inspectCleanup(handle);
      expect(inspection.cleanup_required).toBe(true);
      expect(inspection.settled).toBe(false);
      // The reconcile is refused for the DOMAIN - and NOT with "the draw has
      // no worker to reconcile": the fork really happened.
      await expect(instance.reconcileCleanup(handle)).rejects.toThrow(/still there|domain/iu);
    } finally {
      procOverride.path = null;
      procOverride.text = "";
    }
  });
});

/**
 * A supervisor with the SHORT action deadlines of the cases.
 *
 * The deadlines are ACTION deadlines: they never mean "the resources are
 * gone", and they are shortened here only so that a case does not wait for
 * the real ones.
 */
function quickSupervisor(): CacheProcessSupervisor {
  return new CacheProcessSupervisor({
    vendorRoot: "/nonexistent/vendor",
    producerFile: "packages/openfilm/studio/server/pageframes.mjs",
    producerSha256: "0".repeat(64),
    workerPath: "/nonexistent/worker.mjs",
    custodianPath: "/nonexistent/custodian.py",
    pythonExecutable: "/usr/bin/python3.12",
    limits: { readyMs: 60, killConfirmMs: 60, termGraceMs: 20, outerMs: 200, finalizeMs: 100 },
  });
}

/** The request of the cases of the startup. */
const STARTUP_REQUEST: CacheDrawRequest = {
  root: "/tmp", base: "http://127.0.0.1:1", rel: "film.html", ms: -1, width: 480, overrides: null,
};

/** Wait until the draw of a case is really HELD. */
async function waitUntilHeld(instance: CacheProcessSupervisor, handle: unknown): Promise<void> {
  for (let round = 0; round < 300; round += 1) {
    if (instance.inspectCleanup(handle).cleanup_required) return;
    await new Promise((resolveTick) => { setTimeout(resolveTick, 10); });
  }
  throw new Error("the draw was never held: the case cannot prove anything");
}

describe("a startup that ends LATE", () => {
  it("reconciles a draw that was NEVER BORN when its close arrives late", async () => {
    // The child failed to start: the error is real, and the CLOSE arrives
    // after the budget of the cleanup.
    const child = new FakeChild(undefined);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    setImmediate(() => {
      child.emit("error", Object.assign(new Error("spawn EAGAIN"), { code: "EAGAIN" }));
    });
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    expect(instance.inspectCleanup(handle).settled).toBe(false);
    // The close really arrives LATE.
    child.emit("close", -2, null);
    const reconciled = await instance.reconcileCleanup(handle);
    expect(reconciled.settled).toBe(true);
    // The draw ends with its ORIGINAL failure: it is not a picture, and it is
    // not a success.
    const settlement = await startPromise;
    expect(settlement.error).not.toBeNull();
    expect((settlement.error as { code?: string }).code).toBe("CUSTODIAN_NOT_BORN");
    expect(settlement.picture).toBeNull();
  });

  it("reconciles a draw whose custodian was NEVER ALLOWED to fork", async () => {
    // The custodian was born, it never stated its identity, and it closed
    // after the budget of the cleanup.
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "S", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, Number(CUSTODIAN_TICKS));
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    // The custodian really closed, and its ORIGINAL epoch is really gone.
    procOverride.code = "ENOENT";
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    const reconciled = await instance.reconcileCleanup(handle);
    expect(reconciled.settled).toBe(true);
    const settlement = await startPromise;
    expect(settlement.error).not.toBeNull();
    expect((settlement.error as { code?: string }).code).toBe("CUSTODIAN_NOT_READY");
    expect(settlement.picture).toBeNull();
  });

  it("keeps a draw HELD when the fresh epoch of the custodian is UNKNOWN", async () => {
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "S", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, Number(CUSTODIAN_TICKS));
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    // The custodian closed, but its epoch could not be READ: an unknown
    // observation is never a proof that the custodian is gone.
    procOverride.code = "EIO";
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    await expect(instance.reconcileCleanup(handle)).rejects.toThrow(/still there/iu);
    expect(instance.inspectCleanup(handle).cleanup_required).toBe(true);
    expect(instance.inspectCleanup(handle).settled).toBe(false);
  });

  it("keeps a draw HELD when it was ALLOWED to fork and no worker was proved", async () => {
    // The custodian of this draw is NOT closed, so the production asks the
    // kernel to stop it. That request goes through the SCRIPT of this case:
    // the number is synthetic and it never reaches a real process.
    const killCalls = scriptRawKill();
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "S", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, Number(CUSTODIAN_TICKS));
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    setImmediate(() => {
      child.control.emit("data", frameOf({
        kind: "C_HELLO", protocol: CACHE_PROCESS_PROTOCOL, seq: 1,
        pid: CUSTODIAN_PID, ppid: process.pid, pgid: CUSTODIAN_PID, sid: CUSTODIAN_PID,
        start_ticks: Number(CUSTODIAN_TICKS), subreaper: true,
      }));
    });
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    // The draw was ALLOWED to fork and no worker of it was ever proved: it
    // stays UNKNOWN, and it is never proved gone.
    procOverride.code = "ENOENT";
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    await expect(instance.reconcileCleanup(handle)).rejects.toThrow(/allowed to fork/iu);
    expect(instance.inspectCleanup(handle).cleanup_required).toBe(true);
    // The cleanup of the custodian was asked for, and it went through the
    // SCRIPT of this case: the synthetic number and the signal it carried.
    expect(killCalls.length).toBeGreaterThan(0);
    expect(killCalls[0]?.pid).toBe(CUSTODIAN_PID);
    expect(killCalls[0]?.signal).toBe("SIGTERM");
  });
});

describe("the cancel of the owner of a draw", () => {
  it("keeps the ORIGINAL error object of the owner", async () => {
    const instance = supervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const deliberate = Object.assign(new Error("the deliberate failure"), { code: "EXPECTED_ASSERTION_FAILURE" });
    instance.requestCancel(handle, deliberate);
    // The draw ends with THAT object: it is not replaced by a new error.
    const settlement = await instance.start(handle);
    expect(settlement.error).toBe(deliberate);
    expect(settlement.picture).toBeNull();
    // The diagnostics say that the cancel of the owner became the PRIMARY
    // outcome of the draw.
    const snapshot = instance.diagnosticSnapshot(handle);
    expect(snapshot.latched_outcome.code).toBe("DRAW_CANCELLED");
    expect(snapshot.cancel_provenance?.accepted_as_primary).toBe(true);
    expect(snapshot.cancel_provenance?.error_code).toBe("EXPECTED_ASSERTION_FAILURE");
    expect(snapshot.cancel_provenance?.superseded_by_earlier_failure).toBe(false);
  });

  it("exposes FROZEN summaries that do not change when the snapshot is read again", () => {
    // The snapshot is a READ-ONLY copy of facts: two reads of it are the
    // same facts, and it exposes no MUTABLE internal object.
    const instance = supervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const first = instance.diagnosticSnapshot(handle);
    const second = instance.diagnosticSnapshot(handle);
    expect(second.receipt_summary).toEqual(first.receipt_summary);
    expect(second.accumulator_summary).toEqual(first.accumulator_summary);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.accumulator_summary)).toBe(true);
    if (first.receipt_summary !== null) {
      expect(Object.isFrozen(first.receipt_summary)).toBe(true);
    }
    // And the digests of the accumulator are the ones it REALLY computed:
    // the digest of nothing for the empty classes, and a complete digest.
    expect(first.accumulator_summary.events_digest)
      .toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(first.accumulator_summary.waits_digest)
      .toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(first.accumulator_summary.identities_digest)
      .toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("does NOT replace an EARLIER failure with the cancel of the owner", async () => {
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    setImmediate(() => {
      child.emit("error", Object.assign(new Error("the pipe broke"), { code: "EPIPE" }));
    });
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    for (let round = 0; round < 300; round += 1) {
      if (instance.diagnosticSnapshot(handle).latched_outcome.kind === "failure") break;
      await new Promise((resolveTick) => { setTimeout(resolveTick, 10); });
    }
    const before = instance.diagnosticSnapshot(handle);
    expect(before.latched_outcome.kind).toBe("failure");
    expect(before.latched_outcome.code).not.toBe("DRAW_CANCELLED");
    // The cancel of the owner arrives LATER: it does not replace the failure
    // that was already latched, and it says so.
    instance.requestCancel(handle, new Error("the deliberate failure"));
    const after = instance.diagnosticSnapshot(handle);
    expect(after.latched_outcome.code).toBe(before.latched_outcome.code);
    expect(after.cancel_provenance?.accepted_as_primary).toBe(false);
    expect(after.cancel_provenance?.superseded_by_earlier_failure).toBe(true);
  });

  it("refuses a handle of ANOTHER supervisor", () => {
    const mine = supervisor();
    const theirs = supervisor();
    const handle = theirs.reserve(STARTUP_REQUEST);
    expect(() => mine.requestCancel(handle, new Error("the deliberate failure")))
      .toThrow(/not one this supervisor/iu);
  });
});

describe("the idempotence of the cancel of the owner", () => {
  /** The frames that were really written on a private channel. */
  function framesOf(channel: FakeChannel): Record<string, unknown>[] {
    const frames: Record<string, unknown>[] = [];
    for (const written of channel.written) {
      const payload = written.subarray(4).toString("utf8");
      try {
        frames.push(JSON.parse(payload) as Record<string, unknown>);
      } catch {
        frames.push({ kind: "unparsable" });
      }
    }
    return frames;
  }

  it("keeps the FIRST accepted cancel when the SAME error is presented again", async () => {
    const instance = supervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const deliberate = Object.assign(new Error("the deliberate failure"), { code: "EXPECTED_ASSERTION_FAILURE" });
    instance.requestCancel(handle, deliberate);
    const first = instance.diagnosticSnapshot(handle);
    expect(first.cancel_provenance?.accepted_as_primary).toBe(true);
    expect(first.cancel_provenance?.superseded_by_earlier_failure).toBe(false);
    // The SAME error again: the primary history is IMMUTABLE.
    instance.requestCancel(handle, deliberate);
    const second = instance.diagnosticSnapshot(handle);
    expect(second.cancel_provenance?.accepted_as_primary).toBe(true);
    expect(second.cancel_provenance?.superseded_by_earlier_failure).toBe(false);
    expect(second.latched_outcome.code).toBe("DRAW_CANCELLED");
    // And the draw still ends with THAT object, exactly once.
    const settlement = await instance.start(handle);
    expect(settlement.error).toBe(deliberate);
  });

  it("keeps the FIRST accepted cancel when a DIFFERENT error is presented later", async () => {
    const instance = supervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const deliberate = Object.assign(new Error("the deliberate failure"), { code: "EXPECTED_ASSERTION_FAILURE" });
    instance.requestCancel(handle, deliberate);
    // A LATER, different error does not become the primary cause.
    instance.requestCancel(handle, new Error("a later and different failure"));
    const snapshot = instance.diagnosticSnapshot(handle);
    expect(snapshot.cancel_provenance?.accepted_as_primary).toBe(true);
    expect(snapshot.cancel_provenance?.superseded_by_earlier_failure).toBe(false);
    const settlement = await instance.start(handle);
    expect(settlement.error).toBe(deliberate);
  });

  it("does NOT write the CANCEL of the custodian twice", async () => {
    // The custodian of this draw never closes either: its cleanup is asked
    // for, and it goes through the SCRIPT of this case.
    const killCalls = scriptRawKill();
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    const deliberate = new Error("the deliberate failure");
    instance.requestCancel(handle, deliberate);
    const first = instance.diagnosticSnapshot(handle).cancel_provenance;
    // The draw really failed BEFORE the cancel - the custodian never said its
    // identity - so the cancel is NOT the primary outcome.
    expect(first?.accepted_as_primary).toBe(false);
    expect(first?.superseded_by_earlier_failure).toBe(true);
    instance.requestCancel(handle, deliberate);
    instance.requestCancel(handle, new Error("a later failure"));
    // The custodian was asked to stop ONCE: the repeat is an observation, not
    // a second message.
    const cancels = framesOf(child.control).filter(frame => frame.kind === "CANCEL");
    expect(cancels.length).toBe(1);
    // And the provenance of the FIRST cancel is UNCHANGED by the later ones.
    const snapshot = instance.diagnosticSnapshot(handle);
    expect(snapshot.cancel_provenance).toEqual(first);
    // The later requests are a BOUNDED fact: a count and the last one.
    expect(snapshot.cancel_secondary?.count).toBe(2);
    // And the cleanup of the custodian went through the CONTROL CHANNEL, and
    // through NO raw signal at all: the custodian of this draw never stated
    // its identity, and the production never signals a process that it cannot
    // prove. The SCRIPT of this case saw nothing but the group probes.
    expect(killCalls.length).toBe(0);
    expect(rawEdges.scriptedCalls.filter(call => !call.detail.endsWith("/0"))).toEqual([]);
  });
});

describe("the guard of the raw edges", () => {
  it("records the refusal of the raw signal, and it is never a delivery", async () => {
    // The custodian of this draw never closes, so the production asks the
    // kernel to stop it. This case does NOT script that edge: the guard
    // refuses it, the refusal is a FACT, and the production swallows it -
    // which is exactly why the ledger exists.
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "S", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, Number(CUSTODIAN_TICKS));
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    setImmediate(() => {
      child.control.emit("data", frameOf({
        kind: "C_HELLO", protocol: CACHE_PROCESS_PROTOCOL, seq: 1,
        pid: CUSTODIAN_PID, ppid: process.pid, pgid: CUSTODIAN_PID, sid: CUSTODIAN_PID,
        start_ticks: Number(CUSTODIAN_TICKS), subreaper: true,
      }));
    });
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    // The refusal is in the ledger, and the ONLY scripted calls were the group
    // probes: no signal of this case ever left the guarded world.
    expect(rawEdges.denials.length).toBeGreaterThan(0);
    expect(rawEdges.denials[0]).toContain("process.kill(");
    expect(rawEdges.scriptedCalls.every(call => call.detail.endsWith("/0"))).toBe(true);
    // And the production swallowed the refusal into its own cleanup: the case
    // sees it only because the ledger is separate from the production.
    expect(instance.inspectCleanup(handle).cleanup_failures).toBeGreaterThan(0);
    // The case declares the refusal it expects, so the ledger of the NEXT
    // case starts empty and the NEXT case may not hide one.
    rawEdges.expectedDenials = [...rawEdges.denials];
  });

  it("refuses every other edge of child_process", async () => {
    const childProcess = await import("node:child_process") as unknown as {
      fork: (...args: unknown[]) => unknown;
      exec: (...args: unknown[]) => unknown;
    };
    expect(() => childProcess.fork("x")).toThrow(/denied/iu);
    expect(() => childProcess.exec("x")).toThrow(/denied/iu);
    expect(rawEdges.denials).toContain("child_process.fork");
    expect(rawEdges.denials).toContain("child_process.exec");
    rawEdges.expectedDenials = [...rawEdges.denials];
  });
});

describe("a startup whose original epoch was NEVER bound", () => {
  it("settles the original failure when the issued PID is really gone", async () => {
    // The identity of the custodian could not be read AT THE START, and it
    // never said its identity: no epoch was ever bound.
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.code = "EIO";
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    // The custodian really exited and closed, and the PID that the Host was
    // ISSUED is really gone: the original child ended.
    procOverride.code = "ENOENT";
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    const reconciled = await instance.reconcileCleanup(handle);
    expect(reconciled.settled).toBe(true);
    const settlement = await startPromise;
    expect(settlement.error).not.toBeNull();
    expect(settlement.picture).toBeNull();
  });

  it("stays HELD when the issued PID is still there and no epoch was bound", async () => {
    // A KNOWN observation of an UNBOUND number is another process now: it may
    // not be used as the original, and it may not be guessed.
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.code = "EIO";
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    // The number is read now, and it is ANOTHER process: the original child
    // cannot be proven, and the draw stays held.
    procOverride.code = null;
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "S", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, 999);
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    await expect(instance.reconcileCleanup(handle)).rejects.toThrow(/still there/iu);
    expect(instance.inspectCleanup(handle).cleanup_required).toBe(true);
  });

  it("keeps a failure of the removal of the private run directory", async () => {
    // The domain of the draw really ended, and the removal of the private
    // directory did NOT: the cleanup failure is a fact of the draw, and it is
    // not hidden behind the fact that the resources are gone.
    rmOverride.code = "EIO";
    const child = new FakeChild(undefined);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    setImmediate(() => {
      child.emit("error", Object.assign(new Error("spawn EAGAIN"), { code: "EAGAIN" }));
      child.emit("close", -2, null);
    });
    try {
      const settlement = await instance.start(handle);
      expect(settlement.error).not.toBeNull();
      const inspection = instance.inspectCleanup(handle);
      expect(inspection.cleanup_failures).toBeGreaterThan(0);
    } finally {
      rmOverride.code = null;
      const directory = instance.inspectCleanup(handle).run_directory;
      if (directory !== null) rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stays HELD when the issued PID cannot be read and no epoch was bound", async () => {
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.code = "EIO";
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    // The PID could not be read: UNKNOWN is never a proof that it is gone.
    await expect(instance.reconcileCleanup(handle)).rejects.toThrow(/still there/iu);
    expect(instance.inspectCleanup(handle).cleanup_required).toBe(true);
  });

  it("does NOT accept a known SAME epoch in Z as the end of the custodian", async () => {
    // The epoch IS bound, and the fresh observation is the very same process:
    // a zombie is NOT gone, and it is not the end of the custodian.
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "S", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, Number(CUSTODIAN_TICKS));
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "Z", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, Number(CUSTODIAN_TICKS));
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    await expect(instance.reconcileCleanup(handle)).rejects.toThrow(/still there/iu);
    expect(instance.inspectCleanup(handle).cleanup_required).toBe(true);
  });

  it("exposes the ACTUAL terminal proof observations of the custodian", async () => {
    procOverride.path = `/proc/${CUSTODIAN_PID}/stat`;
    procOverride.text = statText(
      CUSTODIAN_PID, "custodian", "S", process.pid, CUSTODIAN_PID, CUSTODIAN_PID, Number(CUSTODIAN_TICKS));
    const child = new FakeChild(CUSTODIAN_PID);
    spawnMock.mockImplementation(() => child);
    const instance = quickSupervisor();
    const handle = instance.reserve(STARTUP_REQUEST);
    const startPromise = instance.start(handle);
    startPromise.catch(() => { /* the draw stays pending: it is held */ });
    await waitUntilHeld(instance, handle);
    procOverride.code = "ENOENT";
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    await instance.reconcileCleanup(handle);
    const snapshot = instance.diagnosticSnapshot(handle) as unknown as {
      terminal_proof?: {
        readonly observations: readonly {
          readonly kind: string;
          readonly presence: string;
          readonly at: number;
          readonly start_ticks: string | null;
        }[];
      } | null;
    };
    // The observations are the ACTUAL ones of the proof path: they are not
    // hardcoded in the tool and they are not a boolean.
    expect(snapshot.terminal_proof).not.toBeNull();
    const observations = snapshot.terminal_proof?.observations ?? [];
    const custodian = observations.find(entry => entry.kind === "custodian-epoch");
    expect(custodian).toBeDefined();
    expect(custodian?.presence).toBe("gone");
    expect(typeof custodian?.at).toBe("number");
    expect(custodian?.start_ticks).toBe(String(CUSTODIAN_TICKS));
  });
});
