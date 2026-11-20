import { appendFileSync } from "node:fs";

/**
 * The helper of the PROBE pilot.
 *
 * The question the pilot answers is about the EVENTS of Node's own child process
 * API: when does the callback of `execFile` really arrive, when does the
 * `close` event of a ChildProcess really arrive, and what may be said about a
 * child that is still alive when one of them happens.
 *
 * The old argument of the 060P1 report - "a child that closes its standard
 * streams makes the ChildProcess close while the child is still alive" - is
 * WRONG, and this helper exists to show what really happens instead of arguing
 * about it. It never pretends to be ffprobe: it is a small Node helper with a
 * known behaviour, and the case says so.
 *
 * The modes:
 *
 *   normal          answer on the standard output and leave.
 *   close-stdio-live close the standard output and the standard error, and STAY
 *                    ALIVE. The parent has to see that the close of the streams
 *                    is not the close of the child.
 *   ignore-term     ignore SIGTERM and stay alive. The parent has to end it with
 *                    the hard signal, and it has to WAIT for the real close.
 *
 * The mode is the first argument and the event file is the second. The events
 * are written as JSON lines, with the identity of this process in each of them,
 * so that the case can line them up with what the kernel says.
 *
 * THE HELPER STAYS ALIVE WITH A REFERENCED TIMER. An unref'd timer does not
 * keep the event loop of Node alive, and a pending top level promise does not
 * either: the previous version of this file had both, and the helper was
 * already gone before the case could observe anything. The timer here is
 * REFERENCED, and the identity is read AGAIN at every event, so that a case can
 * see that the process it is talking about is the process it thinks it is.
 */

const mode = process.argv[2] ?? "normal";
const eventFile = process.argv[3] ?? "";

/** The identity of this process, as the kernel reports it. */
function readIdentity() {
  try {
    const fs = globalThis.process.getBuiltinModule
      ? globalThis.process.getBuiltinModule("node:fs")
      : null;
    if (fs === null) return null;
    const text = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
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
  } catch {
    return null;
  }
}

/** One event, with the moment it happened and who it happened to. */
function event(name, extra) {
  const record = {
    event: name,
    at: Date.now(),
    identity: readIdentity(),
    ...extra,
  };
  if (eventFile !== "") {
    try { appendFileSync(eventFile, `${JSON.stringify(record)}\n`); }
    catch { /* the event file is gone: the case reads what was written */ }
  }
  process.stderr.write(`${JSON.stringify(record)}\n`);
}

// The exit is registered BEFORE anything else happens, so that the order of the
// events of this process is the order of its own life.
process.on("exit", (code) => { event("exit", { code }); });
if (mode === "ignore-term") {
  process.on("SIGTERM", () => { event("sigterm-ignored", {}); });
}
event("start", { mode });

/** Stay alive with a REFERENCED timer. */
function stayAlive(what) {
  return new Promise(() => {
    setInterval(() => { event(what, {}); }, 200);
  });
}

if (mode === "close-stdio-live") {
  // The streams are closed; the process is NOT. Whatever the parent believes
  // about the close of a child, it has to be about THIS process.
  process.stdout.end();
  process.stderr.end();
  await stayAlive("alive");
} else if (mode === "ignore-term") {
  await stayAlive("alive");
} else {
  process.stdout.write("ok\n");
  process.exit(0);
}
