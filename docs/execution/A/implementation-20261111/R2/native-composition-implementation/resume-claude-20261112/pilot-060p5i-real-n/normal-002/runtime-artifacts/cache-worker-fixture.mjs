import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";

/**
 * The worker of the faults, as ONE file with SCENARIO MODES.
 *
 * Three workers that do the same thing differently would be three files to keep
 * in step for no reason, so this one file plays every part the pilot needs:
 *
 *   normal                the same shape as the real worker: state the identity,
 *                         wait for the authorisation, answer with a picture,
 *                         report the close and leave when the custodian says so.
 *   half-jpeg             state the answer of a picture and send HALF of it -
 *                         a frame that is TRUNCATED, and not a smaller picture.
 *   flood                 write on the standard output without end. The parent's
 *                         budget has to stop the draw.
 *   ignore-term           a real worker with a real grandchild that BOTH ignore
 *                         SIGTERM. The custodian has to take the group down the
 *                         hard way and to reap the grandchild it adopted.
 *   ignore-term-adopted   the same, but the LEADER leaves first: the grandchild
 *                         is adopted by the custodian afterwards, and it still
 *                         has to be killed and reaped.
 *   late-launch           start a child AFTER the draw, so that the child
 *                         outlives the execution domain of the draw unless the
 *                         domain is really ended.
 *   foreign-hello         state an identity that is not this worker's, so that
 *                         the parent has to refuse it.
 *   silent                state the identity and then never answer. The parent's
 *                         READY deadline has to end the draw as a failure.
 *
 * HOW THE SCENARIO IS CHOSEN, AND WHY IT IS CHOSEN SO EARLY
 *
 * The custodian starts a worker with a FIXED argument vector - the interpreter
 * and the worker itself - and it hands the worker a FIXED environment. A
 * scenario may therefore not be smuggled in through either of them: the pilot
 * would be testing a configuration that the production path never has.
 *
 * The scenario is therefore read from a FILE next to this one, and it is read
 * BEFORE the identity is stated. That matters: the `foreign-hello` scenario has
 * to state a FOREIGN identity, and a mode that was only known after the answer
 * of the Host came would state its own identity first - which is exactly what
 * the previous version of this file did, and why the foreign-hello case never
 * reached the boundary it was written for.
 *
 * The file is `cache-worker-fixture.scenario`: one line, the name of the mode.
 * The pilot writes it before the draw and removes it afterwards. It is a runtime
 * artefact of the pilot and not a file of the repository.
 *
 * The same directory holds `cache-worker-fixture.events`: the fixture appends one
 * JSON line per event to it, so that the pilot can see that a mode was really
 * REACHED before it failed. The pilot reads it and removes it afterwards.
 *
 * NOTHING here touches a media file, a browser or ffmpeg: the pilot is about
 * the process domain, and a fixture that drew a picture would prove something
 * else entirely.
 */

const CHANNEL_FD = 3;
const PROTOCOL = "narralens.openfilm-cache-process@3";
const FRAME_HEADER = 4;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_JPEG_BYTES = 8 * 1024 * 1024;
const MAX_BUFFER_BYTES = MAX_JPEG_BYTES + FRAME_HEADER;

/** The file that names the mode of this run. */
const SCENARIO_URL = new URL("./cache-worker-fixture.scenario", import.meta.url);
/** The file the events of this run are appended to. */
const EVENTS_URL = new URL("./cache-worker-fixture.events", import.meta.url);

const SCENARIOS = new Set([
  "normal", "half-jpeg", "flood", "ignore-term", "ignore-term-adopted",
  "late-launch", "foreign-hello", "silent",
]);

class WorkerFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkerFailure";
    this.code = code;
  }
}

/** The standard library, without pulling a module in for it. */
function fs() {
  const module = globalThis.process.getBuiltinModule
    ? globalThis.process.getBuiltinModule("node:fs")
    : null;
  if (module === null) throw new WorkerFailure("NO_FS", "the fixture could not read a file");
  return module;
}

/** The path of the events file, as the PATH of the file URL. */
function eventsPath() {
  const url = globalThis.process.getBuiltinModule
    ? globalThis.process.getBuiltinModule("node:url")
    : null;
  if (url === null) throw new WorkerFailure("NO_URL", "the fixture could not resolve its own paths");
  return url.fileURLToPath(EVENTS_URL);
}

/** The mode of this run, read BEFORE anything is stated. */
function readScenario() {
  try {
    const text = fs().readFileSync(SCENARIO_URL, "utf8").trim();
    return SCENARIOS.has(text) ? text : "normal";
  } catch {
    return "normal";
  }
}

/** One event of this run, for the pilot to read. */
function event(name, extra) {
  const record = { event: name, at: Date.now(), pid: process.pid, ...extra };
  try {
    fs().appendFileSync(EVENTS_URL, `${JSON.stringify(record)}\n`);
  } catch {
    // The event file is gone: the pilot reads what was written.
  }
}

const channel = new net.Socket({ fd: CHANNEL_FD, readable: true, writable: true });
let buffered = Buffer.alloc(0);
const frameWaiters = [];
let channelClosed = false;

channel.on("data", (chunk) => {
  buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
  pumpFrames();
});
channel.on("end", () => { channelClosed = true; pumpFrames(); });
channel.on("close", () => { channelClosed = true; pumpFrames(); });
channel.on("error", () => { channelClosed = true; pumpFrames(); });

function pumpFrames() {
  while (frameWaiters.length > 0) {
    const waiter = frameWaiters[0];
    if (buffered.length < 4) {
      if (channelClosed) { frameWaiters.shift(); waiter.resolve(null); }
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
        waiter.reject(new WorkerFailure("FRAME_TRUNCATED", "a frame ended early"));
      }
      return;
    }
    const payload = buffered.subarray(FRAME_HEADER, FRAME_HEADER + length);
    buffered = buffered.subarray(FRAME_HEADER + length);
    frameWaiters.shift();
    waiter.resolve(payload);
  }
}

function readFrame() {
  return new Promise((resolveFrame, rejectFrame) => {
    frameWaiters.push({ resolve: resolveFrame, reject: rejectFrame });
    pumpFrames();
  });
}

function writeFrame(payload) {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  channel.write(Buffer.concat([header, payload]));
}

/** Write a frame that CLAIMS a length, and only part of the bytes of it. */
function writeTruncatedFrame(payload, sent) {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  channel.write(Buffer.concat([header, payload.subarray(0, sent)]));
}

function writeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > MAX_METADATA_BYTES) throw new WorkerFailure("MESSAGE_TOO_LARGE", "the message is too large");
  writeFrame(payload);
}

async function readMessage(maxBytes) {
  const payload = await readFrame();
  if (payload === null) return null;
  if (payload.length > maxBytes) {
    throw new WorkerFailure("MESSAGE_TOO_LARGE", "a message of the private channel is too large");
  }
  return JSON.parse(payload.toString("utf8"));
}

/** The identity of this worker, as the kernel reports it. */
function readIdentity() {
  let text;
  try {
    text = fs().readFileSync(`/proc/${process.pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const head = text.indexOf("(");
  const cut = text.lastIndexOf(")");
  if (head < 0 || cut < 0) return null;
  const fields = text.slice(cut + 1).trim().split(/\s+/u);
  if (fields.length < 20) return null;
  return {
    pid: Number(text.slice(0, head).trim()),
    ppid: Number(fields[1]),
    pgid: Number(fields[2]),
    sid: Number(fields[3]),
    start_ticks: Number(fields[19]),
    state: fields[0],
  };
}

/**
 * A child that ignores SIGTERM and stays alive: it has to be killed hard.
 *
 * It writes to the EVENTS FILE and not to a pipe. A pipe whose read end closes
 * with the leader makes the child die of EPIPE - and it dies BEFORE the branch
 * it was written for is reached, so the case would prove nothing about the
 * adoption of a grandchild. The file is an owned sink: it survives the death
 * of the leader.
 *
 * The child reports its own identity from /proc, because the PPID there is the
 * CURRENT parent: after the leader left, the child is adopted by the custodian,
 * and the case has to see THAT.
 */
function spawnTermIgnoringChild(tag) {
  const child = spawn(process.execPath, ["-e", `
    const fs = require("node:fs");
    const path = process.argv[1];
    const identity = () => {
      try {
        const text = fs.readFileSync("/proc/self/stat", "utf8");
        const cut = text.lastIndexOf(")");
        const fields = text.slice(cut + 1).trim().split(/\\s+/u);
        return { pid: Number(text.slice(0, text.indexOf("(")).trim()), ppid: Number(fields[1]) };
      } catch { return null; }
    };
    const write = (name, extra) => {
      try {
        fs.appendFileSync(path, JSON.stringify({
          event: name, at: Date.now(), identity: identity(), ...extra }) + "\\n");
      } catch { /* the file is gone: the case reads what was written */ }
    };
    process.on("SIGTERM", () => { write("child-sigterm-ignored", {}); });
    write("child-alive", {});
    setInterval(() => { write("child-alive", {}); }, 200);
  `, eventsPath()], { stdio: ["ignore", "ignore", "ignore"] });
  event("child-spawned", { tag, pid: child.pid });
  return child;
}

/**
 * Stay alive with a REAL, referenced timer.
 *
 * An unref'd timer does not keep the process alive, and a pending promise does
 * not either: the previous version of this file had both, and the helper it
 * was written for was already gone before the fault it was supposed to show.
 */
function stayAlive() {
  return new Promise(() => {
    setInterval(() => { event("alive", {}); }, 200);
  });
}

async function main() {
  const scenario = readScenario();
  event("scenario", { scenario });
  const identity = readIdentity();
  if (identity === null) throw new WorkerFailure("IDENTITY_UNREADABLE", "the fixture could not read its identity");
  // The identity that is stated. The `foreign-hello` mode states an identity
  // that is NOT this worker's: the number of another process, with the start
  // time of this one.
  const stated = scenario === "foreign-hello"
    ? { ...identity, pid: identity.pid + 1000 }
    : identity;
  writeMessage({
    kind: "N_HELLO",
    protocol: PROTOCOL,
    pid: stated.pid,
    ppid: stated.ppid,
    pgid: stated.pgid,
    sid: stated.sid,
    start_ticks: String(stated.start_ticks),
    state: stated.state,
    scenario,
  });
  const go = await readMessage(MAX_REQUEST_BYTES);
  if (go === null || go.kind !== "GO") throw new WorkerFailure("PROTOCOL_UNEXPECTED", "no authorisation arrived");
  // The ticket of the draw is the SECRET of the draw: the answer carries its
  // DIGEST, and the digest is computed from the ticket itself. The previous
  // version of this file read a field that the Host does not send, and every
  // answer of it was FOREIGN before it was anything else.
  const ticket = typeof go.ticket === "string" ? go.ticket : "";
  const ticketDigest = createHash("sha256").update(Buffer.from(ticket, "utf8")).digest("hex");
  event("go", { scenario, ticket_digest: ticketDigest });
  if (scenario === "silent") {
    // The worker that never answers: the parent's READY deadline has to end the
    // draw, and the draw has to end as a failure and not as a picture.
    await stayAlive();
    return;
  }
  if (scenario === "flood") {
    // The flood: the parent's budget has to stop this draw. The timer is
    // referenced, so the worker really stays alive while it floods.
    event("flood", { scenario });
    const timer = setInterval(() => { process.stdout.write("x".repeat(65536)); }, 10);
    await stayAlive();
    clearInterval(timer);
    return;
  }
  if (scenario === "ignore-term" || scenario === "ignore-term-adopted") {
    // The real worker and the real grandchild: BOTH ignore SIGTERM. The
    // custodian has to kill the group and to reap the grandchild it adopted.
    process.on("SIGTERM", () => { event("sigterm-ignored", { scenario }); });
    const child = spawnTermIgnoringChild(scenario);
    event("term-ignoring", { scenario, child: child.pid });
    if (scenario === "ignore-term-adopted") {
      // The LEADER leaves first: the grandchild is adopted by the custodian
      // afterwards, and it still has to be killed and reaped.
      event("leader-leaves", { scenario });
      return;
    }
    await stayAlive();
    return;
  }
  const picture = Buffer.alloc(1024, 0x4a);
  writeMessage({
    kind: "result",
    ok: true,
    ticket_digest: ticketDigest,
    bytes: picture.length,
    sha256: createHash("sha256").update(picture).digest("hex"),
  });
  if (scenario === "half-jpeg") {
    // A TRUNCATED frame: the header announces the whole picture and only half
    // of it is written. The parent has to notice that the picture never
    // arrived - it may not be satisfied by a smaller, complete one.
    event("half-jpeg", { scenario, bytes: picture.length });
    writeTruncatedFrame(picture, picture.length / 2);
    await stayAlive();
    return;
  }
  writeFrame(picture);
  if (scenario === "late-launch") {
    // A child that starts AFTER the draw: it may not outlive the execution
    // domain of the draw.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 600000)"], { stdio: "ignore" });
    event("late-launch", { scenario, child: child.pid });
  }
  writeMessage({ kind: "closed", closed: true, observed: {} });
  event("answered", { scenario });
  const finalize = await readMessage(MAX_METADATA_BYTES);
  if (finalize === null || finalize.kind !== "FINALIZE") {
    throw new WorkerFailure("PROTOCOL_UNEXPECTED", "the authorisation to finish did not arrive");
  }
  event("finalized", { scenario });
}

try {
  await main();
  process.exit(0);
} catch (error) {
  try {
    writeMessage({
      kind: "fatal",
      error: { name: String(error?.name ?? "Error"), message: String(error?.message ?? error), code: String(error?.code ?? "") },
    });
  } catch {
    // The channel is gone: there is nothing left to report on it.
  }
  process.exit(1);
}
