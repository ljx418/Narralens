import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { startEnvironment, type HeadlessEnvironment } from "../tests/m5/headless/environment.js";
import { findChrome, makeProfile, toWindowsPath } from "../tests/m5/headless/chrome.js";

/**
 * Visible UX-12 launcher.
 *
 * This is deliberately separate from the Headless evidence runner. It may only run after
 * the operator has explicitly opted in, and it never signs the human case on their behalf.
 */
export function assertLoopbackUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error(`M5_HUMAN_REFUSED_NON_LOOPBACK:${url.origin}`);
  }
  return url;
}

export function headedChromeArgs(profileRoot: string, pageUrl: string, windows: boolean): string[] {
  const url = assertLoopbackUrl(pageUrl);
  const profile = windows ? toWindowsPath(profileRoot) : profileRoot;
  return [
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1440,900",
    `--app=${url.href}`,
  ];
}

async function stopBrowser(child: ChildProcess, windows: boolean): Promise<void> {
  if (child.exitCode !== null) return;
  if (windows && child.pid !== undefined) {
    await new Promise<void>((done) => {
      const killer = spawn("taskkill.exe", ["//F", "//T", "//PID", String(child.pid)], { stdio: "ignore" });
      killer.once("exit", () => done());
      killer.once("error", () => done());
    });
    return;
  }
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise<void>((done) => setTimeout(done, 1000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await Promise.race([exited, new Promise<void>((done) => setTimeout(done, 1000))]);
}

export async function main(): Promise<void> {
  if (process.env.NARRALENS_ALLOW_VISIBLE_UI !== "1") {
    throw new Error(
      "M5_HUMAN_CONFIRMATION_REQUIRED: visible Chrome may open and take focus; "
      + "run only after the project owner is present with NARRALENS_ALLOW_VISIBLE_UI=1",
    );
  }
  if (process.env.CI === "true") throw new Error("M5_HUMAN_REFUSED_IN_CI");

  const executable = await findChrome();
  if (executable === undefined) throw new Error("M5_BLOCKED_ENV:NO_LOCAL_CHROME");
  const windows = /\.exe$/iu.test(executable);
  const profileRoot = await makeProfile(executable, "narralens-m5-human-");
  let environment: HeadlessEnvironment | undefined;
  let child: ChildProcess | undefined;
  let stderr = "";
  let stopping = false;
  let browserStop: Promise<void> | undefined;
  const requestStop = (): void => {
    if (stopping) return;
    stopping = true;
    if (child !== undefined) browserStop = stopBrowser(child, windows);
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    environment = await startEnvironment();
    if (stopping) throw new Error("M5_HUMAN_SESSION_CANCELLED");
    const route = `${environment.pageUrl}#/refine/${environment.projectId}`;
    child = spawn(executable, headedChromeArgs(profileRoot, route, windows), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    process.stdout.write([
      "M5 UX-12 visible session started.",
      `project_id=${environment.projectId}`,
      `url=${route}`,
      "Follow docs/evidence/WAVE3/M5/human-acceptance-runbook.md.",
      "Close the Chrome app window or press Ctrl+C here when finished.",
      "This launcher records no PASS: the project owner must report the result separately.",
      "",
    ].join("\n"));

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
      child?.once("exit", (code, signal) => done({ code, signal }));
      child?.once("error", () => done({ code: 1, signal: null }));
    });
    process.stdout.write(`M5 UX-12 visible session stopped (code=${exit.code ?? "null"}, signal=${exit.signal ?? "none"}).\n`);
    if (!stopping && exit.code !== 0 && exit.code !== null) {
      throw new Error(`M5_HUMAN_BROWSER_EXITED:${exit.code}:${stderr.slice(-400)}`);
    }
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    if (child !== undefined) await (browserStop ?? stopBrowser(child, windows));
    await environment?.close();
    await rm(profileRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath !== "" && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
