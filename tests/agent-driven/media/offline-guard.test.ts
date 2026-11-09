import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderWorkerPath, RENDER_PIN } from "../../../src/host/render/upstream-pin.js";
import { removeDirectory, temporaryDirectory } from "./support.js";

/**
 * The offline guard.
 *
 * The guard is what stands between a render and the network. It is a separate module
 * that the pinned `host.mjs` is replaced by at load time, and the worker refuses to
 * render when the guard did not take effect.
 *
 * These are module checks. The last one is a real process: it loads the pinned
 * upstream through the guard and proves that the guard was installed — the worker gets
 * as far as reading the film, which it can only do when the guard is in place. It
 * starts no browser and no encoder. The genuine network denial probe — a render that
 * tries to reach the outside and is seen to fail — is part of the heavy acceptance and
 * is `NOT_RUN`.
 */

const REAL_UPSTREAM = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

describe("the offline guard", () => {
  it("is pinned next to the upstream it stands in front of", () => {
    expect(Object.keys(RENDER_PIN.guard_module_sha256).sort()).toEqual([
      "src/host/render/openfilm-offline-hooks.mjs",
      "src/host/render/openfilm-offline-wrapper.mjs",
    ]);
  });

  it("is on disk exactly as the pin records it", async () => {
    for (const [relative, expected] of Object.entries(RENDER_PIN.guard_module_sha256)) {
      const bytes = await readFile(join(process.cwd(), relative));
      expect(createHash("sha256").update(bytes).digest("hex"), relative).toBe(expected);
    }
  });

  it("forces the page offline and the browser closed to the network", async () => {
    const wrapper = await readFile(join(process.cwd(), "src/host/render/openfilm-offline-wrapper.mjs"), "utf8");
    // The options the upstream understands: only the film's own origin may load, and
    // every other request is blocked and recorded.
    expect(wrapper).toContain("offline: true");
    expect(wrapper).toContain("network: { allow: [] }");
    // The browser flags: everything that is not loopback has nowhere to go.
    expect(wrapper).toContain("--proxy-server=http://127.0.0.1:1");
    expect(wrapper).toContain("--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1");
    // A service worker fetches outside the context's route handler, so it is blocked
    // in the context itself.
    expect(wrapper).toContain("serviceWorkers: \"block\"");
  });

  it("makes the renderer refuse to reach the network of its own accord", async () => {
    const worker = await readFile(renderWorkerPath(), "utf8");
    // The fast-seeking copies run ffmpeg over the source videos; they are a cache of
    // the sources and are not made.
    expect(worker).toContain("seekable: false");
    // The guard has to be in place, not merely loaded.
    expect(worker).toContain("OFFLINE_GUARD_NOT_INSTALLED");
  });

  it.skipIf(!existsSync(REAL_UPSTREAM))("is installed in front of the pinned renderer", async () => {
    const workspace = await directory("guard-worker");
    const project = join(workspace, "project");
    await mkdir(project, { recursive: true });
    // A film that does not read: the worker gets as far as reading it, which it can
    // only do when the guard was installed and the pinned renderer was loaded.
    await writeFile(join(project, "film.html"), "<html><body>no viewport</body></html>", "utf8");
    const requestPath = join(workspace, "request.json");
    const responsePath = join(workspace, "response.json");
    await writeFile(requestPath, JSON.stringify({
      kind: "narralens.native_render_request@1.0",
      upstream_root: REAL_UPSTREAM,
      project_root: project,
      native_entry: "film.html",
      out_path: join(workspace, "media.mp4"),
      staging_root: workspace,
      width: 1920,
      height: 1080,
      fps: 30,
      workers: 1,
      samples: 1,
      shutter: 0.5,
    }), "utf8");

    const code = await new Promise<number | null>((resolvePromise) => {
      execFile(process.execPath, [renderWorkerPath(), requestPath, responsePath], {
        timeout: 120_000,
        windowsHide: true,
      }, (error) => {
        resolvePromise(error === null ? 0 : Number((error as { code: number }).code));
      });
    });

    expect(code).toBe(2);
    const response = JSON.parse(await readFile(responsePath, "utf8")) as { error?: { code?: string } };
    // The guard was in place: the refusal is about the film, not about the guard.
    expect(response.error?.code).toBe("FILM_DOCUMENT_INVALID");
  });
});
