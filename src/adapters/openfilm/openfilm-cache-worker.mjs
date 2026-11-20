import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";
import { register } from "node:module";
import { installCacheWorkerPolicy, sealCacheWorkerBirth, cacheWorkerObservedProcesses }
  from "./cache-worker-policy.mjs";

/**
 * The worker of ONE native cache draw.
 *
 * The pinned upstream draws a page's picture in a headless browser it keeps for the
 * whole process. That browser is shared: one slow draw, one abandoned page or one
 * browser that never came back keeps the next draw waiting, and nothing the Host
 * can observe says whether the work behind a picture really ended.
 *
 * So the draw does not happen in the Host. It happens HERE, in a process of its own
 * that a custodian OUTSIDE the draw's process group watches:
 *
 *  - the custodian gives this worker its own session and its own group, so the
 *    browser it starts later inherits that group and the custodian can end the
 *    whole group;
 *  - this worker states its own identity FIRST - its real pid, its start time,
 *    its parent, its group and its session - and the Host checks every field
 *    against the kernel before anything is asked of it;
 *  - the ticket of the draw travels over the private socket this worker
 *    inherited as its file descriptor 3, and nowhere else: not in the argument
 *    vector, not in the environment, not in a URL and not in a log;
 *  - this worker checks the bytes of everything it is about to run - itself, the
 *    worker-local policy, the reused media policy, the reused offline guard and
 *    the pinned upstream module - BEFORE it loads any of them;
 *  - the worker-local policy is installed before the upstream is loaded, so the
 *    browser that is started later is already inside the group of this worker;
 *  - the pinned producer is asked for ONE picture, exactly once;
 *  - the picture is a CANDIDATE. It is not a settlement and it is not an
 *    authority: the custodian still has to see the whole process domain of this
 *    worker disappear.
 */

/** The private socket the Host and this worker speak over. It is inherited. */
const CHANNEL_FD = 3;

/** The protocol of revision 3. */
const PROTOCOL = "narralens.openfilm-cache-process@3";

/** The frame header is a four byte length, and it is checked before the payload. */
const FRAME_HEADER = 4;
/** The biggest metadata frame. */
const MAX_METADATA_BYTES = 16 * 1024;
/** The biggest request frame. */
const MAX_REQUEST_BYTES = 64 * 1024;
/** The biggest picture frame. */
const MAX_JPEG_BYTES = 8 * 1024 * 1024;
/** The unconsumed bytes of the channel never exceed this. */
const MAX_BUFFER_BYTES = MAX_JPEG_BYTES + FRAME_HEADER;

/** The repository root: this file lives in src/adapters/openfilm. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** The manifest of the bytes this worker is allowed to run. */
const MANIFEST_URL = new URL("./cache-worker-integrity.json", import.meta.url);
/** The loader hooks of the formal render's offline guard. Their bytes are reused as they are. */
const GUARD_HOOKS_URL = new URL("../../host/render/openfilm-offline-hooks.mjs", import.meta.url);
/** The guard itself. The hooks make the pinned module resolve to it. */
const GUARD_WRAPPER_URL = new URL("../../host/render/openfilm-offline-wrapper.mjs", import.meta.url);
/** The marker the guard uses to reach the original module. */
const GUARD_MARKER = "?narralens-original";
/** The marker the guard sets on the global object when it is in place. */
const GUARD_MARKER_NAME = "__narralensOfflineGuard";

/** The failure of the worker, as it is reported to the Host. */
class WorkerFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkerFailure";
    this.code = code;
  }
}

/** The digest of the bytes of a buffer or a string. */
const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The identity of this worker, read from the kernel.
 *
 * The layout of /proc/<pid>/stat is `pid (comm) state ppid pgrp session ...`. The
 * command name may hold spaces AND parentheses, so the fields after it are read
 * from the LAST closing parenthesis - and the PID is the number BEFORE the FIRST
 * opening one. The field right after the closing parenthesis is the STATE (S, R,
 * Z, ...): it is a state and never a number.
 */
function readProcessIdentity(pid) {
  let text;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const head = text.indexOf("(");
  const cut = text.lastIndexOf(")");
  if (head < 0 || cut < 0 || cut < head) return null;
  const pidText = text.slice(0, head).trim();
  if (!/^[0-9]+$/u.test(pidText)) return null;
  const fields = text.slice(cut + 1).trim().split(/\s+/u);
  if (fields.length < 20) return null;
  const state = fields[0];
  const numbers = [1, 2, 3, 19].map((index) => {
    const value = fields[index];
    if (value === undefined || !/^-?[0-9]+$/u.test(value)) return null;
    return Number(value);
  });
  const [ppid, pgid, sid, startTicks] = numbers;
  if (ppid === null || pgid === null || sid === null || startTicks === null) return null;
  return { pid: Number(pidText), ppid, pgid, sid, start_ticks: startTicks, state };
}

/**
 * The private channel to the Host.
 *
 * It is a socket this worker inherited; it is never named in the argument
 * vector, in the environment or in a URL. The frames are length-first: the
 * length is read and CHECKED before the payload is read, so a frame that claims
 * more than the limit is refused instead of being read into memory and
 * truncated afterwards.
 */
const channel = new net.Socket({ fd: CHANNEL_FD, readable: true, writable: true });
/** The bytes that were read but not consumed yet. */
let buffered = Buffer.alloc(0);
/** The waiters of a frame that is not complete yet. */
const frameWaiters = [];
/** The channel is closed: no more frames will arrive. */
let channelClosed = false;

channel.on("data", (chunk) => {
  buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
  // The bytes that wait to be consumed are BOUNDED, even when nobody is
  // waiting for them: a channel that nobody reads may not grow without a
  // limit.
  if (buffered.length > MAX_BUFFER_BYTES) {
    channel.destroy();
    throw new WorkerFailure("CHANNEL_OVERFLOW", "the unconsumed bytes of the channel exceed the limit");
  }
  pumpFrames();
});
channel.on("end", () => {
  channelClosed = true;
  pumpFrames();
});
channel.on("close", () => {
  channelClosed = true;
  pumpFrames();
});
channel.on("error", () => {
  channelClosed = true;
  pumpFrames();
});

/**
 * Hand the buffered bytes to the waiter that can use them.
 *
 * The length of a frame is read FIRST and checked before the payload is read: a
 * frame that claims more than the limit is refused, and the worker stops, instead
 * of reading a huge payload into memory and truncating it afterwards.
 */
function pumpFrames() {
  while (frameWaiters.length > 0) {
    const waiter = frameWaiters[0];
    if (buffered.length < 4) {
      if (channelClosed) {
        frameWaiters.shift();
        waiter.resolve(null);
      }
      return;
    }
    const length = buffered.readUInt32BE(0);
    if (length + FRAME_HEADER > MAX_BUFFER_BYTES) {
      frameWaiters.shift();
      waiter.reject(new WorkerFailure("FRAME_TOO_LARGE", "a frame of the private channel is too large"));
      continue;
    }
    if (buffered.length < FRAME_HEADER + length) {
      if (channelClosed) {
        frameWaiters.shift();
        waiter.reject(new WorkerFailure("FRAME_TRUNCATED", "a frame of the private channel ended early"));
      }
      return;
    }
    const payload = buffered.subarray(FRAME_HEADER, FRAME_HEADER + length);
    buffered = buffered.subarray(FRAME_HEADER + length);
    frameWaiters.shift();
    waiter.resolve(payload);
  }
}

/** Read one frame, or null when the channel closed before it. */
function readFrame() {
  return new Promise((resolveFrame, rejectFrame) => {
    frameWaiters.push({ resolve: resolveFrame, reject: rejectFrame });
    pumpFrames();
  });
}

/** Write one frame: a four byte length and the payload. */
function writeFrame(payload) {
  if (payload.length > MAX_JPEG_BYTES) {
    throw new WorkerFailure("FRAME_TOO_LARGE", "a frame of the private channel is too large");
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  channel.write(Buffer.concat([header, payload]));
}

/** Write one JSON message. */
function writeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > MAX_METADATA_BYTES) {
    throw new WorkerFailure("MESSAGE_TOO_LARGE", "a message of the private channel is too large");
  }
  writeFrame(payload);
}

/** Flush what was written and close the channel. */
async function flushAndClose() {
  await new Promise((resolveClose) => {
    if (channel.destroyed || channel.writableEnded) { resolveClose(); return; }
    channel.end(() => resolveClose());
  });
  channel.destroy();
}

/** Read one JSON message, within the limit of the phase. */
async function readMessage(maxBytes) {
  const payload = await readFrame();
  if (payload === null) return null;
  if (payload.length > maxBytes) {
    throw new WorkerFailure("MESSAGE_TOO_LARGE", "a message of the private channel is too large");
  }
  let message;
  try {
    message = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new WorkerFailure("MESSAGE_MALFORMED", "a message of the private channel is not JSON");
  }
  if (message === null || typeof message !== "object") {
    throw new WorkerFailure("MESSAGE_MALFORMED", "a message of the private channel is not an object");
  }
  return message;
}

/**
 * The bounded structure of an original failure.
 *
 * It keeps the name, the code, the message, the stack, the cause and the phase,
 * and it cuts every text to a bound. It is a TRANSPORT FACT and not the original
 * object: the very same JavaScript object did not survive the process boundary,
 * and this does not pretend that it did.
 */
function nativeEnvelope(error, phase) {
  const cut = (value, bound) => {
    if (typeof value !== "string") return null;
    return value.length > bound ? value.slice(0, bound) : value;
  };
  const cause = error?.cause;
  return {
    name: cut(error?.name, 256) ?? "Error",
    code: cut(error?.code, 256),
    message: cut(error?.message, 4096) ?? "",
    stack: cut(error?.stack, 8192),
    cause: cause === undefined || cause === null ? null : nativeEnvelope(cause, phase),
    phase: typeof phase === "string" ? phase.slice(0, 64) : null,
  };
}

/**
 * Check the bytes of everything this worker is about to run.
 *
 * The manifest names the files of THIS repository that take part in the draw, and
 * the pinned upstream module. The repository files are checked against the manifest
 * as it is on disk; the upstream file is checked against the pinned digest that the
 * canonical upstream lock records, never against a copy of the tree.
 */
async function verifyIntegrity(upstreamRoot, producerFile) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_URL, "utf8"));
  } catch (error) {
    throw new WorkerFailure("INTEGRITY_MANIFEST_UNREADABLE",
      `the cache worker integrity manifest could not be read: ${String(error?.message ?? error)}`);
  }
  if (manifest?.kind !== "narralens.openfilm_cache_worker_integrity@1.0") {
    throw new WorkerFailure("INTEGRITY_MANIFEST_INVALID", "the cache worker integrity manifest is not the one this worker knows");
  }
  const hostModules = manifest.host_modules;
  if (hostModules === null || typeof hostModules !== "object") {
    throw new WorkerFailure("INTEGRITY_MANIFEST_INVALID", "the cache worker integrity manifest names no host module");
  }
  for (const [relative, expected] of Object.entries(hostModules)) {
    if (relative === "src/adapters/openfilm/cache-worker-integrity.json") {
      throw new WorkerFailure("INTEGRITY_MANIFEST_SELF_REFERENCE", "the cache worker integrity manifest names itself");
    }
    const path = resolve(REPOSITORY_ROOT, relative);
    if (!path.startsWith(REPOSITORY_ROOT + "/")) {
      throw new WorkerFailure("INTEGRITY_MODULE_OUTSIDE", "the cache worker integrity manifest names a module outside the repository");
    }
    let actual;
    try {
      actual = sha256Of(await readFile(path));
    } catch {
      throw new WorkerFailure("INTEGRITY_MODULE_MISSING", `the cache worker integrity module ${relative} is not there`);
    }
    if (actual !== expected) {
      throw new WorkerFailure("INTEGRITY_MODULE_MISMATCH", `the cache worker integrity module ${relative} is not the reviewed one`);
    }
  }
  const pinned = manifest.pinned_upstream;
  if (pinned === null || typeof pinned !== "object") {
    throw new WorkerFailure("INTEGRITY_MANIFEST_INVALID", "the cache worker integrity manifest names no pinned module");
  }
  for (const relative of [producerFile, "packages/openfilm/src/host.mjs"]) {
    const expected = pinned[relative];
    if (typeof expected !== "string") {
      throw new WorkerFailure("INTEGRITY_MANIFEST_INVALID", `the cache worker integrity manifest does not pin ${relative}`);
    }
    let actual;
    try {
      actual = sha256Of(await readFile(resolve(upstreamRoot, relative)));
    } catch {
      throw new WorkerFailure("INTEGRITY_UPSTREAM_MISSING", `the pinned upstream module ${relative} is not there`);
    }
    if (actual !== expected) {
      throw new WorkerFailure("INTEGRITY_UPSTREAM_MISMATCH", `the pinned upstream module ${relative} is not the pinned one`);
    }
  }
}

/** The main run of this worker. */
async function main() {
  // The identity of this worker, read from the kernel and not invented. It is
  // stated FIRST: the Host checks every field of it against the kernel before
  // this worker is asked to do anything.
  const identity = readProcessIdentity(process.pid);
  if (identity === null) {
    throw new WorkerFailure("IDENTITY_UNREADABLE", "the worker could not read its own identity");
  }
  writeMessage({
    kind: "N_HELLO",
    protocol: PROTOCOL,
    pid: identity.pid,
    ppid: identity.ppid,
    pgid: identity.pgid,
    sid: identity.sid,
    start_ticks: String(identity.start_ticks),
    state: identity.state,
  });

  // Nothing of the upstream is loaded before the Host says GO.
  const go = await readMessage(MAX_REQUEST_BYTES);
  if (go === null) {
    throw new WorkerFailure("CHANNEL_CLOSED", "the private channel closed before the draw was authorised");
  }
  if (go.kind !== "GO" || go.protocol !== PROTOCOL) {
    throw new WorkerFailure("PROTOCOL_UNEXPECTED", "the first message of the private channel was not the authorisation");
  }
  if (typeof go.ticket !== "string" || go.ticket.length === 0) {
    throw new WorkerFailure("PROTOCOL_UNEXPECTED", "the authorisation carried no ticket");
  }
  // The ticket is never written anywhere: not into a log, not into an error, not
  // into the answer. Only its digest travels back, so the Host can prove that the
  // answer belongs to the request it made.
  const ticketDigest = sha256Of(Buffer.from(go.ticket, "utf8"));
  const request = go.request;
  if (request === null || typeof request !== "object") {
    throw new WorkerFailure("PROTOCOL_UNEXPECTED", "the authorisation carried no request");
  }
  for (const field of ["root", "base", "rel"]) {
    if (typeof request[field] !== "string" || request[field].length === 0) {
      throw new WorkerFailure("PROTOCOL_UNEXPECTED", `the request of the draw names no ${field}`);
    }
  }
  const upstreamRoot = go.upstream_root;
  const producerFile = go.producer_file;
  if (typeof upstreamRoot !== "string" || typeof producerFile !== "string") {
    throw new WorkerFailure("PROTOCOL_UNEXPECTED", "the authorisation named no upstream");
  }

  // The bytes of everything this worker is about to run are checked FIRST.
  await verifyIntegrity(upstreamRoot, producerFile);

  // The worker-local policy is installed before the upstream is loaded, so the
  // browser that the upstream starts is already inside this worker's group.
  installCacheWorkerPolicy();

  // The offline guard of the formal render stands in front of the pinned module.
  // Its bytes are reused as they are: the hooks are registered for the pinned
  // `host.mjs`, and the guard itself is loaded instead of it.
  process.env.NARRALENS_OPENFILM_ROOT = upstreamRoot;
  const hostUrl = pathToFileURL(resolve(upstreamRoot, "packages/openfilm/src/host.mjs")).href;
  try {
    register(GUARD_HOOKS_URL, {
      data: { host_url: hostUrl, wrapper_url: GUARD_WRAPPER_URL.href, marker: GUARD_MARKER },
    });
  } catch (error) {
    throw new WorkerFailure("OFFLINE_GUARD_NOT_INSTALLED",
      `the offline guard could not be loaded: ${String(error?.message ?? error)}`);
  }

  let producer;
  try {
    producer = await import(pathToFileURL(resolve(upstreamRoot, producerFile)).href);
  } catch (error) {
    throw new WorkerFailure("UPSTREAM_IMPORT_FAILED",
      `the pinned upstream could not be loaded: ${String(error?.message ?? error)}`);
  }
  if (typeof producer.pageFrame !== "function" || typeof producer.closePageFrames !== "function") {
    throw new WorkerFailure("UPSTREAM_SEAM_MISSING", "the pinned upstream does not export the page frame seam");
  }
  // The guard has to be IN PLACE, not merely loaded.
  if (globalThis[GUARD_MARKER_NAME]?.installed !== true) {
    throw new WorkerFailure("OFFLINE_GUARD_NOT_INSTALLED", "the offline guard did not take effect in front of the producer");
  }

  // ONE real draw. Its result is a CANDIDATE: a picture, or the original error.
  let candidate = null;
  let failure = null;
  let failurePhase = "draw";
  try {
    candidate = await producer.pageFrame(
      request.root, request.base, request.rel, request.ms, request.width, request.overrides ?? null);
  } catch (error) {
    failure = error;
    failurePhase = String(error?.code ?? error?.name ?? "draw");
  }

  // The birth of new children is sealed as soon as the draw is over.
  sealCacheWorkerBirth();

  if (failure !== null) {
    // The original failure travels as it is - its name, its code, its message, its
    // stack, its cause and the phase it came from - bounded, and as a transport
    // fact and not as a claim that the object itself survived.
    writeMessage({
      kind: "result",
      ok: false,
      ticket_digest: ticketDigest,
      error: nativeEnvelope(failure, failurePhase),
    });
  } else {
    if (!Buffer.isBuffer(candidate)) {
      throw new WorkerFailure("CANDIDATE_MALFORMED", "the pinned producer did not return a picture");
    }
    if (candidate.length > MAX_JPEG_BYTES) {
      throw new WorkerFailure("CANDIDATE_TOO_LARGE", "the picture of the pinned producer is larger than the limit");
    }
    writeMessage({
      kind: "result",
      ok: true,
      ticket_digest: ticketDigest,
      bytes: candidate.length,
      sha256: sha256Of(candidate),
    });
    writeFrame(candidate);
  }

  // The browser this worker opened is closed as far as this worker can close it.
  // Whether it really closed is the custodian's question, not this worker's.
  let closed = false;
  let closeError = null;
  try {
    await producer.closePageFrames();
    closed = true;
  } catch (error) {
    closed = false;
    // The ORIGINAL failure is carried as a bounded envelope. A `closed:false`
    // without the reason is a fact that nobody can act on, and the Host has to
    // see WHY the browser of this draw did not really close.
    closeError = nativeEnvelope(error, "closePageFrames");
  }
  writeMessage({ kind: "closed", closed, error: closeError, observed: cacheWorkerObservedProcesses() });

  // The leader stays alive until the custodian says go: a worker that exits on
  // its own would leave the custodian without an anchor it can trust.
  //
  // The wait is bounded: a custodian that never answers must not leave this
  // worker alive for ever. When the bound passes, the worker leaves by itself -
  // it has closed everything it opened, and a leader that leaves is the graceful
  // end of the domain.
  const FINALIZE_WAIT_MS = 60_000;
  const expired = Symbol("the authorisation to finish did not arrive");
  const deadline = new Promise((resolveDeadline) => {
    const timer = setTimeout(() => resolveDeadline(expired), FINALIZE_WAIT_MS);
    timer.unref?.();
  });
  const finalize = await Promise.race([readMessage(MAX_METADATA_BYTES), deadline]);
  if (finalize === expired) {
    // The custodian never answered. The worker leaves by itself: the domain of
    // this draw is the leader, and the leader is going.
    return;
  }
  if (finalize === null || finalize.kind !== "FINALIZE") {
    throw new WorkerFailure("PROTOCOL_UNEXPECTED", "the private channel did not carry the authorisation to finish");
  }
}

try {
  await main();
  await flushAndClose();
  process.exit(0);
} catch (error) {
  try {
    writeMessage({
      kind: "fatal",
      error: nativeEnvelope(error, String(error?.code ?? "worker")),
    });
    await flushAndClose();
  } catch {
    // The channel is gone: there is nothing left to report on it.
  }
  process.exit(1);
}
