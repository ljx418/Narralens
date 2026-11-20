import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The NO-FORK pilot of the native cache custodian.
 *
 * It answers ONE small question, and it answers it with a REAL process:
 *
 *   When the custodian of a draw is started on its own, DETACHED, and nobody
 *   ever authorizes a fork - does it state its own identity truthfully, does it
 *   lead its own session and its own group, and can it be ended afterwards
 *   without leaving anything behind?
 *
 * WHAT THIS TOOL IS NOT
 *
 * It is not a production path and it is not a rehearsal of one. It has exactly
 * two modes and no other configuration: there is no way to give it an
 * executable, an argument vector, a script, a signal or a process number. The
 * custodian it starts is the FIXED file of the repository, and the interpreter
 * is the FIXED interpreter of this machine.
 *
 * The NEVER-FORK INVARIANT is structural, not a promise: the control channel of
 * this tool has a READ API only. There is no function anywhere in this file that
 * writes a byte to it, so no AUTHORIZE_FORK, no GO and no control frame of any
 * kind can be sent. The worker N therefore never exists, and the custodian
 * never has a group to reap.
 *
 * That is why the tool may end the custodian: a custodian that never forked
 * has nothing to reap. The same capability must NEVER be reused on a path that
 * may already have forked a worker - the ledger below refuses to signal when
 * the invariant is not in place.
 *
 * The OWNERSHIP of the child is the point of this file. A child that was
 * started is owned until it REALLY closed: the ledger registers the error, the
 * exit and the close BEFORE anything waits, the close promise is ONE shared
 * promise that resolves with an explicit object, and the cleanup answers with a
 * TAGGED result - closed, no-child-confirmed, or unknown. A timeout is never an
 * end, an error is never an end, and a signal that threw is never an end.
 */

/// The protocol of the control channel. It is the revision 3 of the cache draw.
export const CONTROL_PROTOCOL = "narralens.openfilm-cache-process@3";

/// The interpreter of the custodian. It is FIXED, and its bytes are FIXED.
export const PYTHON_PATH = "/usr/bin/python3.12";

/// The digest of that interpreter, as the review recorded it.
export const PYTHON_SHA256 =
  "e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f";

/// The custodian, relative to the root of the repository. It is FIXED.
export const CUSTODIAN_RELATIVE_PATH = "src/adapters/openfilm/cache-process-custodian.py";

/// The code of the DELIBERATE failure of the `assertion-failure` mode.
export const EXPECTED_ASSERTION_FAILURE = "EXPECTED_ASSERTION_FAILURE";

/// The two modes of this tool. There are no others.
export const PILOT_MODES = Object.freeze(["identity", "assertion-failure"]);

/// The bounds of the pilot. They are ACTION bounds and never an end.
export const PILOT_LIMITS = Object.freeze({
  /// The longest a control frame may be.
  controlFrameBytes: 16 * 1024,
  /// The longest the unconsumed bytes of the control channel may be.
  controlBufferBytes: 16 * 1024 + 4,
  /// How many COMPLETE decoded frames may wait for the reader.
  controlQueueFrames: 64,
  /// How many bytes of COMPLETE decoded frames may wait for the reader.
  controlQueueBytes: 256 * 1024,
  /// How much a standard stream may write in total.
  streamBytes: 64 * 1024,
  /// How much of a standard stream is kept.
  streamTailBytes: 8 * 1024,
  /// How long the custodian may take to state its identity.
  helloTimeoutMs: 30_000,
  /// How long the polite signal may take to be answered by a real close.
  termGraceMs: 3_000,
  /// How long the hard signal may take to be answered by a real close.
  killConfirmMs: 15_000,
  /// How long a child that never existed may take to close.
  closeWithoutChildMs: 3_000,
  /// How long a child that exited may take to close its streams.
  closeAfterExitMs: 15_000,
  /// How long ONE poll of the HELD owner waits for the close.
  heldPollMs: 1_000,
  /// How long the HELD owner waits between two proofs.
  heldPollIntervalMs: 50,
});

/// The root of the repository: the directory above `tools`.
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/// Where the owned root of one run is created.
export const PILOT_ROOT_RELATIVE_PATH = "var/native-cache-pilot";

/** A failure of the pilot itself. It is reported and it is never swallowed. */
export class PilotFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PilotFailure";
    this.code = code;
  }
}

/**
 * Parse ONE /proc/<pid>/stat text.
 *
 * Only the fields after the LAST closing parenthesis are read, and the start
 * time is kept as an EXACT STRING: a number would lose the precision that
 * tells two processes apart.
 */
export function parseProcStat(text) {
  const head = text.indexOf("(");
  const cut = text.lastIndexOf(")");
  if (head < 0 || cut < 0 || cut < head) return null;
  const pidText = text.slice(0, head).trim();
  if (!/^[0-9]+$/u.test(pidText)) return null;
  const fields = text.slice(cut + 1).trim().split(/\s+/u);
  if (fields.length < 20) return null;
  const state = fields[0];
  const ppid = fields[1];
  const pgid = fields[2];
  const sid = fields[3];
  const startTicks = fields[19];
  if (!/^[0-9]+$/u.test(ppid)) return null;
  if (!/^[0-9]+$/u.test(pgid)) return null;
  if (!/^[0-9]+$/u.test(sid)) return null;
  if (!/^[0-9]+$/u.test(startTicks)) return null;
  return {
    pid: Number(pidText),
    state,
    ppid: Number(ppid),
    pgid: Number(pgid),
    sid: Number(sid),
    start_ticks: startTicks,
  };
}

/**
 * Read the identity of one process.
 *
 * `gone` is ONLY what the kernel says with ENOENT or ESRCH. Every other
 * failure is `unknown`: an unknown process is never an empty one.
 */
export function readProcIdentity(pid, readFile = readFileSync) {
  if (!Number.isInteger(pid) || pid <= 0) return { presence: "gone", identity: null, reason: null };
  let text;
  try {
    text = readFile(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    const code = error === null || error === undefined ? "" : String(error.code ?? "");
    if (code === "ENOENT" || code === "ESRCH") {
      return { presence: "gone", identity: null, reason: null };
    }
    return { presence: "unknown", identity: null, reason: code === "" ? "the state could not be read" : code };
  }
  const identity = parseProcStat(text);
  if (identity === null) {
    return { presence: "unknown", identity: null, reason: "the state could not be parsed" };
  }
  return { presence: "known", identity, reason: null };
}

/**
 * The decoder of the control channel.
 *
 * The length is read BEFORE the payload, the payload is bounded, and the
 * unconsumed bytes are bounded: a channel that nobody reads may not grow
 * without a limit. A frame that claims more than the limit is REFUSED - it is
 * never truncated and accepted.
 *
 * The FIRST fatal failure is TERMINAL: the decoder releases the bytes it can
 * not decode, and the channel never feeds it again. A decoder that keeps an
 * invalid buffer would let every later chunk grow it, so the invalid buffer is
 * dropped at once and the decoder answers NOTHING from then on.
 */
export function createControlDecoder(limits = PILOT_LIMITS) {
  let buffer = Buffer.alloc(0);
  let failed = false;
  const fail = (error) => {
    failed = true;
    // The invalid bytes are RELEASED: they are never decoded and never kept.
    buffer = Buffer.alloc(0);
    throw error;
  };
  return {
    feed(chunk) {
      // A decoder that failed is terminal: it keeps NO byte and it answers
      // NOTHING. The channel is dead, and it is not fed again.
      if (failed) return [];
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      if (buffer.length > limits.controlBufferBytes) {
        fail(new PilotFailure("CONTROL_OVERSIZE", "the unconsumed bytes of the control channel exceed the limit"));
      }
      const frames = [];
      for (;;) {
        if (buffer.length < 4) break;
        const length = buffer.readUInt32BE(0);
        if (length + 4 > limits.controlBufferBytes) {
          fail(new PilotFailure("CONTROL_FRAME_TOO_LARGE", "a frame of the control channel is too large"));
        }
        if (buffer.length < 4 + length) break;
        frames.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
      return frames;
    },
    get pending() {
      return buffer.length;
    },
    /** Whether the decoder failed for good. */
    get failed() {
      return failed;
    },
  };
}

/**
 * Read ONE frame of the control channel.
 *
 * The bytes are strict UTF-8 and the message is a JSON object. The frame has to
 * be a C_HELLO of the protocol of revision 3, with the sequence number one and
 * the claim of the subreaper.
 */
export function parseCustodianHello(frame) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(frame);
  } catch {
    throw new PilotFailure("CONTROL_NOT_UTF8", "a frame of the control channel is not valid UTF-8");
  }
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    throw new PilotFailure("CONTROL_NOT_JSON", "a frame of the control channel is not JSON");
  }
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    throw new PilotFailure("CONTROL_NOT_OBJECT", "a frame of the control channel is not an object");
  }
  if (message.kind !== "C_HELLO") {
    throw new PilotFailure("CONTROL_NOT_HELLO", "the custodian did not open with its identity");
  }
  if (message.protocol !== CONTROL_PROTOCOL) {
    throw new PilotFailure("CONTROL_OTHER_PROTOCOL", "the custodian speaks another protocol");
  }
  if (message.seq !== 1) {
    throw new PilotFailure("CONTROL_WRONG_SEQUENCE", "the first message of the custodian is not the first one");
  }
  if (message.subreaper !== true) {
    throw new PilotFailure("CONTROL_NO_SUBREAPER", "the custodian does not claim the subreaper");
  }
  return message;
}

/**
 * Check that the custodian is the process it says it is.
 *
 * Every field is checked against the KERNEL and not against the message of the
 * custodian: the message may lie, the kernel may not.
 */
export function verifyCustodianIdentity(hello, { spawnedPid, toolPid, fresh, recordedEpoch = null }) {
  if (fresh === null || fresh.presence !== "known" || fresh.identity === null) {
    return { ok: false, reason: "the epoch of the custodian could not be read" };
  }
  if (Number(hello.pid) !== spawnedPid) {
    return { ok: false, reason: "the custodian states another number than the one it was started with" };
  }
  if (Number(hello.ppid) !== toolPid) {
    return { ok: false, reason: "the custodian does not have this program as its parent" };
  }
  if (Number(hello.pgid) !== Number(hello.pid) || Number(hello.sid) !== Number(hello.pid)) {
    return { ok: false, reason: "the custodian does not lead its own session and its own group" };
  }
  if (fresh.identity.pid !== spawnedPid) {
    return { ok: false, reason: "the number of the custodian belongs to another process" };
  }
  // The FRESH epoch has the same parent as the hello claims: the claim of the
  // custodian is not enough, the kernel has to say it too.
  if (Number(fresh.identity.ppid) !== toolPid) {
    return { ok: false, reason: "the fresh epoch does not have this program as its parent" };
  }
  if (recordedEpoch !== null && recordedEpoch !== undefined
    && Number(fresh.identity.ppid) !== Number(recordedEpoch.ppid)) {
    return { ok: false, reason: "the parent of the fresh epoch is not the recorded one" };
  }
  if (fresh.identity.pgid !== Number(hello.pgid) || fresh.identity.sid !== Number(hello.sid)) {
    return { ok: false, reason: "the group or the session of the custodian is another one" };
  }
  if (String(fresh.identity.start_ticks) !== String(hello.start_ticks)) {
    return { ok: false, reason: "the custodian started at another moment" };
  }
  return { ok: true, reason: null };
}

/**
 * Whether the ORIGINAL epoch of a process is really gone.
 *
 * A number that was reused by another process is a GONE original: the epoch is
 * what tells the two apart. An epoch that could not be read is NOT a proof.
 */
export function originalEpochIsGone(original, fresh) {
  if (original === null) return false;
  if (fresh.presence === "gone") return true;
  if (fresh.presence === "unknown") return false;
  return String(fresh.identity.start_ticks) !== String(original.start_ticks);
}

/** Keep a bounded description of an error. */
function boundedError(error) {
  if (error === null || error === undefined) return { name: "Error", message: "", code: null };
  const code = typeof error.code === "string" ? error.code.slice(0, 64) : null;
  const message = typeof error.message === "string" ? error.message.slice(0, 1024) : String(error).slice(0, 1024);
  return { name: String(error.name ?? "Error").slice(0, 128), message, code };
}

/** Keep the LAST bytes of a stream, and its total. */
function keepTail(tail, chunk, limit) {
  const together = Buffer.concat([tail, chunk]);
  return together.length > limit ? together.subarray(together.length - limit) : together;
}

/**
 * Latch ONE failure of the ledger.
 *
 * The FIRST failure is the one that counts: a later failure never replaces it,
 * it is only added to the bounded log beside it. Every failure of the ledger is
 * UNEXPECTED - the deliberate failure of the `assertion-failure` mode is thrown
 * by the pilot itself and never passes through here.
 */
export function noteLedgerFailure(ledger, source, error) {
  const bounded = error === null || error === undefined
    ? { name: "Error", message: "", code: null }
    : boundedError(error);
  ledger.failureLog.push({ source, error: bounded });
  while (ledger.failureLog.length > 16) ledger.failureLog.shift();
  if (ledger.firstFailure === null) ledger.firstFailure = { source, error: bounded };
  return ledger.firstFailure;
}

/**
 * The LEDGER of ONE child.
 *
 * Everything that is known about the child is registered HERE, synchronously,
 * BEFORE anything waits: the handle, the events that were seen, the bounded
 * diagnostics, the epoch that was read from the kernel, and the ONE promise
 * that says whether the child really closed.
 *
 * The facts are kept APART from each other: an error is not an exit, an exit is
 * not a close, the end of the control channel is not the end of the process,
 * and the close of a standard stream is not the close of the child. A close
 * that was seen BEFORE the cleanup is remembered as such, and the result of the
 * cleanup never depends on a listener that was added during the cleanup.
 */
export function createChildLedger({ child, stdout, stderr, control, limits = PILOT_LIMITS } = {}) {
  const ledger = {
    child: child ?? null,
    pid: child !== null && child !== undefined && typeof child.pid === "number" && child.pid > 0
      ? child.pid
      : null,
    /**
     * The NEVER-FORK INVARIANT. It is set here, and the cleanup refuses to
     * signal when it is not in place.
     */
    noAuthorizeWrites: true,
    /** The epoch of the child, as the kernel reported it at the start. */
    epoch: null,
    /** The exit was seen. It is NOT the end. */
    exitSeen: false,
    exit: null,
    /** The close was really seen. */
    closeSeen: false,
    close: null,
    /** An error was seen. It is NOT the end. */
    errorSeen: false,
    error: null,
    errors: [],
    /** The RAW first error of the child: the one that is really reported. */
    firstError: null,
    /**
     * The FIRST UNEXPECTED failure of this child, and the bounded log of the
     * ones that came after it. A known failure disqualifies a case.
     */
    firstFailure: null,
    failureLog: [],
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTail: Buffer.alloc(0),
    stderrTail: Buffer.alloc(0),
    stdoutEnded: false,
    stderrEnded: false,
    stdoutError: null,
    stderrError: null,
    controlEnded: false,
    controlError: null,
    /** The decoder failed for good: the channel is dead. */
    controlDecoderFailed: false,
    /** The ONE bounded error marker of the control channel. */
    controlErrorMarker: false,
    diagnosticsLost: false,
    /** The ONE promise of the close. It resolves with an EXPLICIT object. */
    closePromise: null,
    resolveClose: null,
    /** The ONE promise of the cleanup. */
    cleanupPromise: null,
    cleanupStarted: false,
    /** The close was already seen when the cleanup started. */
    closeBeforeCleanup: false,
    /** Every signal that was sent, and what the kernel said about it. */
    signalsSent: [],
    /** The frames of the control channel that were decoded. */
    frames: [],
    controlFrames: 0,
    /** The bytes of the COMPLETE frames that wait for the reader. */
    frameQueueBytes: 0,
    /** The queue of the complete frames grew past its bound. */
    frameQueueOverflow: false,
    controlDecoder: createControlDecoder(limits),
  };

  ledger.closePromise = new Promise((resolveClose) => {
    ledger.resolveClose = resolveClose;
  });

  if (ledger.child !== null && typeof ledger.child.on === "function") {
    ledger.child.on("error", (error) => {
      ledger.errorSeen = true;
      const bounded = boundedError(error);
      if (ledger.error === null) ledger.error = bounded;
      if (ledger.firstError === null) ledger.firstError = error;
      ledger.errors.push(bounded);
      noteLedgerFailure(ledger, "child-error", error);
    });
    ledger.child.on("exit", (code, signal) => {
      ledger.exitSeen = true;
      ledger.exit = { code: code ?? null, signal: signal ?? null };
    });
    ledger.child.on("close", (code, signal) => {
      ledger.closeSeen = true;
      ledger.close = { code: code ?? null, signal: signal ?? null };
      // The promise resolves with an EXPLICIT object, never with a bare truthy
      // value: the callers compare the KIND.
      ledger.resolveClose({ kind: "closed", code: code ?? null, signal: signal ?? null });
    });
  }

  const attachStream = (stream, which) => {
    if (stream === null || stream === undefined || typeof stream.on !== "function") return;
    stream.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (which === "stdout") {
        ledger.stdoutBytes += bytes.length;
        ledger.stdoutTail = keepTail(ledger.stdoutTail, bytes, limits.streamTailBytes);
        if (ledger.stdoutBytes > limits.streamBytes) {
          ledger.diagnosticsLost = true;
          noteLedgerFailure(ledger, "stdout-overflow", null);
        }
      } else {
        ledger.stderrBytes += bytes.length;
        ledger.stderrTail = keepTail(ledger.stderrTail, bytes, limits.streamTailBytes);
        if (ledger.stderrBytes > limits.streamBytes) {
          ledger.diagnosticsLost = true;
          noteLedgerFailure(ledger, "stderr-overflow", null);
        }
      }
    });
    stream.on("end", () => {
      if (which === "stdout") ledger.stdoutEnded = true;
      else ledger.stderrEnded = true;
    });
    stream.on("close", () => {
      if (which === "stdout") ledger.stdoutEnded = true;
      else ledger.stderrEnded = true;
    });
    stream.on("error", (error) => {
      if (which === "stdout") ledger.stdoutError = boundedError(error);
      else ledger.stderrError = boundedError(error);
      noteLedgerFailure(ledger, `${which}-error`, error);
    });
  };
  attachStream(stdout, "stdout");
  attachStream(stderr, "stderr");

  if (control !== null && control !== undefined && typeof control.on === "function") {
    control.on("data", (chunk) => {
      let frames;
      try {
        frames = ledger.controlDecoder.feed(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      } catch (error) {
        // The FIRST fatal failure of the decoder is terminal: the invalid
        // buffer is released by the decoder itself, and AT MOST ONE bounded
        // error marker is queued. The later chunks of this channel are not
        // decoded and are not queued.
        ledger.controlError = boundedError(error);
        ledger.controlDecoderFailed = true;
        if (!ledger.controlErrorMarker) {
          ledger.controlErrorMarker = true;
          ledger.frames.push(null);
        }
        noteLedgerFailure(ledger, "control-decode-error", error);
        return;
      }
      if (ledger.controlDecoderFailed) return;
      for (const frame of frames) {
        ledger.controlFrames += 1;
        // The queue of the COMPLETE frames is bounded as well: a partial
        // buffer that is bounded still lets complete frames pile up. The first
        // frame - the identity - is never dropped.
        if (ledger.frames.length >= limits.controlQueueFrames
          || ledger.frameQueueBytes + frame.length > limits.controlQueueBytes) {
          ledger.frameQueueOverflow = true;
          noteLedgerFailure(ledger, "control-queue-overflow", null);
          break;
        }
        ledger.frames.push(frame);
        ledger.frameQueueBytes += frame.length;
      }
    });
    control.on("end", () => {
      // The end of the control channel is NOT the end of the process.
      ledger.controlEnded = true;
    });
    control.on("close", () => {
      ledger.controlEnded = true;
    });
    control.on("error", (error) => {
      ledger.controlError = boundedError(error);
      noteLedgerFailure(ledger, "control-error", error);
    });
  }

  return ledger;
}

/**
 * Take the next decoded frame of the control channel, or undefined.
 *
 * The frames are QUEUED when they arrive: a block that arrived while nobody
 * was waiting is never dropped.
 */
export function takeControlFrame(ledger) {
  if (ledger.frames.length === 0) return undefined;
  const frame = ledger.frames.shift();
  // The bytes of a frame that was TAKEN are not waiting any more: the queue
  // accounting follows the queue.
  if (frame !== null && frame !== undefined) {
    ledger.frameQueueBytes = Math.max(0, ledger.frameQueueBytes - frame.length);
  }
  return frame;
}

/**
 * Check that the child is STILL the process this tool started.
 *
 * The check is SYNCHRONOUS on purpose: there is no await between the check and
 * the signal that follows it, so the process cannot change in between.
 *
 * The number alone is never ownership: the FRESH epoch of the kernel has to
 * match the epoch that was recorded at the start.
 */
export function verifyOwnedLiveChild(ledger, deps) {
  if (ledger.noAuthorizeWrites !== true) {
    return { ok: false, reason: "the never-fork invariant was lost" };
  }
  if (ledger.exitSeen) {
    return { ok: false, reason: "the exit of the child was already seen" };
  }
  const child = ledger.child;
  if (child === null) return { ok: false, reason: "there is no child" };
  if (child.exitCode !== null && child.exitCode !== undefined) {
    return { ok: false, reason: "the child already has an exit code" };
  }
  if (child.signalCode !== null && child.signalCode !== undefined) {
    return { ok: false, reason: "the child already has a signal code" };
  }
  if (ledger.pid === null) return { ok: false, reason: "the child has no number" };
  if (ledger.epoch === null) return { ok: false, reason: "the epoch of the child was never recorded" };
  const fresh = deps.readProcIdentity(ledger.pid);
  if (fresh.presence === "gone") return { ok: false, reason: "the process is gone" };
  if (fresh.presence === "unknown") {
    return { ok: false, reason: "the epoch of the process could not be read" };
  }
  if (fresh.identity.pid !== ledger.epoch.pid) {
    return { ok: false, reason: "the number belongs to another process" };
  }
  if (String(fresh.identity.start_ticks) !== String(ledger.epoch.start_ticks)) {
    return { ok: false, reason: "the number was reused by another process" };
  }
  if (fresh.identity.ppid !== ledger.epoch.ppid) {
    return { ok: false, reason: "the parent of the process changed" };
  }
  if (fresh.identity.pgid !== ledger.epoch.pgid) {
    return { ok: false, reason: "the group of the process changed" };
  }
  if (fresh.identity.sid !== ledger.epoch.sid) {
    return { ok: false, reason: "the session of the process changed" };
  }
  return { ok: true, reason: null };
}

/** Wait for the close, bounded. A deadline is NEVER an end. */
export async function waitForClose(ledger, deps, milliseconds) {
  const deadline = deps.now() + milliseconds;
  for (;;) {
    if (ledger.closeSeen) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(20);
  }
}

/**
 * The COMPLETE terminal proof of a child.
 *
 * It is the ONE place that says whether a child REALLY ended, and it is used
 * by the cleanup, by the HELD recovery and by the final result of the pilot.
 *
 * The proof needs three facts:
 *
 *   1. the close REALLY arrived;
 *   2. the exit REALLY happened, or there was never a child at all - the error
 *      and the close of a child that was never born;
 *   3. the ORIGINAL epoch is gone: the kernel says the number does not exist,
 *      or it says that the number belongs to another generation now.
 *
 * It NEVER fetches the authority of a new number: a reused number only proves
 * that the ORIGINAL epoch is gone. An epoch that could not be read is NOT a
 * proof, and the owner keeps its responsibility until the proof is complete.
 */
export function checkTerminalProof(ledger, deps) {
  const proof = {
    complete: false,
    kind: "unknown",
    reason: null,
    close_seen: false,
    exit_seen: false,
    exit_fact: false,
    no_birth: false,
    epoch_gone: false,
    fresh: null,
  };
  if (ledger === null || ledger === undefined) {
    proof.reason = "there is no ledger";
    return proof;
  }
  proof.close_seen = ledger.closeSeen === true;
  proof.exit_seen = ledger.exitSeen === true;
  // The close of a child carries the code of its exit: it is a fact of the
  // exit, and it is what a real ChildProcess reports.
  proof.exit_fact = proof.exit_seen
    || (ledger.close !== null && (ledger.close.code !== null || ledger.close.signal !== null));
  proof.no_birth = ledger.pid === null && ledger.errorSeen === true;
  if (!proof.close_seen) {
    proof.reason = "the close of the child was not seen";
    return proof;
  }
  if (!proof.exit_fact && !proof.no_birth) {
    proof.reason = "the exit of the child was not seen";
    return proof;
  }
  if (ledger.pid === null) {
    // There was never a child: there is nothing that could still be there.
    proof.epoch_gone = true;
  } else {
    const fresh = deps.readProcIdentity(ledger.pid);
    proof.fresh = fresh;
    if (fresh.presence === "gone") {
      proof.epoch_gone = true;
    } else if (fresh.presence === "unknown") {
      proof.reason = "the end of the child could not be confirmed";
      return proof;
    } else if (originalEpochIsGone(ledger.epoch, fresh)) {
      // The number was reused by another process: the ORIGINAL epoch is gone.
      proof.epoch_gone = true;
    } else {
      proof.reason = "the child closed but its process is still there";
      return proof;
    }
  }
  proof.complete = true;
  proof.kind = proof.no_birth && ledger.pid === null ? "no-child-confirmed" : "closed";
  return proof;
}

/**
 * The TAGGED result of a cleanup.
 *
 * `closed`            the child really closed and its original epoch is gone;
 * `no-child-confirmed` there was never a child, the error is recorded and the
 *                     close really arrived;
 * `unknown`           nothing was proven. The owner, the close promise, the
 *                     root and the events are all KEPT.
 */
export async function finalizeClosed(ledger, deps, kind) {
  const proof = checkTerminalProof(ledger, deps);
  if (!proof.complete) {
    return { kind: "unknown", reason: proof.reason };
  }
  return {
    kind,
    code: ledger.close === null ? null : ledger.close.code,
    signal: ledger.close === null ? null : ledger.close.signal,
    proof: {
      exit_fact: proof.exit_fact,
      no_birth: proof.no_birth,
      epoch_gone: proof.epoch_gone,
    },
  };
}

/**
 * End the child, and answer with a TAGGED result.
 *
 * The ladder is TERM, then KILL, and it is only allowed HERE: this tool never
 * authorized a fork, so the custodian it started has nothing to reap. The
 * ledger refuses to signal when the never-fork invariant is not in place.
 *
 * A repeated cleanup SHARES this promise: it never signals twice and it never
 * counts the end twice.
 */
export function cleanupChild(ledger, deps, limits = PILOT_LIMITS) {
  if (ledger.cleanupPromise !== null) return ledger.cleanupPromise;
  ledger.cleanupStarted = true;
  if (ledger.closeSeen) ledger.closeBeforeCleanup = true;
  ledger.cleanupPromise = (async () => {
    // The invariant comes FIRST: without it, this tool has no right to end
    // anything.
    if (ledger.noAuthorizeWrites !== true) {
      return { kind: "unknown", reason: "the never-fork invariant was lost: no signal was sent" };
    }
    // There was never a child: the spawn failed. The error is recorded, and
    // the REAL close is still waited for. It is NOT the end of a child, and it
    // is NOT the error alone.
    if (ledger.pid === null) {
      if (!ledger.errorSeen) {
        return {
          kind: "unknown",
          reason: "there was no child and no error: the start of it was not understood",
        };
      }
      if (!ledger.closeSeen) {
        const closed = await waitForClose(ledger, deps, limits.closeWithoutChildMs);
        if (!closed) {
          return { kind: "unknown", reason: "the spawn failed and the child never closed" };
        }
      }
      return await finalizeClosed(ledger, deps, "no-child-confirmed");
    }
    // A close that was already seen IS the end.
    if (ledger.closeSeen) return await finalizeClosed(ledger, deps, "closed");
    // The exit was seen but the streams are not closed: only WAIT for the close,
    // and never signal a process that already ended.
    if (ledger.exitSeen) {
      const closed = await waitForClose(ledger, deps, limits.closeAfterExitMs);
      if (!closed) {
        return { kind: "unknown", reason: "the child exited and its streams never closed" };
      }
      return await finalizeClosed(ledger, deps, "closed");
    }
    for (const step of [
      { signal: "SIGTERM", graceMs: limits.termGraceMs },
      { signal: "SIGKILL", graceMs: limits.killConfirmMs },
    ]) {
      // The check and the signal are NOT separated by an await.
      const verdict = verifyOwnedLiveChild(ledger, deps);
      if (verdict.ok !== true) {
        if (verdict.reason === "the process is gone") {
          const closed = await waitForClose(ledger, deps, limits.closeAfterExitMs);
          if (closed) return await finalizeClosed(ledger, deps, "closed");
        }
        return { kind: "unknown", reason: verdict.reason };
      }
      let delivered;
      try {
        delivered = ledger.child.kill(step.signal);
      } catch (error) {
        return {
          kind: "unknown",
          reason: `the signal ${step.signal} could not be delivered: ${boundedError(error).message}`,
        };
      }
      ledger.signalsSent.push({ signal: step.signal, delivered: delivered !== false });
      if (delivered === false) {
        return { kind: "unknown", reason: `the signal ${step.signal} was refused` };
      }
      const closed = await waitForClose(ledger, deps, step.graceMs);
      if (closed) return await finalizeClosed(ledger, deps, "closed");
    }
    return { kind: "unknown", reason: "the child did not really close" };
  })();
  return ledger.cleanupPromise;
}

/**
 * The arguments of the pilot.
 *
 * There are EXACTLY two modes and exactly one option, and anything else is
 * REFUSED. There is no way to name an executable, an argument vector, a
 * script, a signal or a process number.
 */
export function parsePilotArguments(argv) {
  const options = { mode: null, expectedCustodianSha256: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--mode") {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !PILOT_MODES.includes(value)) {
        throw new PilotFailure("BAD_MODE", `the mode must be one of ${PILOT_MODES.join(", ")}`);
      }
      options.mode = value;
      continue;
    }
    if (argument === "--expected-custodian-sha256") {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !/^[0-9a-f]{64}$/u.test(value)) {
        throw new PilotFailure("BAD_SHA256", "the expected digest of the custodian must be 64 hexadecimal digits");
      }
      options.expectedCustodianSha256 = value;
      continue;
    }
    throw new PilotFailure("BAD_ARGUMENT", `the argument ${String(argument)} is not one this pilot takes`);
  }
  if (options.mode === null) {
    throw new PilotFailure("NO_MODE", `this pilot needs a --mode of ${PILOT_MODES.join(" or ")}`);
  }
  if (options.expectedCustodianSha256 === null) {
    throw new PilotFailure("NO_SHA256", "this pilot needs the --expected-custodian-sha256 of the reviewed custodian");
  }
  return options;
}

/** The digest of a file, or null when it could not be read. */
export function sha256OfFile(path, readFile = readFileSync) {
  try {
    return createHash("sha256").update(readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * The environment of the custodian.
 *
 * It is a FIXED allowlist: not one name of it comes from the environment of the
 * user, and the HOME, the XDG directories and the temporary directory are the
 * PRIVATE ones of this run. NODE_OPTIONS and PYTHONPATH are not in it.
 */
export function privateEnvironment(root) {
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    TMP: join(root, "tmp"),
    TEMP: join(root, "tmp"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_RUNTIME_DIR: join(root, "runtime"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  };
}

/**
 * The REPORTING BOUNDARY of the standalone tool.
 *
 * A broken destination is an ordinary I/O failure, and it must NEVER take the
 * owner away. Two routes can report it and BOTH of them are handled:
 *
 *   1. the ERROR EVENT of the destination - it is listened to BEFORE
 *      anything is started, and the listener is NEVER removed while the
 *      owner is alive. An unhandled 'error' event would terminate the
 *      process and strand a detached child that is still waiting;
 *   2. the COMPLETION of a write - the callback of the write carries the
 *      error of that write.
 *
 * The SAME failure may arrive by both routes: it is counted ONCE. The failure
 * is kept as a bounded fact, the destination is not written to again (there is
 * no unbounded retry and no recursive report of a reporting failure), and the
 * owner keeps waiting for its own terminal proof.
 */
export function createReportingBoundary({ stream = null, write = null } = {}) {
  const state = {
    failures: [],
    firstFailure: null,
    pending: 0,
    broken: false,
    seen: new Set(),
    waiters: [],
  };

  const noteFailure = (error, route) => {
    const bounded = boundedError(error);
    // The SAME failure is counted ONCE, even when it arrives by both routes.
    const key = error === null || error === undefined
      ? `${route}|${bounded.code ?? ""}|${bounded.message}`
      : error;
    if (state.seen.has(key)) return false;
    state.seen.add(key);
    state.failures.push({ route, error: bounded });
    while (state.failures.length > 8) state.failures.shift();
    if (state.firstFailure === null) state.firstFailure = { route, error: bounded };
    // The destination is not trustworthy any more: it is not written to again.
    state.broken = true;
    return true;
  };

  // The listener of the ERROR EVENT is installed HERE - before anything is
  // started - and it is never removed: the owner is alive as long as the tool
  // is.
  if (stream !== null && stream !== undefined && typeof stream.on === "function") {
    stream.on("error", (error) => {
      noteFailure(error, "stream-error");
    });
  }

  const settle = () => {
    if (state.pending > 0) return;
    const waiters = state.waiters.splice(0, state.waiters.length);
    for (const waiter of waiters) waiter();
  };

  const report = (text) => {
    if (typeof write !== "function") return false;
    if (state.broken) {
      // The destination is broken: the write is NOT retried, and the fact is
      // kept in memory.
      return false;
    }
    const usesCallback = write.length >= 2;
    if (usesCallback) state.pending += 1;
    let settled = !usesCallback;
    try {
      write(text, (error) => {
        if (!settled) {
          settled = true;
          state.pending -= 1;
        }
        if (error !== null && error !== undefined) noteFailure(error, "write-callback");
        settle();
      });
    } catch (error) {
      // A SYNCHRONOUS throw of the write is a failure too, and it is kept.
      if (!settled) {
        settled = true;
        state.pending -= 1;
      }
      noteFailure(error, "write-throw");
    }
    settle();
    return true;
  };

  const settled = () => new Promise((resolveSettled) => {
    if (state.pending === 0) {
      resolveSettled();
      return;
    }
    state.waiters.push(resolveSettled);
  });

  return {
    report,
    settled,
    get firstFailure() {
      return state.firstFailure;
    },
    get failures() {
      return state.failures.slice();
    },
    get pending() {
      return state.pending;
    },
    get broken() {
      return state.broken;
    },
  };
}

/** The real boundaries of the pilot. Every one of them may be replaced. */
export const REAL_DEPENDENCIES = {
  cwd: () => process.cwd(),
  pid: () => process.pid,
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  }),
  spawnChild: (argv, options) => spawn(argv[0], argv.slice(1), options),
  readProcIdentity: (pid) => readProcIdentity(pid),
  sha256OfFile: (path) => sha256OfFile(path),
  createRoot: (repositoryRoot) => {
    const base = join(repositoryRoot, PILOT_ROOT_RELATIVE_PATH);
    mkdirSync(base, { recursive: true });
    const root = mkdtempSync(join(base, "run-"));
    for (const name of ["home", "cache", "config", "data", "runtime", "tmp"]) {
      mkdirSync(join(root, name), { recursive: true, mode: 0o700 });
    }
    return root;
  },
  writeEvidence: (root, name, data) => {
    writeFileSync(join(root, name), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  },
  /**
   * The destination of the reports of the tool. It is the standard error of
   * the process, and it is only LISTENED to when main() really runs: the
   * import of this file never touches it.
   */
  reportStream: process.stderr,
  /** The write route of the reporting boundary. */
  writeStderr: (text, callback) => {
    process.stderr.write(text, callback);
  },
};

/**
 * Run ONE pilot.
 *
 * The order is fixed and it is not permuted:
 *
 *   1. the working directory is checked;
 *   2. the OWNED root is created and REGISTERED - before anything else happens;
 *   3. the read-only checks run and their evidence lands in the root;
 *   4. the custodian is started, and its ledger is registered at once;
 *   5. its identity is read and checked against the kernel;
 *   6. the mode runs - the `assertion-failure` mode throws on purpose;
 *   7. the cleanup runs in a finally, and it answers with a TAGGED result.
 */
export async function runPilot(options, deps = REAL_DEPENDENCIES) {
  const repositoryRoot = REPOSITORY_ROOT;
  const assertions = [];
  const evidenceErrors = [];
  const record = (name, ok, detail) => {
    assertions.push({ name, ok: ok === true, detail: detail ?? null });
    return ok === true;
  };

  const cwd = deps.cwd();
  if (!record("the-working-directory-is-the-root", cwd === repositoryRoot, `${cwd}`)) {
    return {
      kind: "refused",
      reason: "the working directory is not the root of the repository",
      mode: options.mode,
      root: null,
      ledger: null,
      cleanup: null,
      hello: null,
      error: null,
      evidence_errors: evidenceErrors,
      assertions,
    };
  }

  // The owned root is created and REGISTERED before anything else happens: from
  // this moment on there is an owner for everything this run touches.
  let root = null;
  try {
    root = deps.createRoot(repositoryRoot);
  } catch (error) {
    // NOTHING was started: there is no child and no root to own.
    return {
      kind: "refused",
      reason: `the owned root could not be created: ${boundedError(error).message}`,
      mode: options.mode,
      root: null,
      ledger: null,
      cleanup: null,
      hello: null,
      error: boundedError(error),
      evidence_errors: evidenceErrors,
      assertions,
    };
  }

  /**
   * EVERY evidence write is non-throwing.
   *
   * A failure of the filesystem is KEPT as a bounded fact and it disqualifies
   * the case, but it NEVER takes the owner away: the root, the child and the
   * close promise stay exactly where they are.
   */
  const writeEvidence = (name, data) => {
    try {
      deps.writeEvidence(root, name, data);
      return null;
    } catch (error) {
      const bounded = boundedError(error);
      evidenceErrors.push({ name, error: bounded });
      return bounded;
    }
  };

  const custodianPath = join(repositoryRoot, CUSTODIAN_RELATIVE_PATH);

  const custodianDigest = deps.sha256OfFile(custodianPath);
  const pythonDigest = deps.sha256OfFile(PYTHON_PATH);
  const preflightError = writeEvidence("preflight.json", {
    root,
    cwd,
    mode: options.mode,
    custodian_path: custodianPath,
    custodian_sha256: custodianDigest,
    expected_custodian_sha256: options.expectedCustodianSha256,
    python_path: PYTHON_PATH,
    python_sha256: pythonDigest,
    expected_python_sha256: PYTHON_SHA256,
  });
  if (preflightError !== null) {
    // The evidence of this run is broken and NOTHING was started yet: refusing
    // is honest, and no owner is lost.
    record("the-preflight-evidence-was-written", false, preflightError.message);
    return {
      kind: "refused",
      reason: "the preflight evidence could not be written: nothing was started",
      mode: options.mode,
      root,
      ledger: null,
      cleanup: null,
      hello: null,
      error: preflightError,
      evidence_errors: evidenceErrors,
      assertions,
    };
  }
  const custodianOk = record(
    "the-custodian-is-the-reviewed-one",
    custodianDigest !== null && custodianDigest === options.expectedCustodianSha256,
    custodianDigest,
  );
  const pythonOk = record(
    "the-interpreter-is-the-fixed-one",
    pythonDigest !== null && pythonDigest === PYTHON_SHA256,
    pythonDigest,
  );
  if (!custodianOk || !pythonOk) {
    return {
      kind: "refused",
      reason: "the custodian or the interpreter is not the reviewed one: nothing was started",
      mode: options.mode,
      root,
      ledger: null,
      cleanup: null,
      hello: null,
      error: null,
      evidence_errors: evidenceErrors,
      assertions,
    };
  }

  const env = privateEnvironment(root);
  let ledger = null;
  let hello = null;
  let primary = null;
  let cleanup = null;
  try {
    const child = deps.spawnChild([PYTHON_PATH, "-I", "-S", "-B", custodianPath], {
      cwd: repositoryRoot,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    });
    // The ledger is registered AT ONCE: the listeners are on the child before
    // anything waits, and the close promise is ONE shared promise.
    ledger = createChildLedger({
      child,
      stdout: child === null ? null : child.stdout,
      stderr: child === null ? null : child.stderr,
      control: child === null ? null : child.stdio[4],
    });
    // The epoch of the child, read from the kernel right after the start.
    // A child WITHOUT a number has NO epoch: nothing is dereferenced here, and
    // the facts of the start - the error and the close - are what is waited
    // for.
    const epoch = ledger.pid === null ? null : deps.readProcIdentity(ledger.pid);
    ledger.epoch = epoch === null ? null : (epoch.presence === "known" ? epoch.identity : null);
    record(
      "the-epoch-of-the-custodian-was-read",
      ledger.epoch !== null,
      epoch === null ? "the child has no number" : (epoch.reason ?? null),
    );

    // The identity of the custodian, with the total bound of the hello.
    const deadline = deps.now() + PILOT_LIMITS.helloTimeoutMs;
    let helloFailure = null;
    while (hello === null && helloFailure === null) {
      const frame = takeControlFrame(ledger);
      if (frame !== undefined) {
        if (frame === null) {
          helloFailure = new PilotFailure("CONTROL_DECODER_FAILED", "the control channel could not be decoded");
          break;
        }
        try {
          hello = parseCustodianHello(frame);
        } catch (error) {
          helloFailure = error;
        }
        continue;
      }
      if (ledger.closeSeen) {
        helloFailure = new PilotFailure("CUSTODIAN_CLOSED", "the custodian closed before it stated its identity");
        break;
      }
      if (ledger.errorSeen) {
        helloFailure = new PilotFailure("CUSTODIAN_ERROR", "the custodian failed before it stated its identity");
        break;
      }
      if (deps.now() >= deadline) {
        helloFailure = new PilotFailure("HELLO_TIMEOUT", "the custodian did not state its identity in time");
        break;
      }
      await deps.sleep(20);
    }
    record("the-custodian-stated-its-identity", hello !== null, helloFailure === null ? null : helloFailure.code);

    if (hello === null) {
      // The REAL failure of the start wins over the generic one: an ENOENT or
      // an EAGAIN of the spawn is the error that really happened, and it is
      // never covered by a TypeError of this file.
      let failure = helloFailure ?? new PilotFailure("NO_HELLO", "the custodian never stated its identity");
      if (ledger.pid === null && ledger.firstError !== null) {
        // There was NEVER a child: the error of the start is the failure.
        failure = ledger.firstError;
      } else if (failure.code === "CUSTODIAN_ERROR" && ledger.firstError !== null) {
        // The custodian failed before it stated its identity: the REAL error
        // is the failure, and not the generic name of it.
        failure = ledger.firstError;
      }
      throw failure;
    }
    const fresh = ledger.pid === null ? null : deps.readProcIdentity(ledger.pid);
    const verdict = verifyCustodianIdentity(hello, {
      spawnedPid: ledger.pid,
      toolPid: deps.pid(),
      fresh,
      recordedEpoch: ledger.epoch,
    });
    record("the-custodian-is-the-process-it-says", verdict.ok, verdict.reason);
    if (!verdict.ok) {
      throw new PilotFailure("IDENTITY_MISMATCH", verdict.reason ?? "the custodian is not the process it says it is");
    }
    if (options.mode === "assertion-failure") {
      // The DELIBERATE failure, after a legal hello and a proven epoch. The
      // finally still cleans up, and only the REAL observation of this error,
      // together with a real close and a gone epoch, may mark the case passed.
      throw new PilotFailure(EXPECTED_ASSERTION_FAILURE, "the deliberate assertion failure of the nofork pilot");
    }
  } catch (error) {
    primary = error;
  } finally {
    if (ledger !== null) {
      try {
        cleanup = await cleanupChild(ledger, deps);
      } catch (error) {
        // The cleanup itself failed: the owner is KEPT, and the failure is
        // reported as an unknown cleanup. It never becomes an end.
        cleanup = { kind: "unknown", reason: `the cleanup failed: ${boundedError(error).message}` };
      }
    }
  }

  const faultExpected = options.mode === "assertion-failure";
  const faultObserved = faultExpected
    && primary instanceof PilotFailure
    && primary.code === EXPECTED_ASSERTION_FAILURE;
  // The COMPLETE terminal proof: the close, the exit (or the proof that there
  // was never a child) and the fresh proof that the ORIGINAL epoch is gone.
  const proof = ledger !== null
    ? checkTerminalProof(ledger, deps)
    : {
      complete: false,
      kind: "unknown",
      reason: "there was no child",
      close_seen: false,
      exit_seen: false,
      exit_fact: false,
      no_birth: false,
      epoch_gone: false,
      fresh: null,
    };
  const epochGone = proof.epoch_gone === true;
  // The FIRST UNEXPECTED failure of the ledger. A known failure is a
  // disqualification: it never hides behind a legal HELLO.
  const unexpected = ledger !== null ? ledger.firstFailure : null;
  const terminalProved = proof.complete === true && cleanup !== null && cleanup.kind === "closed";
  const faultCasePassed = faultObserved && unexpected === null && terminalProved;
  const identityProved = primary === null && unexpected === null && terminalProved;
  record("the-deliberate-failure-was-observed", faultCasePassed || !faultExpected, faultObserved);

  const outcome = {
    kind: primary === null
      ? (identityProved ? "ok" : "failed")
      : (faultCasePassed ? "fault-observed" : "failed"),
    mode: options.mode,
    root,
    ledger,
    cleanup,
    hello,
    error: primary === null ? null : boundedError(primary),
    fault_expected: faultExpected,
    fault_observed: faultObserved,
    fault_case_passed: faultCasePassed,
    identity_proved: identityProved,
    epoch_gone: epochGone,
    terminal_proof: proof,
    unexpected_failure: unexpected,
    failure_log: ledger === null ? [] : ledger.failureLog.slice(),
    evidence_errors: evidenceErrors,
    evidence_published: true,
    assertions,
  };
  const outcomeError = writeEvidence("outcome.json", {
    kind: outcome.kind,
    mode: outcome.mode,
    cleanup,
    error: outcome.error,
    fault_expected: outcome.fault_expected,
    fault_observed: outcome.fault_observed,
    fault_case_passed: outcome.fault_case_passed,
    identity_proved: outcome.identity_proved,
    epoch_gone: outcome.epoch_gone,
    terminal_proof: proof,
    unexpected_failure: unexpected,
    failure_log: outcome.failure_log,
    assertions,
    signals: ledger === null ? [] : ledger.signalsSent,
    exit: ledger === null ? null : ledger.exit,
    close: ledger === null ? null : ledger.close,
    diagnostics: ledger === null ? null : {
      stdout_bytes: ledger.stdoutBytes,
      stderr_bytes: ledger.stderrBytes,
      stdout_ended: ledger.stdoutEnded,
      stderr_ended: ledger.stderrEnded,
      control_ended: ledger.controlEnded,
      control_error: ledger.controlError,
      stdout_error: ledger.stdoutError,
      stderr_error: ledger.stderrError,
      diagnostics_lost: ledger.diagnosticsLost,
      frame_queue_bytes: ledger.frameQueueBytes,
      frame_queue_overflow: ledger.frameQueueOverflow,
      error: ledger.error,
    },
  });
  if (outcomeError !== null) {
    // The evidence of the outcome could not be written. The AUTHORITATIVE
    // result is REGENERATED: every pass marker is cleared, the original
    // failure and the proof of the cleanup are KEPT, and the error of the
    // write is an unexpected failure of the case. A file that a failed write
    // left behind is a CANDIDATE, never a committed receipt.
    outcome.kind = "failed";
    outcome.identity_proved = false;
    outcome.fault_case_passed = false;
    outcome.evidence_published = false;
    outcome.failure_log = [...outcome.failure_log, { source: "evidence-write", error: outcomeError }];
    if (outcome.unexpected_failure === null) {
      outcome.unexpected_failure = { source: "evidence-write", error: outcomeError };
    }
  }
  return outcome;
}

/**
 * The command of the pilot.
 *
 * On an UNKNOWN cleanup the program does NOT leave: it keeps the responsibility
 * and waits for the REAL close, and it writes ONE structured record that says
 * where the owner is. A deadline is never an end, and a timer race that returns
 * normally would leave an owner behind without saying so.
 */
export async function main(argv, deps = REAL_DEPENDENCIES) {
  // The REPORTING BOUNDARY is installed BEFORE anything is started: the
  // listener of the destination and the completion of every write are
  // handled, so a broken destination can never end the owner and can never
  // terminate the process with an unhandled error event.
  const reporting = createReportingBoundary({
    stream: deps.reportStream ?? null,
    write: typeof deps.writeStderr === "function" ? deps.writeStderr : null,
  });
  const report = (text) => {
    reporting.report(text);
  };

  let options;
  try {
    options = parsePilotArguments(argv);
  } catch (error) {
    report(`${JSON.stringify({ kind: "REFUSED", reason: boundedError(error).message })}\n`);
    await reporting.settled();
    return 2;
  }
  let outcome;
  try {
    outcome = await runPilot(options, deps);
  } catch (error) {
    // The pilot failed before there was a child: there is no owner to keep.
    report(`${JSON.stringify({ kind: "REFUSED", reason: boundedError(error).message })}\n`);
    await reporting.settled();
    return 2;
  }
  if (outcome.cleanup !== null && outcome.cleanup.kind === "unknown" && outcome.ledger !== null) {
    // ONE structured HELD record: MAIN can find the owner with it.
    const held = {
      kind: "HELD",
      mode: outcome.mode,
      root: outcome.root,
      pid: outcome.ledger.pid,
      reason: outcome.cleanup.reason,
      cleanup: outcome.cleanup,
      signals: outcome.ledger.signalsSent,
      exit: outcome.ledger.exit,
      close: outcome.ledger.close,
      error: outcome.ledger.error,
      stdout_bytes: outcome.ledger.stdoutBytes,
      stderr_bytes: outcome.ledger.stderrBytes,
    };
    // The held record is written WITHOUT throwing: a failure of the
    // filesystem is kept as a fact, and the owner stays exactly where it is.
    const evidenceErrors = Array.isArray(outcome.evidence_errors) ? outcome.evidence_errors : [];
    try {
      deps.writeEvidence(outcome.root, "held.json", held);
    } catch (error) {
      evidenceErrors.push({ name: "held.json", error: boundedError(error) });
    }
    // The report of the owner goes through the boundary: a destination that
    // breaks does NOT end the owner, and the failure is kept.
    report(`${JSON.stringify(held)}\n`);
    // The responsibility stays HERE.
    //
    // The close ALONE is NOT the end of the owner: the COMPLETE proof is
    // needed - the close, the exit (or the proof that there was never a
    // child) and the FRESH proof that the ORIGINAL epoch is gone. The owner
    // waits with a bounded poll that never signals the child again, and it
    // never expires: an unknown keeps the responsibility.
    try {
      for (;;) {
        await waitForClose(outcome.ledger, deps, PILOT_LIMITS.heldPollMs);
        const proof = checkTerminalProof(outcome.ledger, deps);
        if (proof.complete) {
          // Every report that is still PENDING is awaited here: an error that
          // arrives on a LATER turn is part of the result, and it is never
          // lost behind a success.
          await deps.sleep(0);
          await reporting.settled();
          try {
            deps.writeEvidence(outcome.root, "final.json", {
              kind: "closed-after-held",
              held,
              proof,
              evidence_errors: evidenceErrors,
              reporting_failure: reporting.firstFailure,
              reporting_failures: reporting.failures,
            });
          } catch (error) {
            evidenceErrors.push({ name: "final.json", error: boundedError(error) });
          }
          return 1;
        }
        await deps.sleep(PILOT_LIMITS.heldPollIntervalMs);
      }
    } catch (error) {
      // The wait itself failed: the owner is reported as held, with the fact.
      try {
        deps.writeEvidence(outcome.root, "final.json", {
          kind: "held-after-held-error",
          held,
          error: boundedError(error),
          evidence_errors: evidenceErrors,
          reporting_failure: reporting.firstFailure,
        });
      } catch {
        // Nothing more can be written.
      }
      return 1;
    }
  }
  // The same rule outside the HELD branch: a report that is still pending is
  // awaited, and a failure of the reporting is a FAILURE of the case. The
  // owner of a case that is already terminal is not at risk here, but the
  // result may never be green while a report of it failed.
  await deps.sleep(0);
  await reporting.settled();
  if (reporting.firstFailure !== null) {
    outcome.kind = "failed";
    outcome.identity_proved = false;
    outcome.fault_case_passed = false;
    outcome.reporting_failure = reporting.firstFailure;
    outcome.reporting_failures = reporting.failures;
    // The best effort evidence of the failure of the reporting: the file may
    // not be writable, and then the fact stays in memory only.
    try {
      deps.writeEvidence(outcome.root, "reporting.json", {
        kind: "reporting-failed",
        mode: outcome.mode,
        reporting_failure: reporting.firstFailure,
        reporting_failures: reporting.failures,
        evidence_errors: outcome.evidence_errors,
      });
    } catch (error) {
      outcome.evidence_errors.push({ name: "reporting.json", error: boundedError(error) });
    }
  }
  if (outcome.kind === "ok") return 0;
  return 1;
}

/** Whether this file is the entry point of the run. */
export function isEntryPoint(argv1 = process.argv[1]) {
  if (argv1 === undefined) return false;
  try {
    return resolve(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2));
}
