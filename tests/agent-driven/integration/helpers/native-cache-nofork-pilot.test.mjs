import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  CONTROL_PROTOCOL,
  EXPECTED_ASSERTION_FAILURE,
  PILOT_LIMITS,
  PYTHON_PATH,
  PYTHON_SHA256,
  REPOSITORY_ROOT,
  REAL_DEPENDENCIES,
  checkTerminalProof,
  createChildLedger,
  createControlDecoder,
  cleanupChild,
  isEntryPoint,
  main,
  originalEpochIsGone,
  parseCustodianHello,
  parsePilotArguments,
  parseProcStat,
  privateEnvironment,
  readProcIdentity,
  runPilot,
  takeControlFrame,
  verifyCustodianIdentity,
  verifyOwnedLiveChild,
} from "../../../../tools/native-cache-nofork-pilot.mjs";

/**
 * The pure tests of the nofork pilot.
 *
 * There is NO real spawn, NO real signal, NO real fork, NO prctl and NO Host in
 * this file: the child, the streams, the /proc reads and the clock are all
 * INJECTED, and the REAL ledger, the REAL cleanup and the REAL orchestration
 * are the ones under test.
 *
 * The last case of this file asserts that the REAL spawn was called ZERO
 * times: the guard is installed before anything else runs, and it makes a real
 * spawn a hard failure rather than a silent one.
 */

/** The number of the custodian of the cases: the one of the fake child. */
const CUSTODIAN_PID = 4242;
/** The number of the pilot itself. */
const TOOL_PID = 999;
/** The digest of the reviewed custodian, as the cases pretend it is. */
const CUSTODIAN_SHA = "a".repeat(64);

/** A stream that a test can push into. */
class FakeStream extends EventEmitter {
  pushData(chunk) {
    this.emit("data", Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  pushEnd() {
    this.emit("end");
  }

  pushClose() {
    this.emit("close");
  }

  pushError(error) {
    this.emit("error", error);
  }
}

/** A child that a test can drive. */
class FakeChild extends EventEmitter {
  constructor({ pid = CUSTODIAN_PID } = {}) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.control = new FakeStream();
    this.stdio = [null, this.stdout, this.stderr, new FakeStream(), this.control];
    this.killed = [];
    this.killBehaviour = "deliver";
    this.onKill = null;
  }

  kill(signal) {
    this.killed.push(signal);
    if (this.killBehaviour === "throw") throw new Error("the signal could not be delivered");
    if (this.killBehaviour === "refuse") return false;
    if (this.onKill !== null) this.onKill(signal);
    return true;
  }

  pushError(error) {
    this.emit("error", error);
  }

  pushExit(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  pushClose(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }
}

/** The /proc of the cases. */
class FakeProc {
  constructor(identity = null, sequence = null) {
    this.identity = identity;
    this.gone = false;
    this.reads = 0;
    /** A SCRIPT of the answers: "known", "unknown" or "gone", one per read. */
    this.sequence = sequence;
    this.sequenceIndex = 0;
    /** The answer of the LAST read. */
    this.lastStep = null;
  }

  read(pid) {
    this.reads += 1;
    if (this.sequence !== null) {
      const index = Math.min(this.sequenceIndex, this.sequence.length - 1);
      this.sequenceIndex += 1;
      const step = this.sequence[index];
      this.lastStep = step;
      if (step === "gone") return { presence: "gone", identity: null, reason: null };
      if (step === "unknown") return { presence: "unknown", identity: null, reason: "EIO" };
      return { presence: "known", identity: this.identity, reason: null };
    }
    if (this.gone) {
      this.lastStep = "gone";
      return { presence: "gone", identity: null, reason: null };
    }
    if (this.identity === null) {
      this.lastStep = "unknown";
      return { presence: "unknown", identity: null, reason: "EIO" };
    }
    this.lastStep = "known";
    return { presence: "known", identity: this.identity, reason: null };
  }
}

/** The epoch of the custodian of the cases. */
const EPOCH = Object.freeze({
  pid: CUSTODIAN_PID,
  state: "S",
  ppid: TOOL_PID,
  pgid: CUSTODIAN_PID,
  sid: CUSTODIAN_PID,
  start_ticks: "12345",
});

/** The PAYLOAD of a hello, without the length that frames it. */
function helloPayload(overrides = {}) {
  return Buffer.from(JSON.stringify({
    kind: "C_HELLO",
    protocol: CONTROL_PROTOCOL,
    seq: 1,
    pid: CUSTODIAN_PID,
    ppid: TOOL_PID,
    pgid: CUSTODIAN_PID,
    sid: CUSTODIAN_PID,
    start_ticks: "12345",
    state: "S",
    subreaper: true,
    ...overrides,
  }), "utf8");
}

/** One frame of the control channel, as the custodian writes it. */
function helloFrame(overrides = {}) {
  const message = {
    kind: "C_HELLO",
    protocol: CONTROL_PROTOCOL,
    seq: 1,
    pid: CUSTODIAN_PID,
    ppid: TOOL_PID,
    pgid: CUSTODIAN_PID,
    sid: CUSTODIAN_PID,
    start_ticks: "12345",
    state: "S",
    subreaper: true,
    ...overrides,
  };
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * A destination of reports that has the SHAPE of a Writable.
 *
 * It can emit an error, and the error arrives ASYNCHRONOUSLY - by the
 * completion of the write AND by the error event, which is what a broken pipe
 * really does. A destination that only collects strings can never show that
 * path.
 */
class FakeWritable extends EventEmitter {
  constructor() {
    super();
    this.written = [];
    /** The error that the NEXT write fails with, asynchronously. */
    this.nextError = null;
    /** How many error events this destination really emitted. */
    this.emitted = 0;
  }

  write(text, callback) {
    this.written.push(text);
    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      // The write returns normally; the failure comes on a later turn.
      setImmediate(() => {
        if (typeof callback === "function") callback(error);
        this.emitted += 1;
        this.emit("error", error);
      });
      return true;
    }
    if (typeof callback === "function") callback(null);
    return true;
  }
}

/** The boundaries of the cases: a clock that only moves when the case sleeps. */
function fakeDeps({ child, proc, overrides = {}, evidenceFailures = null } = {}) {
  const state = { clock: 0, spawned: [], roots: [], evidence: [], evidenceFailures: [], stderr: [] };
  const deps = {
    cwd: () => REPOSITORY_ROOT,
    pid: () => TOOL_PID,
    now: () => state.clock,
    sleep: async (milliseconds) => {
      state.clock += milliseconds;
      // The wait yields to the QUEUE of the run: a case that waits for an event
      // must not starve it.
      await new Promise((resolveTick) => { setImmediate(resolveTick); });
    },
    spawnChild: (argv, options) => {
      state.spawned.push({ argv, options });
      return child;
    },
    readProcIdentity: (pid) => proc.read(pid),
    sha256OfFile: (path) => (path === PYTHON_PATH ? PYTHON_SHA256 : CUSTODIAN_SHA),
    createRoot: () => {
      state.roots.push("root");
      return "/tmp/nofork-root";
    },
    writeEvidence: (root, name, data) => {
      state.evidence.push({ root, name, data });
      if (evidenceFailures !== null && evidenceFailures.has(name)) {
        // The FILESYSTEM fails: the write throws, exactly as ENOSPC or EIO
        // would.
        const code = name === "outcome.json" ? "ENOSPC" : "EIO";
        state.evidenceFailures.push({ name, code });
        throw Object.assign(new Error(`the evidence ${name} could not be written`), { code });
      }
    },
    /** The destination of the reports: there is none unless a case says so. */
    reportStream: null,
    /** The write route of the reporting boundary. */
    writeStderr: (text, callback) => {
      state.stderr.push(text);
      if (typeof callback === "function") callback(null);
    },
    ...overrides,
  };
  return { deps, state };
}

/** Let the QUEUE of the run move on: one turn of the event loop. */
async function turns(count) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolveTick) => { setImmediate(resolveTick); });
  }
}

/** Wait until a fact of the run is true, and say whether it became true. */
async function waitUntil(predicate, limit = 20000) {
  for (let index = 0; index < limit; index += 1) {
    if (predicate()) return true;
    await turns(1);
  }
  return predicate();
}

/**
 * The guard of the REAL spawn and of the REAL root.
 *
 * It is a FENCE and not a counter: it throws BEFORE anything real happens, so
 * a real spawn in a pure test is a hard failure with NO side effect at all. It
 * never forwards to the real spawn, and it never counts afterwards.
 */
let realSpawnCalls = 0;
let realRootCalls = 0;
const REAL_SPAWN = REAL_DEPENDENCIES.spawnChild;
const REAL_ROOT = REAL_DEPENDENCIES.createRoot;
REAL_DEPENDENCIES.spawnChild = () => {
  realSpawnCalls += 1;
  throw new Error("the pure tests must never spawn a real process");
};
REAL_DEPENDENCIES.createRoot = () => {
  realRootCalls += 1;
  throw new Error("the pure tests must never create a real root");
};

after(() => {
  REAL_DEPENDENCIES.spawnChild = REAL_SPAWN;
  REAL_DEPENDENCIES.createRoot = REAL_ROOT;
  // The REAL spawn and the REAL root were never reached.
  assert.equal(realSpawnCalls, 0, "the pure tests must never spawn a real process");
  assert.equal(realRootCalls, 0, "the pure tests must never create a real root");
});

describe("the arguments of the nofork pilot", () => {
  it("takes exactly two modes and one digest", () => {
    const options = parsePilotArguments(["--mode", "identity", "--expected-custodian-sha256", CUSTODIAN_SHA]);
    assert.equal(options.mode, "identity");
    assert.equal(options.expectedCustodianSha256, CUSTODIAN_SHA);
    assert.equal(parsePilotArguments(["--mode", "assertion-failure", "--expected-custodian-sha256", CUSTODIAN_SHA]).mode,
      "assertion-failure");
  });

  it("refuses anything that could name an executable, a script, a signal or a number", () => {
    for (const argv of [
      ["--mode", "identity", "--expected-custodian-sha256", CUSTODIAN_SHA, "--python", "/bin/sh"],
      ["--mode", "identity", "--expected-custodian-sha256", CUSTODIAN_SHA, "--pid", "1"],
      ["--mode", "identity", "--expected-custodian-sha256", CUSTODIAN_SHA, "--signal", "SIGKILL"],
      ["--mode", "identity", "--expected-custodian-sha256", CUSTODIAN_SHA, "--exec", "/bin/true"],
      ["--mode", "production", "--expected-custodian-sha256", CUSTODIAN_SHA],
      ["--mode", "identity"],
      ["--expected-custodian-sha256", CUSTODIAN_SHA],
      ["--expected-custodian-sha256", "not-a-digest"],
    ]) {
      assert.throws(() => parsePilotArguments(argv), /PilotFailure|code/iu);
    }
  });
});

describe("the reading of the epoch of a process", () => {
  it("reads the fields after the last closing parenthesis", () => {
    // The Linux layout: the state, the parent, the group, the session, then
    // fifteen more fields, and the start time as the twentieth of them.
    const fields = [
      "S", "999", "4242", "4242",
      ...Array.from({ length: 15 }, () => "0"),
      "12345", "0",
    ];
    const text = `4242 (chrome worker) ${fields.join(" ")}`;
    const identity = parseProcStat(text);
    assert.equal(identity.pid, 4242);
    assert.equal(identity.state, "S");
    assert.equal(identity.ppid, 999);
    assert.equal(identity.pgid, 4242);
    assert.equal(identity.sid, 4242);
    assert.equal(identity.start_ticks, "12345");
  });

  it("refuses a text it cannot read", () => {
    assert.equal(parseProcStat(""), null);
    assert.equal(parseProcStat("4242 S 1 2 3"), null);
    assert.equal(parseProcStat("x (chrome) S 1 2 3"), null);
  });

  it("says gone ONLY for ENOENT and ESRCH", () => {
    const gone = (code) => () => { throw Object.assign(new Error("no"), { code }); };
    assert.equal(readProcIdentity(4242, gone("ENOENT")).presence, "gone");
    assert.equal(readProcIdentity(4242, gone("ESRCH")).presence, "gone");
    assert.equal(readProcIdentity(4242, gone("EIO")).presence, "unknown");
    assert.equal(readProcIdentity(4242, gone("EACCES")).presence, "unknown");
  });

  it("does not call a number that was reused a gone original, and an unknown a proof", () => {
    assert.equal(originalEpochIsGone(EPOCH, { presence: "gone", identity: null }), true);
    assert.equal(originalEpochIsGone(EPOCH, { presence: "unknown", identity: null }), false);
    assert.equal(originalEpochIsGone(EPOCH, { presence: "known", identity: { ...EPOCH, start_ticks: "999" } }), true);
    assert.equal(originalEpochIsGone(EPOCH, { presence: "known", identity: EPOCH }), false);
  });
});

describe("the decoder of the control channel", () => {
  it("takes a frame that arrives in two pieces", () => {
    const decoder = createControlDecoder();
    const frame = helloFrame();
    assert.deepEqual(decoder.feed(frame.subarray(0, 10)), []);
    assert.equal(decoder.feed(frame.subarray(10)).length, 1);
  });

  it("takes two frames that arrive together", () => {
    const decoder = createControlDecoder();
    const frames = decoder.feed(Buffer.concat([helloFrame(), helloFrame({ seq: 2 })]));
    assert.equal(frames.length, 2);
  });

  it("refuses a frame that claims more than the limit", () => {
    const decoder = createControlDecoder();
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(PILOT_LIMITS.controlBufferBytes + 1, 0);
    assert.throws(() => decoder.feed(header), (error) => error.code === "CONTROL_FRAME_TOO_LARGE");
  });

  it("refuses a channel whose unconsumed bytes grow past the limit", () => {
    const decoder = createControlDecoder();
    assert.throws(
      () => decoder.feed(Buffer.alloc(PILOT_LIMITS.controlBufferBytes + 1)),
      (error) => error.code === "CONTROL_OVERSIZE",
    );
  });

  it("reads a hello strictly", () => {
    assert.equal(parseCustodianHello(helloPayload()).kind, "C_HELLO");
    assert.throws(
      () => parseCustodianHello(helloPayload({ protocol: "other@1" })),
      (error) => error.code === "CONTROL_OTHER_PROTOCOL",
    );
    assert.throws(
      () => parseCustodianHello(helloPayload({ seq: 2 })),
      (error) => error.code === "CONTROL_WRONG_SEQUENCE",
    );
    assert.throws(
      () => parseCustodianHello(helloPayload({ subreaper: false })),
      (error) => error.code === "CONTROL_NO_SUBREAPER",
    );
    assert.throws(
      () => parseCustodianHello(helloPayload({ kind: "FORKED" })),
      (error) => error.code === "CONTROL_NOT_HELLO",
    );
    assert.throws(
      () => parseCustodianHello(Buffer.from([0xff, 0xfe, 0xfd])),
      (error) => error.code === "CONTROL_NOT_UTF8",
    );
    assert.throws(
      () => parseCustodianHello(Buffer.from("not json")),
      (error) => error.code === "CONTROL_NOT_JSON",
    );
  });
});

describe("the identity of the custodian", () => {
  it("checks every field against the kernel", () => {
    const hello = parseCustodianHello(helloPayload());
    const good = verifyCustodianIdentity(hello, {
      spawnedPid: CUSTODIAN_PID,
      toolPid: TOOL_PID,
      fresh: { presence: "known", identity: EPOCH, reason: null },
    });
    assert.equal(good.ok, true);
    for (const broken of [
      { spawnedPid: 1 },
      { toolPid: 1 },
    ]) {
      const verdict = verifyCustodianIdentity(hello, {
        spawnedPid: CUSTODIAN_PID,
        toolPid: TOOL_PID,
        fresh: { presence: "known", identity: EPOCH, reason: null },
        ...broken,
      });
      assert.equal(verdict.ok, false);
    }
    const otherGroup = verifyCustodianIdentity(hello, {
      spawnedPid: CUSTODIAN_PID,
      toolPid: TOOL_PID,
      fresh: { presence: "known", identity: { ...EPOCH, pgid: 7 }, reason: null },
    });
    assert.equal(otherGroup.ok, false);
    const otherMoment = verifyCustodianIdentity(hello, {
      spawnedPid: CUSTODIAN_PID,
      toolPid: TOOL_PID,
      fresh: { presence: "known", identity: { ...EPOCH, start_ticks: "999" }, reason: null },
    });
    assert.equal(otherMoment.ok, false);
  });
});

describe("the ledger of a child", () => {
  it("registers the events before anything waits", () => {
    const child = new FakeChild();
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    child.pushExit(0, null);
    child.pushClose(0, null);
    assert.equal(ledger.exitSeen, true);
    assert.equal(ledger.closeSeen, true);
  });

  it("keeps an error apart from an exit and from a close", () => {
    const child = new FakeChild();
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    child.pushError(Object.assign(new Error("spawn EAGAIN"), { code: "EAGAIN" }));
    assert.equal(ledger.errorSeen, true);
    assert.equal(ledger.exitSeen, false);
    assert.equal(ledger.closeSeen, false);
    assert.equal(ledger.error.code, "EAGAIN");
  });

  it("keeps the end of the control channel apart from the end of the process", () => {
    const child = new FakeChild();
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    child.control.pushEnd();
    assert.equal(ledger.controlEnded, true);
    assert.equal(ledger.closeSeen, false);
  });

  it("records the streams apart from each other", () => {
    const child = new FakeChild();
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    child.stderr.pushError(new Error("the stderr broke"));
    assert.notEqual(ledger.stderrError, null);
    assert.equal(ledger.stdoutError, null);
    assert.equal(ledger.closeSeen, false);
  });

  it("keeps the diagnostics bounded", () => {
    const child = new FakeChild();
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    child.stdout.pushData(Buffer.alloc(PILOT_LIMITS.streamBytes + 1, 0x61));
    assert.equal(ledger.stdoutBytes, PILOT_LIMITS.streamBytes + 1);
    assert.equal(ledger.stdoutTail.length, PILOT_LIMITS.streamTailBytes);
    assert.equal(ledger.diagnosticsLost, true);
  });

  it("never drops a frame that arrived while nobody was waiting", () => {
    const child = new FakeChild();
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    child.control.pushData(helloFrame());
    child.control.pushData(helloFrame({ seq: 2 }));
    const first = takeControlFrame(ledger);
    assert.notEqual(first, undefined);
    assert.equal(parseCustodianHello(first).kind, "C_HELLO");
    assert.notEqual(takeControlFrame(ledger), undefined);
    assert.equal(takeControlFrame(ledger), undefined);
  });
});

describe("the cleanup of a child", () => {
  const ledgerFor = (child, proc) => {
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    ledger.epoch = proc.read(CUSTODIAN_PID).identity;
    return ledger;
  };

  it("answers closed when the close was ALREADY seen before the cleanup", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    child.pushClose(0, null);
    proc.gone = true;
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "closed");
    assert.equal(ledger.closeBeforeCleanup, true);
    // NOTHING was signalled: the child was already gone.
    assert.deepEqual(child.killed, []);
  });

  it("does not signal a child whose exit was seen but whose streams are still open", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    child.pushExit(0, null);
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    // The close never came: the answer is unknown, and NOTHING was signalled.
    assert.equal(result.kind, "unknown");
    assert.deepEqual(child.killed, []);
  });

  it("answers closed when the close really comes after the polite signal", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    child.onKill = (signal) => { if (signal === "SIGTERM") { child.pushClose(0, "SIGTERM"); proc.gone = true; } };
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "closed");
    // The hard signal was NOT needed.
    assert.deepEqual(child.killed, ["SIGTERM"]);
  });

  it("answers closed when the close really comes after the hard signal", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    child.onKill = (signal) => { if (signal === "SIGKILL") { child.pushClose(0, "SIGKILL"); proc.gone = true; } };
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "closed");
    assert.deepEqual(child.killed, ["SIGTERM", "SIGKILL"]);
  });

  it("answers unknown when the child never closes, and keeps the owner", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "unknown");
    // The owner, the close promise and the epoch are all still there.
    assert.equal(ledger.child, child);
    assert.notEqual(ledger.closePromise, null);
    assert.notEqual(ledger.epoch, null);
    assert.equal(ledger.closeSeen, false);
  });

  it("answers unknown when the signal throws", async () => {
    const child = new FakeChild();
    child.killBehaviour = "throw";
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "unknown");
    assert.match(result.reason, /could not be delivered/u);
  });

  it("answers unknown when the signal is refused", async () => {
    const child = new FakeChild();
    child.killBehaviour = "refuse";
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "unknown");
    assert.match(result.reason, /refused/u);
  });

  it("does not signal a number that was reused by another process", async () => {
    const child = new FakeChild();
    const proc = new FakeProc({ ...EPOCH, start_ticks: "999" });
    const ledger = ledgerFor(child, proc);
    // The epoch that was recorded AT THE START is the original one; the
    // fresh read is another process that reused the number.
    ledger.epoch = EPOCH;
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "unknown");
    // NOTHING was signalled: the number belongs to somebody else now.
    assert.deepEqual(child.killed, []);
  });

  it("does not signal when the epoch of the process could not be read", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(null);
    const ledger = ledgerFor(child, proc);
    ledger.epoch = EPOCH;
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "unknown");
    assert.deepEqual(child.killed, []);
  });

  it("does not signal when the never-fork invariant was lost", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    ledger.noAuthorizeWrites = false;
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "unknown");
    assert.match(result.reason, /never-fork invariant/u);
    assert.deepEqual(child.killed, []);
  });

  it("answers no-child-confirmed when the spawn failed and the close really came", async () => {
    const child = new FakeChild();
    // The spawn failed: there was never a child, and there is no number.
    child.pid = undefined;
    const proc = new FakeProc(EPOCH);
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    child.pushError(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    child.pushClose(-2, null);
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    // The error alone was not an end: the REAL close is what ended it, and there
    // was never a child to confirm.
    assert.equal(result.kind, "no-child-confirmed");
    assert.equal(ledger.errorSeen, true);
    assert.equal(ledger.closeSeen, true);
  });

  it("shares ONE promise on a repeated cleanup, and signals only once", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    const { deps } = fakeDeps({ child, proc });
    const first = cleanupChild(ledger, deps);
    const second = cleanupChild(ledger, deps);
    assert.equal(first, second);
    await first;
    await second;
    // The ladder ran once: two signals, not four.
    assert.deepEqual(child.killed, ["SIGTERM", "SIGKILL"]);
  });

  it("does not end the child when its process is still there", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    child.pushClose(0, null);
    // The process is still there: the close of the streams is not the end of it.
    const { deps } = fakeDeps({ child, proc });
    const result = await cleanupChild(ledger, deps);
    assert.equal(result.kind, "unknown");
    assert.match(result.reason, /still there/u);
  });

  it("refuses to own a child whose exit was already seen", () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = ledgerFor(child, proc);
    child.pushExit(0, null);
    const { deps } = fakeDeps({ child, proc });
    const verdict = verifyOwnedLiveChild(ledger, deps);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /exit/u);
  });
});

describe("the orchestration of the pilot", () => {
  it("refuses before it starts anything when the custodian is not the reviewed one", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps, state } = fakeDeps({
      child,
      proc,
      overrides: { sha256OfFile: (path) => (path === PYTHON_PATH ? PYTHON_SHA256 : "b".repeat(64)) },
    });
    const outcome = await runPilot({ mode: "identity", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    assert.equal(outcome.kind, "refused");
    assert.equal(state.spawned.length, 0);
  });

  it("refuses before it starts anything when the interpreter is not the fixed one", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps, state } = fakeDeps({
      child,
      proc,
      overrides: { sha256OfFile: () => "c".repeat(64) },
    });
    const outcome = await runPilot({ mode: "identity", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    assert.equal(outcome.kind, "refused");
    assert.equal(state.spawned.length, 0);
  });

  it("checks the identity and cleans up, and never writes to the control channel", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps, state } = fakeDeps({ child, proc });
    child.onKill = (signal) => { child.pushClose(0, signal); proc.gone = true; };
    // The custodian states its identity as soon as it is asked.
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => { started.control.pushData(helloFrame()); });
      return started;
    };
    const outcome = await runPilot({ mode: "identity", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    assert.equal(outcome.kind, "ok");
    assert.equal(outcome.cleanup.kind, "closed");
    // The control channel of the tool has a READ API only: there is nothing to
    // write a frame with.
    assert.equal(typeof child.control.write, "undefined");
    // The fixed argument vector and the private environment.
    assert.deepEqual(state.spawned[0].argv, [
      PYTHON_PATH, "-I", "-S", "-B", `${REPOSITORY_ROOT}/src/adapters/openfilm/cache-process-custodian.py`,
    ]);
    assert.equal(state.spawned[0].options.detached, true);
    assert.equal(state.spawned[0].options.env.HOME, "/tmp/nofork-root/home");
    assert.equal(state.spawned[0].options.env.NODE_OPTIONS, undefined);
    assert.equal(state.spawned[0].options.env.PYTHONPATH, undefined);
  });

  it("marks the deliberate failure only when it really happened and the child really closed", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps } = fakeDeps({ child, proc });
    child.onKill = (signal) => { child.pushClose(0, signal); proc.gone = true; };
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => { started.control.pushData(helloFrame()); });
      return started;
    };
    const outcome = await runPilot({ mode: "assertion-failure", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    // The deliberate error was observed, the child really closed and the epoch
    // is really gone: the fault case passed - and it did not pass because
    // something was rejected.
    assert.equal(outcome.kind, "fault-observed");
    assert.equal(outcome.error.code, EXPECTED_ASSERTION_FAILURE);
    assert.equal(outcome.cleanup.kind, "closed");
    assert.equal(outcome.epoch_gone, true);
  });

  it("does not mark the fault case when the child did not really close", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps } = fakeDeps({ child, proc });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => { started.control.pushData(helloFrame()); });
      return started;
    };
    const outcome = await runPilot({ mode: "assertion-failure", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    assert.notEqual(outcome.kind, "fault-observed");
    assert.equal(outcome.cleanup.kind, "unknown");
  });
});

describe("the environment of the custodian", () => {
  it("is a fixed allowlist that points at the private root", () => {
    const env = privateEnvironment("/tmp/root");
    assert.equal(env.HOME, "/tmp/root/home");
    assert.equal(env.XDG_CACHE_HOME, "/tmp/root/cache");
    assert.equal(env.XDG_RUNTIME_DIR, "/tmp/root/runtime");
    assert.equal(env.TMPDIR, "/tmp/root/tmp");
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.PYTHONPATH, undefined);
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, undefined);
  });
});

/** One frame of the control channel whose payload is a given size. */
function sizedFrame(bytes) {
  const payload = Buffer.alloc(bytes, 0x62);
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(bytes, 0);
  return Buffer.concat([header, payload]);
}

describe("the owner of the nofork pilot", () => {
  it("does not run the pilot when its module is imported", () => {
    // The entry guard of the tool: importing it is not running it.
    assert.equal(isEntryPoint(), false);
    assert.equal(realSpawnCalls, 0);
    assert.equal(realRootCalls, 0);
  });

  it("keeps the owner when the outcome and the held evidence cannot be written", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps, state } = fakeDeps({
      child,
      proc,
      evidenceFailures: new Set(["outcome.json", "held.json"]),
    });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => { started.control.pushData(helloFrame()); });
      return started;
    };
    let settled = null;
    const promise = main(["--mode", "identity", "--expected-custodian-sha256", CUSTODIAN_SHA], deps)
      .then((code) => { settled = code; return code; });
    // The HELD branch is reached: the cleanup could not prove the end.
    assert.equal(
      await waitUntil(() => state.evidenceFailures.some((failure) => failure.name === "held.json")),
      true,
    );
    // The child is STILL alive: the promise did NOT settle and it did NOT
    // reject. Two failed writes never take the owner away.
    assert.equal(settled, null);
    assert.equal(child.exitCode, null);
    // The child really ends: the exit, the close and the fresh proof that the
    // original epoch is gone.
    child.pushExit(0, "SIGKILL");
    child.pushClose(0, "SIGKILL");
    proc.gone = true;
    const code = await promise;
    // The case ends as a FAILURE, and the writes that failed are facts.
    assert.equal(code, 1);
    assert.deepEqual(
      state.evidenceFailures.map((failure) => failure.name).sort(),
      ["held.json", "outcome.json"],
    );
    // The owner was never signalled a second time after the HELD branch.
    assert.deepEqual(child.killed, ["SIGTERM", "SIGKILL"]);
  });

  it("does not accept an identity whose standard output overflowed", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps } = fakeDeps({ child, proc });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => {
        started.control.pushData(helloFrame());
        started.stdout.pushData(Buffer.alloc(PILOT_LIMITS.streamBytes + 1, 0x61));
      });
      return started;
    };
    child.onKill = (signal) => { child.pushExit(0, signal); child.pushClose(0, signal); proc.gone = true; };
    const outcome = await runPilot({ mode: "identity", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    // The child really closed and its epoch is really gone: the ONLY reason
    // this case fails is the known overflow.
    assert.equal(outcome.cleanup.kind, "closed");
    assert.equal(outcome.terminal_proof.complete, true);
    assert.equal(outcome.unexpected_failure.source, "stdout-overflow");
    assert.equal(outcome.kind, "failed");
  });

  it("does not mark the fault case when the control channel broke", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps } = fakeDeps({ child, proc });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => {
        started.control.pushData(helloFrame());
        started.control.pushError(new Error("the control channel broke"));
      });
      return started;
    };
    child.onKill = (signal) => { child.pushExit(0, signal); child.pushClose(0, signal); proc.gone = true; };
    const outcome = await runPilot({ mode: "assertion-failure", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    // The deliberate failure WAS observed, and it still does not pass: the
    // control channel broke.
    assert.equal(outcome.fault_observed, true);
    assert.equal(outcome.error.code, EXPECTED_ASSERTION_FAILURE);
    assert.equal(outcome.unexpected_failure.source, "control-error");
    assert.equal(outcome.fault_case_passed, false);
    assert.equal(outcome.kind, "failed");
  });

  it("bounds the NUMBER of the complete frames that wait", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps } = fakeDeps({ child, proc });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => {
        started.control.pushData(helloFrame());
        const many = [];
        for (let index = 0; index < PILOT_LIMITS.controlQueueFrames + 20; index += 1) {
          many.push(helloFrame({ seq: index + 2 }));
        }
        started.control.pushData(Buffer.concat(many));
      });
      return started;
    };
    child.onKill = (signal) => { child.pushExit(0, signal); child.pushClose(0, signal); proc.gone = true; };
    const outcome = await runPilot({ mode: "identity", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    assert.equal(outcome.unexpected_failure.source, "control-queue-overflow");
    assert.equal(outcome.ledger.frameQueueOverflow, true);
    assert.ok(outcome.ledger.frames.length <= PILOT_LIMITS.controlQueueFrames);
    assert.equal(outcome.kind, "failed");
  });

  it("bounds the BYTES of the complete frames that wait", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps } = fakeDeps({ child, proc });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => {
        started.control.pushData(helloFrame());
        for (let index = 0; index < 20; index += 1) {
          started.control.pushData(sizedFrame(PILOT_LIMITS.controlFrameBytes));
        }
      });
      return started;
    };
    child.onKill = (signal) => { child.pushExit(0, signal); child.pushClose(0, signal); proc.gone = true; };
    const outcome = await runPilot({ mode: "identity", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    assert.equal(outcome.unexpected_failure.source, "control-queue-overflow");
    assert.equal(outcome.ledger.frameQueueOverflow, true);
    assert.ok(outcome.ledger.frameQueueBytes <= PILOT_LIMITS.controlQueueBytes);
    assert.equal(outcome.kind, "failed");
  });

  it("waits for the fresh proof when the close was seen but the process was not", async () => {
    const child = new FakeChild();
    // The first two reads are the epoch and the identity, the third one is the
    // end of the cleanup, and the ones after it are the polls of the owner.
    const proc = new FakeProc(EPOCH, [
      "known", "known",
      "unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown",
      "gone",
    ]);
    const { deps, state } = fakeDeps({ child, proc });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => {
        started.control.pushData(helloFrame());
        started.pushClose(0, "SIGTERM");
      });
      return started;
    };
    let settled = null;
    const promise = main(["--mode", "identity", "--expected-custodian-sha256", CUSTODIAN_SHA], deps)
      .then((code) => { settled = code; return code; });
    // The owner is held: the close was seen, but the epoch was not proven gone.
    assert.equal(await waitUntil(() => state.stderr.length > 0), true);
    await turns(5);
    assert.equal(settled, null);
    // The owner NEVER signalled the child again: the close was already seen.
    assert.deepEqual(child.killed, []);
    // The proof arrives: the original epoch is really gone.
    const code = await promise;
    assert.equal(code, 1);
    assert.equal(proc.lastStep, "gone");
    // The final record says that the proof was complete.
    const final = state.evidence.find((entry) => entry.name === "final.json");
    assert.notEqual(final, undefined);
    assert.equal(final.data.proof.complete, true);
  });

  it("keeps the original start failure when the child was never born", async () => {
    const child = new FakeChild();
    // The spawn failed: there was never a child, and there is no number.
    child.pid = undefined;
    const proc = new FakeProc(EPOCH);
    const { deps } = fakeDeps({ child, proc });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      // The failure comes ASYNCHRONOUSLY, and there is no exit at all.
      setImmediate(() => {
        started.pushError(Object.assign(new Error("spawn EAGAIN"), { code: "EAGAIN" }));
        started.pushClose(null, null);
      });
      return started;
    };
    const outcome = await runPilot({ mode: "identity", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    // The REAL error of the start is the failure: no TypeError covers it.
    assert.equal(outcome.error.code, "EAGAIN");
    assert.equal(outcome.kind, "failed");
    // There was never a child, and the close really came: the no-child route.
    assert.equal(outcome.cleanup.kind, "no-child-confirmed");
    assert.equal(outcome.terminal_proof.no_birth, true);
    assert.equal(outcome.ledger.pid, null);
    // The proof of the no-birth case is complete.
    assert.equal(outcome.terminal_proof.complete, true);
  });

  it("refuses an identity whose fresh epoch has another parent", async () => {
    const hello = parseCustodianHello(helloPayload());
    const verdict = verifyCustodianIdentity(hello, {
      spawnedPid: CUSTODIAN_PID,
      toolPid: TOOL_PID,
      fresh: { presence: "known", identity: { ...EPOCH, ppid: 4243 }, reason: null },
    });
    assert.equal(verdict.ok, false);

    const child = new FakeChild();
    const proc = new FakeProc({ ...EPOCH, ppid: 4243 });
    const { deps } = fakeDeps({ child, proc });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => { started.control.pushData(helloFrame()); });
      return started;
    };
    child.onKill = (signal) => { child.pushExit(0, signal); child.pushClose(0, signal); proc.gone = true; };
    const outcome = await runPilot({ mode: "identity", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.error.code, "IDENTITY_MISMATCH");
  });

  it("separates the plain case from the deliberate failure", async () => {
    const run = async (mode) => {
      const child = new FakeChild();
      const proc = new FakeProc(EPOCH);
      const { deps } = fakeDeps({ child, proc });
      const originalSpawn = deps.spawnChild;
      deps.spawnChild = (argv, options) => {
        const started = originalSpawn(argv, options);
        setImmediate(() => { started.control.pushData(helloFrame()); });
        return started;
      };
      child.onKill = (signal) => { child.pushExit(0, signal); child.pushClose(0, signal); proc.gone = true; };
      return await main(["--mode", mode, "--expected-custodian-sha256", CUSTODIAN_SHA], deps);
    };
    // The plain case ends with the code of success; the deliberate failure
    // ends with the code of the fault - which is NOT a success.
    assert.equal(await run("identity"), 0);
    assert.equal(await run("assertion-failure"), 1);
  });

  it("answers the complete proof with one fact at a time", () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    ledger.epoch = EPOCH;
    const { deps } = fakeDeps({ child, proc });
    // No close at all: the proof is not complete.
    assert.equal(checkTerminalProof(ledger, deps).complete, false);
    // The close with its code, but the process is still there.
    child.pushClose(0, "SIGTERM");
    const stillThere = checkTerminalProof(ledger, deps);
    assert.equal(stillThere.complete, false);
    assert.match(stillThere.reason, /still there/u);
    // The original epoch is really gone: the proof is complete.
    proc.gone = true;
    const complete = checkTerminalProof(ledger, deps);
    assert.equal(complete.complete, true);
    assert.equal(complete.epoch_gone, true);
    assert.equal(complete.exit_fact, true);
  });

  it("keeps the live owner when the reporting destination breaks asynchronously", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const writable = new FakeWritable();
    // The destination breaks ASYNCHRONOUSLY: the write returns normally and
    // the EPIPE comes on a later turn, by the completion of the write and by
    // the error event of the destination.
    writable.nextError = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    const { deps, state } = fakeDeps({ child, proc, overrides: { reportStream: writable } });
    deps.writeStderr = (text, callback) => {
      state.stderr.push(text);
      writable.write(text, callback);
    };
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => { started.control.pushData(helloFrame()); });
      return started;
    };
    let settled = null;
    const promise = main(["--mode", "identity", "--expected-custodian-sha256", CUSTODIAN_SHA], deps)
      .then((code) => { settled = code; return code; });
    // The HELD branch is reached: the cleanup could not prove the end.
    assert.equal(await waitUntil(() => state.stderr.length > 0), true);
    // The destination is LISTENED TO: an unhandled error event would have
    // ended the process and stranded the child.
    assert.ok(writable.listenerCount("error") >= 1);
    // The failure arrives on a later turn.
    await turns(3);
    // The failure really came by the ERROR EVENT of the destination, and not
    // only by the completion of the write.
    assert.equal(writable.emitted, 1);
    // The owner is NOT lost: the promise has not settled, the root is the same
    // one and the child was not signalled again.
    assert.equal(settled, null);
    assert.equal(state.roots.length, 1);
    assert.deepEqual(child.killed, ["SIGTERM", "SIGKILL"]);
    // The child really ends: the exit, the close and the fresh proof that the
    // original epoch is gone.
    child.pushExit(0, "SIGKILL");
    child.pushClose(0, "SIGKILL");
    proc.gone = true;
    const code = await promise;
    assert.equal(code, 1);
    // The EPIPE is KEPT, and the two routes of it are ONE failure.
    const final = state.evidence.find((entry) => entry.name === "final.json");
    assert.notEqual(final, undefined);
    assert.equal(final.data.reporting_failure.error.code, "EPIPE");
    assert.equal(final.data.reporting_failures.length, 1);
    assert.equal(final.data.proof.complete, true);
  });

  it("clears every pass marker when the evidence of the outcome cannot be written", async () => {
    const child = new FakeChild();
    const proc = new FakeProc(EPOCH);
    const { deps } = fakeDeps({ child, proc, evidenceFailures: new Set(["outcome.json"]) });
    const originalSpawn = deps.spawnChild;
    deps.spawnChild = (argv, options) => {
      const started = originalSpawn(argv, options);
      setImmediate(() => { started.control.pushData(helloFrame()); });
      return started;
    };
    child.onKill = (signal) => { child.pushExit(0, signal); child.pushClose(0, signal); proc.gone = true; };
    const outcome = await runPilot({ mode: "assertion-failure", expectedCustodianSha256: CUSTODIAN_SHA }, deps);
    // The case WAS a complete expected fault before the write of its evidence
    // failed.
    assert.equal(outcome.fault_observed, true);
    assert.equal(outcome.cleanup.kind, "closed");
    assert.equal(outcome.terminal_proof.complete, true);
    // The failed write makes the result a FAILURE and clears EVERY marker.
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.fault_case_passed, false);
    assert.equal(outcome.identity_proved, false);
    assert.equal(outcome.evidence_published, false);
    // The original error and the proof of the cleanup are KEPT.
    assert.equal(outcome.error.code, EXPECTED_ASSERTION_FAILURE);
    assert.equal(outcome.cleanup.kind, "closed");
    assert.equal(outcome.terminal_proof.complete, true);
    // The error of the write is an unexpected failure of the case.
    assert.equal(outcome.unexpected_failure.source, "evidence-write");
    assert.equal(outcome.unexpected_failure.error.code, "ENOSPC");
    assert.equal(outcome.evidence_errors.length, 1);
    assert.equal(outcome.evidence_errors[0].name, "outcome.json");

    // The same thing through the real main: the code of the process is a
    // FAILURE and not the expected code of the deliberate fault.
    const child2 = new FakeChild();
    const proc2 = new FakeProc(EPOCH);
    const { deps: deps2 } = fakeDeps({ child: child2, proc: proc2, evidenceFailures: new Set(["outcome.json"]) });
    const originalSpawn2 = deps2.spawnChild;
    deps2.spawnChild = (argv, options) => {
      const started = originalSpawn2(argv, options);
      setImmediate(() => { started.control.pushData(helloFrame()); });
      return started;
    };
    child2.onKill = (signal) => { child2.pushExit(0, signal); child2.pushClose(0, signal); proc2.gone = true; };
    const code = await main(["--mode", "assertion-failure", "--expected-custodian-sha256", CUSTODIAN_SHA], deps2);
    assert.equal(code, 1);
  });

  it("keeps the decoder terminal after the first bad chunk", () => {
    const child = new FakeChild();
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    // The FIRST chunk is refused: its header claims more than the limit.
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(PILOT_LIMITS.controlBufferBytes + 1, 0);
    child.control.pushData(header);
    // The channel keeps sending: THOUSANDS of chunks after the failure.
    for (let index = 0; index < 3000; index += 1) {
      child.control.pushData(Buffer.alloc(64, 0x41));
    }
    // The invalid buffer is RELEASED and the queue keeps AT MOST ONE marker.
    assert.equal(ledger.controlDecoder.failed, true);
    assert.equal(ledger.controlDecoder.pending, 0);
    assert.equal(ledger.frames.length, 1);
    assert.equal(ledger.controlErrorMarker, true);
    assert.equal(ledger.frameQueueBytes, 0);
    // The FIRST failure is the one that is kept.
    assert.equal(ledger.firstFailure.source, "control-decode-error");
    assert.equal(ledger.controlError.code, "CONTROL_FRAME_TOO_LARGE");
  });

  it("counts the bytes of the frames that wait, and forgets them when they are taken", () => {
    const child = new FakeChild();
    const ledger = createChildLedger({ child, stdout: child.stdout, stderr: child.stderr, control: child.control });
    child.control.pushData(helloFrame());
    assert.equal(ledger.frameQueueBytes > 0, true);
    const frame = takeControlFrame(ledger);
    assert.notEqual(frame, undefined);
    // The frame was TAKEN: it does not wait any more, and the accounting
    // follows the queue.
    assert.equal(ledger.frameQueueBytes, 0);
  });
});
