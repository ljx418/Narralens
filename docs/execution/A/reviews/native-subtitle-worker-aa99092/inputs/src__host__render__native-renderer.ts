import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderWorkerPath } from "./upstream-pin.js";
import { FIXED_RENDER_OPTIONS } from "./render-profile.js";

/**
 * The native renderer.
 *
 * The renderer is a child process. That is not a detail of the implementation — it is
 * what makes a cancelled render honest:
 *
 * - The upstream renderer spawns ffmpeg and Chromium. When a render is cancelled, the
 *   whole tree has to stop, and the only way to stop a tree is to signal the group it
 *   belongs to. The child is therefore started in its own process group, and cancelling
 *   signals the group, not just the worker.
 * - A settled result requires both child exit and process-group disappearance. If those
 *   cannot be confirmed within the shutdown deadline, the result requires reconciliation;
 *   MAIN keeps the claim and no late artifact can be adopted.
 * - The argument vector is fixed: the worker path and two file paths. Everything else
 *   travels in a request file that the worker validates. There is no shell, so nothing
 *   in a path can become shell syntax.
 */

/** A failure of the native render. */
export class NativeRenderError extends Error {
  /**
   * Whether the renderer's process group was seen to end.
   *
   * It is false when the group might still be running: the renderer is gone, but the
   * ffmpeg or the browser it started may not be. Nothing may be adopted and no attempt
   * may be given up while that is true.
   */
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean = false,
    readonly group_settled: boolean = true,
  ) {
    super(message);
    this.name = "NativeRenderError";
  }
}

/** The render was cancelled. */
export class NativeRenderCancelled extends NativeRenderError {
  /**
   * True when the whole process group was seen to end.
   *
   * The worker closing is not the same as its ffmpeg and Chromium children being gone,
   * and only the second means that nothing can still write. When it is false, MAIN has
   * to record a reconciling fact and keep the attempt claimed.
   */
  constructor(message: string, groupSettled: boolean) {
    super("RENDER_CANCELLED", message, true, groupSettled);
    this.name = "NativeRenderCancelled";
  }
}

/** What to render. */
export interface NativeRenderRequest {
  /** The copied film's folder. It holds the film's entry document. */
  readonly project_root: string;
  readonly native_entry: string;
  /** Verified source frame count; required for native planned subtitle burn at A's 30fps. */
  readonly frame_count?: number;
  /** Where the renderer writes the film. It has to end in `.mp4`. */
  readonly out_path: string;
  /** The attempt's own staging directory. The film and the output are inside it. */
  readonly staging_root: string;
  readonly upstream_root: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly timeout_ms: number;
  readonly signal: AbortSignal | undefined;
}

/** What the renderer produced. */
export interface NativeRenderResult {
  readonly out_path: string;
  readonly lines: readonly string[];
  readonly elapsed_ms: number;
}

/**
 * The environment the worker gets.
 *
 * The list is an allowlist, not a denylist: an environment variable that is not named
 * here does not reach the worker. `NODE_OPTIONS` is deliberately absent — it can
 * inject code into a Node process, and the process that runs third-party bytes is the
 * last place to allow that.
 */
const ENVIRONMENT_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "SYSTEMROOT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "PLAYWRIGHT_BROWSERS_PATH",
  "DISPLAY",
] as const;

export function workerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENVIRONMENT_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  // A browser is never downloaded here: the pinned checkout has the one it uses, and a
  // render that reached out to the network would not be reproducible.
  env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  return env;
}

/** How long a cancelled worker is given to stop before it is killed outright. */
export const CANCEL_GRACE_MS = 3_000;
/** How long the process group is watched for its end after the worker is gone. */
export const GROUP_SETTLE_TIMEOUT_MS = 15_000;
/** How much of the worker's own output is kept. */
export const MAX_LOG_BYTES = 64 * 1024;

/** Whether a process group still exists. A signal of zero only asks. */
export function groupExistsOfProcess(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    // ESRCH means the group is gone; EPERM means it is there and this process may not
    // signal it, which is still "it exists".
    return (error as { code?: unknown }).code !== "ESRCH";
  }
}

export function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    // The negative pid is the process group the child leads.
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); }
    catch { /* the process is already gone */ }
  }
}

/**
 * Take the host's own paths out of a message.
 *
 * A renderer that fails says what it was doing, and what it was doing includes paths
 * on this machine. Those paths are useful in the Host's log and must not travel into
 * a reason that a client may read.
 */
export function redactRoots(text: string, roots: readonly string[]): string {
  let output = text;
  for (const root of roots) {
    if (typeof root !== "string" || root.length === 0) continue;
    output = output.split(resolve(root)).join("<root>");
  }
  return output.trim().slice(0, 500);
}

/**
 * What the render service needs from a renderer.
 *
 * The port exists so that the *orchestration* — the order of the checks, the fence, the
 * publish, the record — can be exercised without a browser. The renderer itself is
 * exercised by the pin probe and, in the real acceptance, by the real thing.
 */
export interface NativeRenderPort {
  render(request: NativeRenderRequest): Promise<NativeRenderResult>;
}

/** What the exit wait needs to know. */
export interface ChildExitOptions {
  readonly signal: AbortSignal | undefined;
  readonly timeout_ms: number;
  /** How long the process group is watched for its end. */
  readonly group_settle_timeout_ms?: number;
  /** Production uses CANCEL_GRACE_MS; a test may supply a shorter grace. */
  readonly cancel_grace_ms?: number;
  /** Whether a process group still exists. The seam exists for the tests. */
  readonly group_exists?: (pid: number) => boolean;
  /** How a process group is signalled. The seam exists for the tests. */
  readonly signal_group?: (child: ChildProcess, signal: NodeJS.Signals) => void;
}

/** What came of waiting for a child. */
export interface ChildExitResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  /**
   * False when the process group might still be running.
   *
   * The worker closing is not the same as its ffmpeg and Chromium children being gone,
   * and only the second means that nothing can still write.
   */
  readonly group_settled: boolean;
}

/**
 * Wait for a child to exit, and for its group to end.
 *
 * A cancellation stops the whole group, waits for the grace period, and then stops it
 * outright; the promise still waits for the process to be gone, because a cancel that
 * returns while the encoder is running is a cancel that lies. When the group cannot be
 * seen to end, the result says so: the caller has to keep the attempt claimed and let
 * MAIN record a reconciling fact.
 */
export async function awaitChildExit(child: ChildProcess, options: ChildExitOptions): Promise<ChildExitResult> {
  const groupExists = options.group_exists ?? groupExistsOfProcess;
  const signalGroup = options.signal_group ?? signalProcessGroup;
  const groupSettleTimeout = options.group_settle_timeout_ms ?? GROUP_SETTLE_TIMEOUT_MS;
  const grace = options.cancel_grace_ms ?? CANCEL_GRACE_MS;
  for (const duration of [options.timeout_ms, grace, groupSettleTimeout]) {
    if (!Number.isFinite(duration) || duration < 0 || duration > 2_147_483_647) {
      throw new RangeError("Invalid renderer lifecycle deadline");
    }
  }

  return await new Promise<ChildExitResult>((resolvePromise) => {
    let finished = false;
    let closed = false;
    let stopping = false;
    let timedOut = false;
    let code: number | null = null;
    let closeSignal: NodeJS.Signals | null = null;
    let requestTimer: NodeJS.Timeout | undefined;
    let escalation: NodeJS.Timeout | undefined;
    let confirmation: NodeJS.Timeout | undefined;
    let poll: NodeJS.Timeout | undefined;

    const groupGone = (): boolean => {
      try { return child.pid === undefined || !groupExists(child.pid); }
      catch { return false; }
    };
    const finish = (settled: boolean): void => {
      if (finished) return;
      finished = true;
      for (const timer of [requestTimer, escalation, confirmation, poll]) clearTimeout(timer);
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      options.signal?.removeEventListener("abort", onAbort);
      resolvePromise({ code, signal: closeSignal, timedOut, group_settled: settled });
    };
    const observe = (): void => {
      if (finished) return;
      // A successful signal or a missing group alone is insufficient: close must also
      // have been observed, including all child stdio. Unknown never becomes success.
      if (closed && groupGone()) { finish(true); return; }
      poll = setTimeout(observe, 10);
    };
    const send = (signal: NodeJS.Signals): void => {
      try { if (!closed || !groupGone()) signalGroup(child, signal); }
      catch { /* failure to signal is retained as an unsettled result */ }
    };
    const stop = (): void => {
      if (finished || stopping) return;
      stopping = true;
      clearTimeout(requestTimer);
      clearTimeout(confirmation);
      clearTimeout(poll);
      send("SIGTERM");
      if (finished) return;
      escalation = setTimeout(() => {
        send("SIGKILL");
        // Even a child that never emits close has a finite, explicitly unknown result.
        if (!finished) confirmation = setTimeout(() => finish(closed && groupGone()), groupSettleTimeout);
      }, grace);
      observe();
    };
    const onAbort = (): void => { stop(); };
    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      closed = true;
      code = exitCode;
      closeSignal = signal;
      clearTimeout(requestTimer);
      if (groupGone()) { finish(true); return; }
      if (!stopping) {
        // The leader exited naturally; observe remaining descendants without sending
        // a delayed signal to a potentially reused process-group identity.
        confirmation = setTimeout(() => finish(groupGone()), groupSettleTimeout);
        observe();
      }
    };
    const onError = (): void => {
      if (child.pid === undefined) { closed = true; finish(true); }
      else stop();
    };
    child.once("close", onClose);
    child.once("error", onError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    requestTimer = setTimeout(() => { timedOut = true; stop(); }, options.timeout_ms);
    if (isAborted(options.signal)) stop();
  });
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** No worker response can override an unsettled process or a failed exit. */
export function requireSuccessfulRendererExit(exited: ChildExitResult): void {
  if (!exited.group_settled) {
    throw new NativeRenderError("RENDER_PROCESS_UNSETTLED", "the renderer process requires reconciliation", true, false);
  }
  if (exited.code !== 0 || exited.signal !== null) {
    throw new NativeRenderError("RENDER_EXIT_FAILED", "the renderer did not exit successfully", true);
  }
}

/**
 * Wait until the child's process group is seen to end.
 *
 * The worker spawns ffmpeg and Chromium, and they are in the same group. The worker
 * closing does not mean they are gone, so the group itself is asked: a signal of zero
 * does not disturb anything, it only says whether the group is still there.
 */
export async function awaitGroupEnd(
  child: ChildProcess,
  groupExists: (pid: number) => boolean = groupExistsOfProcess,
  timeoutMs: number = GROUP_SETTLE_TIMEOUT_MS,
): Promise<boolean> {
  const pid = child.pid;
  if (pid === undefined) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupExists(pid)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return !groupExists(pid);
}

export class NativeRenderer implements NativeRenderPort {
  readonly #upstreamRoot: string;
  readonly #nodeBinary: string;

  constructor(deps: { readonly upstream_root: string; readonly node_binary?: string }) {
    this.#upstreamRoot = resolve(deps.upstream_root);
    this.#nodeBinary = deps.node_binary ?? process.execPath;
  }

  /**
   * Render the film.
   *
   * The promise settles when the worker has exited, whatever the outcome. A failure of
   * the renderer is a reported error, not an exception that hides the state of the
   * process tree.
   */
  async render(request: NativeRenderRequest): Promise<NativeRenderResult> {
    // A request that is already cancelled never starts a renderer. Spawning one and
    // stopping it a moment later would leave a process tree behind for no reason.
    if (isAborted(request.signal)) {
      throw new NativeRenderCancelled("the render was cancelled before it started", true);
    }
    const stagingRoot = resolve(request.staging_root);
    const requestPath = resolve(stagingRoot, "render-request.json");
    const responsePath = resolve(stagingRoot, "render-response.json");
    const workerPath = renderWorkerPath();

    await writeFile(requestPath, `${JSON.stringify({
      kind: "narralens.native_render_request@1.0",
      upstream_root: this.#upstreamRoot,
      project_root: resolve(request.project_root),
      native_entry: request.native_entry,
      frame_count: request.frame_count ?? null,
      out_path: resolve(request.out_path),
      staging_root: stagingRoot,
      width: request.width,
      height: request.height,
      fps: request.fps,
      workers: FIXED_RENDER_OPTIONS.workers,
      samples: FIXED_RENDER_OPTIONS.samples,
      shutter: FIXED_RENDER_OPTIONS.shutter,
    })}\n`, { encoding: "utf8", mode: 0o600 });

    // The request file was written; the signal is asked again. A cancellation that
    // arrived while it was being written must not start a renderer.
    if (isAborted(request.signal)) {
      throw new NativeRenderCancelled("the render was cancelled before the renderer started", true);
    }

    const child = spawn(this.#nodeBinary, [workerPath, requestPath, responsePath], {
      cwd: resolve(request.project_root),
      env: workerEnvironment(),
      detached: true,
      // stdout is ignored rather than piped: a pipe nobody reads fills up and stops the
      // child. stderr is read, because the upstream's errors arrive there.
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });

    // The worker's own output is bounded: a render that talks for an hour must not be
    // able to fill the Host's memory.
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length >= MAX_LOG_BYTES) return;
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_LOG_BYTES) stderr = stderr.slice(0, MAX_LOG_BYTES);
    });

    const exited = await awaitChildExit(child, { signal: request.signal, timeout_ms: request.timeout_ms });

    if (isAborted(request.signal)) {
      throw new NativeRenderCancelled("the render was cancelled", exited.group_settled);
    }
    if (exited.timedOut) {
      throw new NativeRenderError("RENDER_TIMEOUT", "the renderer did not finish in time", true, exited.group_settled);
    }
    // Never interpret a response from a still-live group or a signalled process.
    // A settled worker's deliberate nonzero rejection still carries its precise reason.
    if (!exited.group_settled || exited.signal !== null) requireSuccessfulRendererExit(exited);

    const response = await this.#readResponse(responsePath);
    if (response === null) {
      const detail = redactRoots(stderr, [stagingRoot, this.#upstreamRoot]);
      throw new NativeRenderError(
        "RENDER_NO_RESPONSE",
        `the renderer exited without an answer (exit ${String(exited.code)})${detail.length > 0 ? `: ${detail}` : ""}`,
        false,
        exited.group_settled,
      );
    }
    if (response.ok !== true) {
      const failure = typeof response.error === "object" && response.error !== null
        ? response.error as { readonly code?: unknown; readonly message?: unknown }
        : null;
      const code = typeof failure?.code === "string" ? failure.code : "RENDER_FAILED";
      const message = typeof failure?.message === "string" ? failure.message : "the renderer failed";
      throw new NativeRenderError(code, message, false, exited.group_settled);
    }
    // An ok envelope cannot turn a nonzero exit into a successful render.
    requireSuccessfulRendererExit(exited);
    return {
      out_path: resolve(request.out_path),
      lines: Array.isArray(response.lines) ? response.lines.filter((line): line is string => typeof line === "string") : [],
      elapsed_ms: typeof response.elapsed_ms === "number" ? response.elapsed_ms : 0,
    };
  }

  async #readResponse(path: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
}

/** Remove the request and response files of a render. */
export async function discardRenderRequestFiles(stagingRoot: string): Promise<void> {
  const root = resolve(stagingRoot);
  for (const name of ["render-request.json", "render-response.json"]) {
    await rm(resolve(root, name), { force: true }).catch(() => undefined);
  }
}
