import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderWorkerPath } from "../../../src/host/render/upstream-pin.js";
import { removeDirectory, temporaryDirectory } from "./support.js";

/**
 * The render worker's protocol.
 *
 * The worker is a child process with a fixed argument vector, so these checks are real
 * process checks — they are not a stub of one. They cover the refusals that have to
 * happen before any upstream byte is loaded: a request that is not a render request, a
 * film or an output outside the staging root, and an upstream that does not match its
 * pin.
 *
 * No browser and no encoder are started here: every case is refused before the
 * upstream is loaded. A render that actually draws frames is part of the real
 * acceptance and is `NOT_RUN`.
 */

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

interface WorkerRun {
  readonly code: number | null;
  readonly response: { ok?: boolean; error?: { code?: string; message?: string } } | null;
}

/** Run the worker with a request and read what it answered. */
async function runWorker(request: unknown): Promise<WorkerRun> {
  const workspace = await directory("worker");
  const requestPath = join(workspace, "request.json");
  const responsePath = join(workspace, "response.json");
  await writeFile(requestPath, typeof request === "string" ? request : JSON.stringify(request), "utf8");

  const code = await new Promise<number | null>((resolvePromise) => {
    execFile(process.execPath, [renderWorkerPath(), requestPath, responsePath], {
      timeout: 60_000,
      windowsHide: true,
    }, (error) => {
      resolvePromise((error as { code?: unknown } | null)?.code === undefined ? 0 : Number((error as { code: number }).code));
    });
  });

  let response: WorkerRun["response"] = null;
  try {
    response = JSON.parse(await readFile(responsePath, "utf8")) as WorkerRun["response"];
  } catch {
    response = null;
  }
  return { code, response };
}

/** A request that passes every check except the one a case is about. */
async function baseRequest(): Promise<Record<string, unknown>> {
  const staging = await directory("worker-staging");
  const project = join(staging, "project");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "film.html"), "<html></html>", "utf8");
  return {
    kind: "narralens.native_render_request@1.0",
    upstream_root: await directory("worker-upstream"),
    project_root: project,
    native_entry: "film.html",
    out_path: join(staging, "media.mp4"),
    staging_root: staging,
    width: 1920,
    height: 1080,
    fps: 30,
    workers: 1,
    samples: 1,
    shutter: 0.5,
  };
}

describe("the render worker", () => {
  it("refuses a request that is not a render request", async () => {
    const run = await runWorker({ kind: "something else" });
    expect(run.code).toBe(2);
    expect(run.response?.error?.code).toBe("REQUEST_KIND_REJECTED");
  });

  it("refuses a request file it cannot read", async () => {
    const workspace = await directory("worker-broken");
    const code = await new Promise<number | null>((resolvePromise) => {
      execFile(process.execPath, [renderWorkerPath(), join(workspace, "missing.json"), join(workspace, "response.json")], {
        timeout: 60_000,
        windowsHide: true,
      }, (error) => {
        resolvePromise(error === null ? 0 : Number((error as { code: number }).code));
      });
    });
    expect(code).toBe(2);
  });

  it("refuses a film that is not inside the staging root", async () => {
    const request = await baseRequest();
    request.project_root = "/tmp";
    const run = await runWorker(request);
    expect(run.code).toBe(2);
    expect(run.response?.error?.code).toBe("PROJECT_ROOT_OUTSIDE_STAGING");
  });

  it("refuses an output that is not inside the staging root", async () => {
    const request = await baseRequest();
    request.out_path = "/tmp/media.mp4";
    const run = await runWorker(request);
    expect(run.code).toBe(2);
    expect(run.response?.error?.code).toBe("OUT_PATH_OUTSIDE_STAGING");
  });

  it("refuses a film document that is not there", async () => {
    const request = await baseRequest();
    request.native_entry = "missing.html";
    const run = await runWorker(request);
    expect(run.code).toBe(2);
    expect(run.response?.error?.code).toBe("FILM_DOCUMENT_MISSING");
  });

  it("refuses an upstream that does not match its pin", async () => {
    const request = await baseRequest();
    const upstream = String(request.upstream_root);
    await mkdir(join(upstream, "packages", "openfilm", "src"), { recursive: true });
    await writeFile(join(upstream, "packages", "openfilm", "src", "render.mjs"), "not the pinned renderer\n", "utf8");
    const run = await runWorker(request);
    expect(run.code).toBe(2);
    expect(run.response?.error?.code).toBe("UPSTREAM_PIN_MISMATCH");
  });

  it("refuses a width that is not a whole number of pixels", async () => {
    const request = await baseRequest();
    request.width = 1920.5;
    const run = await runWorker(request);
    expect(run.code).toBe(2);
    expect(run.response?.error?.code).toBe("WIDTH_REJECTED");
  });
});
