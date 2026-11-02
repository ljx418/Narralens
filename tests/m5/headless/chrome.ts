import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The in-repo Headless Chrome launcher (Wave 3 `04` §7).
 *
 * The rule this file exists to satisfy is simple: *the repository starts the browser it
 * drives.* A harness that needs a human to open a browser, paste a debugging port and
 * leave a window on the desktop is a harness that cannot be run in CI, cannot be
 * captured, and cannot be proven to be headless.
 *
 * So the launcher:
 *
 * - finds a *local* Chrome (an explicit `NARRALENS_CHROME_PATH` wins; otherwise the
 *   known install paths for this platform), and never downloads one;
 * - spawns it with a fixed argv: `--headless=new`, `--mute-audio`, a random debugging
 *   port (`0`, so the operating system picks one), an isolated profile and no
 *   first-run dialog;
 * - reads the real port out of the profile's `DevToolsActivePort`;
 * - and closes everything it started in a `finally`: the browser, the Host, the Gateway
 *   and the profile directory.
 *
 * The browser keeps its own sandbox: nothing here turns a guard off, opens a window,
 * takes a focus or touches the network.
 */
export interface ChromeLaunchOptions {
  /** The isolated profile directory. The launcher creates it. */
  readonly profileRoot: string;
  /** The window size, in CSS pixels, for the outer window. */
  readonly width?: number;
  readonly height?: number;
}

export interface ChromeHandle {
  /** The CDP HTTP endpoint, e.g. `http://127.0.0.1:9222`. */
  readonly endpoint: string;
  /** The browser's own version string, read back from CDP. */
  readonly browser: string;
  /** The executable that was started. */
  readonly executable: string;
  /** True when the executable is a Windows program driven from WSL. */
  readonly windows: boolean;
  close(): Promise<void>;
}

const LINUX_CHROME = [
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
];
const MACOS_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const WINDOWS_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

/** Every candidate, in the order they are tried. */
export function chromeCandidates(): string[] {
  const explicit = process.env.NARRALENS_CHROME_PATH;
  return explicit === undefined || explicit === ""
    ? [...WINDOWS_CHROME, ...LINUX_CHROME, ...MACOS_CHROME]
    : [resolve(explicit)];
}

/** The first candidate that exists, or `undefined`. */
export async function findChrome(): Promise<string | undefined> {
  for (const candidate of chromeCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* try the next one */ }
  }
  return undefined;
}

/**
 * A WSL path as a Windows path.
 *
 * The Windows Chrome cannot open `/tmp/...`, so a profile under the WSL filesystem has
 * to be handed over as a Windows path. The conversion is textual and exact: `/mnt/c/x`
 * is `C:\x`, and anything else is left alone.
 */
export function toWindowsPath(path: string): string {
  const match = /^\/mnt\/([a-zA-Z])\/(.*)$/u.exec(path);
  if (match === null) return path;
  return `${match[1]!.toUpperCase()}:\\${match[2]!.replaceAll("/", "\\")}`;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export async function launchChrome(options: ChromeLaunchOptions): Promise<ChromeHandle> {
  const executable = await findChrome();
  if (executable === undefined) {
    throw new Error("M5_BLOCKED_ENV:NO_LOCAL_CHROME");
  }
  const windows = /\.exe$/iu.test(executable);
  await mkdir(options.profileRoot, { recursive: true });
  const profileArgument = windows ? toWindowsPath(options.profileRoot) : options.profileRoot;
  const width = options.width ?? 1440;
  const height = options.height ?? 900;

  const args = [
    "--headless=new",
    "--mute-audio",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileArgument}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-sync",
    "--autoplay-policy=no-user-gesture-required",
    `--window-size=${width},${height}`,
    "about:blank",
  ];

  const child: ChildProcess = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stderr: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => { stderr.push(chunk.toString("utf8")); });

  const portFile = join(options.profileRoot, "DevToolsActivePort");
  let port = "";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const raw = await readFile(portFile, "utf8").catch(() => "");
    const first = raw.split("\n")[0]?.trim() ?? "";
    if (/^\d+$/u.test(first)) { port = first; break; }
    if (child.exitCode !== null) {
      throw new Error(`M5_BLOCKED_ENV:CHROME_EXITED:${child.exitCode}:${stderr.join("").slice(-400)}`);
    }
    await sleep(250);
  }
  if (port === "") {
    child.kill("SIGKILL");
    throw new Error(`M5_BLOCKED_ENV:CHROME_NO_DEBUGGING_PORT:${stderr.join("").slice(-400)}`);
  }

  const endpoint = `http://127.0.0.1:${port}`;
  let browser = "";
  try {
    const version = await fetch(`${endpoint}/json/version`).then(async (response) =>
      await response.json() as { Browser?: string });
    browser = version.Browser ?? "";
  } catch { browser = ""; }

  return {
    endpoint, browser, executable, windows,
    close: async (): Promise<void> => {
      if (child.exitCode !== null) return;
      // The browser is asked to close through its own protocol first, so it releases the
      // profile and its port cleanly; the kill is the fallback for a browser that has
      // stopped answering.
      await fetch(`${endpoint}/json/close`).catch(() => undefined);
      await sleep(300);
      if (windows) {
        await new Promise<void>((done) => {
          const killer = spawn("taskkill.exe", ["//F", "//T", "//PID", String(child.pid)], { stdio: "ignore" });
          killer.on("exit", () => done());
          killer.on("error", () => done());
        });
      } else {
        child.kill("SIGTERM");
      }
      await sleep(300);
      if (child.exitCode === null) child.kill("SIGKILL");
      await rm(options.profileRoot, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * An isolated profile directory, removed when the harness is done with it.
 *
 * The base directory depends on the browser: a Windows program cannot open a WSL path,
 * so its profile has to live on the Windows filesystem. The path is still a *real*
 * directory the harness owns and deletes.
 */
export async function makeProfile(executable?: string, prefix = "narralens-m5-chrome-"): Promise<string> {
  const base = executable !== undefined && /\.exe$/iu.test(executable)
    ? (process.env.NARRALENS_M5_PROFILE_BASE ?? "/mnt/c/Users/Public")
    : tmpdir();
  await mkdir(base, { recursive: true });
  return await mkdtemp(join(base, prefix));
}
