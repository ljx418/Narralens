/**
 * A test-layer observation of the bytes a read really moved.
 *
 * The state lives here, and the WRAPPER that fills it lives in the test file: the
 * test wraps the real `readSync` and the real `openSync` of `node:fs` for its own
 * module graph only, calls the real functions, returns their real result, and
 * records what they moved.
 *
 * Nothing here decides anything and nothing here can make a fact true that is not:
 * the bytes are the bytes the kernel moved, attributed to the REAL descriptor the
 * closure opened, and the path of that descriptor is the closure's own path.
 */
/** The descriptors the closure opened, and the path of each. */
const opened = new Map();
/** The bytes each path really moved. */
const moved = new Map();
/** The mutation that is armed: the path it watches and what it does at the first read. */
const armed = { target: null, fired: false, run: null };

/** One real descriptor was opened for one real path. */
export function recordOpen(fd, path) {
  opened.set(fd, path);
}

/** One real read moved so many bytes on one real descriptor. */
export function recordRead(fd, bytes) {
  if (bytes <= 0) return;
  const path = opened.get(fd);
  if (path === undefined) return;
  moved.set(path, (moved.get(path) ?? 0) + bytes);
  // The armed mutation fires at the FIRST real read of the watched path: the
  // parent has already read a block of the file, and the mutation happens before
  // the read that is in flight returns.
  if (armed.target !== null && !armed.fired && path.endsWith(armed.target) && typeof armed.run === "function") {
    armed.fired = true;
    armed.run();
  }
}

/** Arm the mutation that fires at the first real read of a path (by its last part). */
export function armMutation(target, run) {
  armed.target = target;
  armed.fired = false;
  armed.run = run;
}

/** Whether the armed mutation has already fired. */
export function mutationFired() {
  return armed.fired;
}

/** Forget everything: the next case starts from zero. */
export function reset() {
  opened.clear();
  moved.clear();
  armed.target = null;
  armed.fired = false;
  armed.run = null;
}

/** The bytes ONE path really moved. */
export function bytesOf(path) {
  return moved.get(path) ?? 0;
}

/** The bytes of every path. */
export function totalBytes() {
  let sum = 0;
  for (const value of moved.values()) sum += value;
  return sum;
}

/** The paths that were really read. */
export function pathsRead() {
  return [...moved.keys()];
}
