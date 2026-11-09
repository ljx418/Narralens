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
 * - The promise settles only after the child has actually exited. A cancel that returns
 *   while ffmpeg is still writing would let a late artefact be adopted, and the whole
 *   point of cancelling is that the late artefact is not adopted.
 * - The argument vector is fixed: the worker path and two file paths. Everything else
 *   travels in a request file that the worker validates. There is no shell, so nothing
 *   in a path can become shell syntax.
 */

/** A failure of the native render. */
export class NativeRenderError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean = false) {
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
  constructor(message: string, readonly group_settled: boolean) {
    super("RENDER_CANCELLED", message, true);
    this.name = "NativeRenderCancelled";
  }
}

/** What to render. */
export interface NativeRenderRequest {
  /** The copied film's folder. It holds the film's entry document. */
  readonly project_root: string;
  readonly native_entry: string;
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
export function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    // ESRCH means the group is gone; EPERM means it is there and this process may not
    // signal it, which is still "it exists".
    return (error as { code?: unknown }).code !== "ESRCH";
  }
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
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
    if (request.signal?.aborted === true) {
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
      out_path: resolve(request.out_path),
      staging_root: stagingRoot,
      width: request.width,
      height: request.height,
      fps: request.fps,
      workers: FIXED_RENDER_OPTIONS.workers,
      samples: FIXED_RENDER_OPTIONS.samples,
      shutter: FIXED_RENDER_OPTIONS.shutter,
    })}\n`, { encoding: "utf8", mode: 0o600 });

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

    const exited = await this.#awaitExit(child, request.signal, request.timeout_ms);

    if (request.signal?.aborted === true) {
      throw new NativeRenderCancelled("the render was cancelled", exited.group_settled);
    }
    if (exited.timedOut) {
      throw new NativeRenderError("RENDER_TIMEOUT", "the renderer did not finish in time", true);
    }

    const response = await this.#readResponse(responsePath);
    if (response === null) {
      const detail = redactRoots(stderr, [stagingRoot, this.#upstreamRoot]);
      throw new NativeRenderError(
        "RENDER_NO_RESPONSE",
        `the renderer exited without an answer (exit ${String(exited.code)})${detail.length > 0 ? `: ${detail}` : ""}`,
      );
    }
    if (response.ok !== true) {
      const failure = typeof response.error === "object" && response.error !== null
        ? response.error as { readonly code?: unknown; readonly message?: unknown }
        : null;
      const code = typeof failure?.code === "string" ? failure.code : "RENDER_FAILED";
      const message = typeof failure?.message === "string" ? failure.message : "the renderer failed";
      throw new NativeRenderError(code, message);
    }
    return {
      out_path: resolve(request.out_path),
      lines: Array.isArray(response.lines) ? response.lines.filter((line): line is string => typeof line === "string") : [],
      elapsed_ms: typeof response.elapsed_ms === "number" ? response.elapsed_ms : 0,
    };
  }

  /**
   * Wait for the child to exit.
   *
   * A cancellation stops the whole group, waits for the grace period, and then stops
   * it outright; the promise still waits for the process to be gone, because a cancel
   * that returns while the encoder is running is a cancel that lies.
   */
  async #awaitExit(child: ChildProcess, signal: AbortSignal | undefined, timeoutMs: number): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    group_settled: boolean;
  }> {
    let timedOut = false;
    let escalation: NodeJS.Timeout | null = null;

    const escalate = (): void => {
      signalGroup(child, "SIGTERM");
      escalation = setTimeout(() => {
        // The group is asked before it is signalled: a group id that the system has
        // given to something else must not be killed.
        if (child.pid !== undefined && groupExists(child.pid)) signalGroup(child, "SIGKILL");
      }, CANCEL_GRACE_MS);
      escalation.unref();
    };
    const onAbort = (): void => { escalate(); };
    const onTimeout = (): void => {
      timedOut = true;
      escalate();
    };

    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(onTimeout, timeoutMs);
    timer.unref();

    try {
      const exited = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }>((resolvePromise) => {
        child.once("close", (code, closeSignal) => {
          resolvePromise({ code, signal: closeSignal, timedOut });
        });
        child.once("error", () => {
          resolvePromise({ code: null, signal: null, timedOut });
        });
      });

      // The worker is gone; its children may not be. The group is watched until it is
      // seen to end, and only then is the escalation timer cleared — a timer that fired
      // later would signal a process group id that the system may have given to
      // something else by then.
      // A render that was stopped is watched until its group is gone. A render that
      // ended on its own is only asked once: the group id may have been given to
      // something else by then, and waiting for it would mean waiting for a stranger.
      const stopped = timedOut || signal?.aborted === true;
      const groupSettled = stopped
        ? await this.#awaitGroupEnd(child)
        : child.pid === undefined || !groupExists(child.pid);
      if (groupSettled && escalation !== null) {
        clearTimeout(escalation);
        escalation = null;
      }

      return { ...exited, group_settled: groupSettled };
    } finally {
      clearTimeout(timer);
      if (escalation !== null) clearTimeout(escalation);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Wait until the child's process group is seen to end.
   *
   * The worker spawns ffmpeg and Chromium, and they are in the same group. The worker
   * closing does not mean they are gone, so the group itself is asked: a signal of
   * zero does not disturb anything, it only says whether the group is still there.
   */
  async #awaitGroupEnd(child: ChildProcess): Promise<boolean> {
    const pid = child.pid;
    if (pid === undefined) return true;
    const deadline = Date.now() + GROUP_SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!groupExists(pid)) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return !groupExists(pid);
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
