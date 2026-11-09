import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

/** A worker-local policy; it never modifies the pinned upstream checkout. */
export function localMediaArgs(command, args) {
  const name = basename(String(command));
  if (name !== "ffmpeg" && name !== "ffprobe") return args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error("Invalid native media argument vector");
  }
  if (name === "ffprobe") return ["-protocol_whitelist", "file,pipe", "-threads", "1", ...args];
  const result = ["-filter_threads", "1", "-filter_complex_threads", "1"];
  for (const arg of args) {
    // FFmpeg treats these as per-input options; each input needs its own policy,
    // including local playlists which could otherwise reference network URLs.
    if (arg === "-i") result.push("-protocol_whitelist", "file,pipe", "-threads", "1");
    result.push(arg);
  }
  return result;
}

export function installMediaProcessPolicy() {
  for (const method of ["spawn", "spawnSync", "execFile"]) {
    const original = childProcess[method];
    childProcess[method] = function(command, args, ...rest) {
      // Playwright explicitly asks for detached:true on POSIX. Without overriding
      // that option, the browser escapes the worker group which MAIN owns/kills.
      // Normalize Node's omitted-args/options/callback overloads before the policy.
      if (!Array.isArray(args)) {
        if (args !== undefined) rest.unshift(args);
        args = [];
      }
      const options = rest[0];
      if (options !== null && typeof options === "object") {
        rest[0] = { ...options, detached: false };
      } else {
        if (options === null || options === undefined && rest.length > 0) rest.shift();
        rest.unshift({ detached: false });
      }
      return Reflect.apply(original, this, [command, localMediaArgs(command, args), ...rest]);
    };
  }
  // The pinned modules use named ESM imports from node:child_process.
  syncBuiltinESMExports();
}

/** Native render() reports page failures as output lines, despite a successful encode. */
export function nativeOutputProblems(result) {
  if (!Array.isArray(result?.lines)) return ["native renderer returned no output evidence"];
  return result.lines.filter((line) => typeof line === "string" && /^\s*✗/u.test(line));
}
