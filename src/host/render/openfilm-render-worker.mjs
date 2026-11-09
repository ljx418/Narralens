import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The pinned native render worker.
 *
 * The upstream OpenFilm renderer is a module, not a command: `render(args, opts)` draws
 * the film in a headless browser and encodes the frames. Driving it means loading bytes
 * from a pinned upstream checkout, so the loading happens here — in a separate process
 * with a fixed argument vector — and not in the Host.
 *
 * Why a separate process at all:
 *
 * - The upstream spawns ffmpeg and Chromium. Those are children of this process, and a
 *   cancelled render has to be able to take the whole tree down. A child process makes
 *   that one signal instead of a tree walk.
 * - The upstream is third-party code with its own dependencies. If it throws, it throws
 *   in a process whose only job was to render, and the Host is still able to say what
 *   happened.
 *
 * What this worker will not do:
 *
 * - It never runs a shell. The argument vector is fixed: the request path and the
 *   response path, both handed over by the parent. Every other input is read from the
 *   request file and validated before it is used.
 * - It never renders anything outside the staging root the parent names. The film it
 *   renders and the file it writes are both checked to be inside it.
 * - It never loads upstream bytes it has not hashed. The digests come from the pin file
 *   next to this file, and every module in the render's import graph is checked before
 *   the first import happens.
 * - It never lets the renderer reach the network. The offline guard is loaded in front
 *   of the pinned host module, and the worker refuses to render when the guard did not
 *   take effect.
 */
const PIN_FILE = new URL("./openfilm-render-pin.json", import.meta.url);
const REQUEST_KIND = "narralens.native_render_request@1.0";
const RESPONSE_KIND = "narralens.native_render_response@1.0";
/** The marker the offline guard sets on the global object when it is in place. */
const GUARD_MARKER = "__narralensOfflineGuard";
/** The query the guard uses to reach the original module. */
const GUARD_QUERY = "?narralens-original";

const WORKER_DIRECTORY = dirname(fileURLToPath(import.meta.url));
/** The repository root, three levels up from `src/host/render`. */
const REPOSITORY_ROOT = resolve(WORKER_DIRECTORY, "..", "..", "..");

/** The response the parent reads. Written even when the render fails. */
function writeResponse(path, response) {
  writeFileSync(path, `${JSON.stringify({ kind: RESPONSE_KIND, ...response })}\n`, { encoding: "utf8", mode: 0o600 });
}

/** A path inside another path. Both are resolved first, so `..` cannot escape. */
function contained(root, path) {
  const base = resolve(root);
  const target = resolve(path);
  return target === base || target.startsWith(base + sep);
}

function isPlainFile(path) {
  try { return statSync(path).isFile(); }
  catch { return false; }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Removes host paths from a message.
 *
 * The upstream's errors name files. Those names are absolute paths on this machine, and
 * a failure reason that reaches a client must not carry them. The two roots the worker
 * knows are replaced by placeholders; everything else is left as it is, because a
 * message that has been emptied is a message that says nothing.
 */
function redact(message, roots) {
  let text = String(message ?? "");
  for (const [root, placeholder] of roots) {
    if (!root) continue;
    text = text.split(resolve(root)).join(placeholder);
    text = text.split(root).join(placeholder);
  }
  return text;
}

async function main() {
  const requestPath = process.argv[2];
  const responsePath = process.argv[3];
  if (!requestPath || !responsePath) {
    process.stderr.write("openfilm-render-worker: a request path and a response path are required\n");
    process.exit(2);
  }

  let request;
  try {
    request = JSON.parse(readFileSync(requestPath, "utf8"));
  } catch (error) {
    process.stderr.write(`openfilm-render-worker: the request file could not be read: ${String(error?.message ?? error)}\n`);
    process.exit(2);
    return;
  }

  if (request?.kind !== REQUEST_KIND) {
    writeResponse(responsePath, { ok: false, error: { code: "REQUEST_KIND_REJECTED", message: "the request is not a native render request" } });
    process.exit(2);
    return;
  }

  const stagingRoot = request.staging_root;
  const projectRoot = request.project_root;
  const outPath = request.out_path;
  const upstreamRoot = request.upstream_root;
  const nativeEntry = request.native_entry;
  const roots = [[stagingRoot, "<staging>"], [upstreamRoot, "<upstream>"]];

  const reject = (code, message) => {
    writeResponse(responsePath, { ok: false, error: { code, message: redact(message, roots) } });
    process.exit(2);
  };

  if (typeof stagingRoot !== "string" || !isAbsolute(stagingRoot)) reject("STAGING_ROOT_REJECTED", "the staging root must be an absolute path");
  if (typeof projectRoot !== "string" || !isAbsolute(projectRoot)) reject("PROJECT_ROOT_REJECTED", "the project root must be an absolute path");
  if (typeof outPath !== "string" || !isAbsolute(outPath)) reject("OUT_PATH_REJECTED", "the output path must be an absolute path");
  if (typeof upstreamRoot !== "string" || !isAbsolute(upstreamRoot)) reject("UPSTREAM_ROOT_REJECTED", "the upstream root must be an absolute path");
  if (!contained(stagingRoot, projectRoot)) reject("PROJECT_ROOT_OUTSIDE_STAGING", "the film is not inside the staging root");
  if (!contained(stagingRoot, outPath)) reject("OUT_PATH_OUTSIDE_STAGING", "the output file is not inside the staging root");
  if (contained(stagingRoot, upstreamRoot)) reject("UPSTREAM_INSIDE_STAGING", "the upstream must not be inside the staging root");
  if (typeof nativeEntry !== "string" || nativeEntry.length === 0) reject("NATIVE_ENTRY_REJECTED", "the film's entry document is missing");

  const filmPath = resolve(projectRoot, nativeEntry);
  if (!contained(projectRoot, filmPath) || !isPlainFile(filmPath)) {
    reject("FILM_DOCUMENT_MISSING", "the film's entry document is not there");
  }

  const width = Number(request.width);
  const height = Number(request.height);
  const fps = Number(request.fps);
  if (!Number.isSafeInteger(width) || width < 1) reject("WIDTH_REJECTED", "the requested width is not a whole number of pixels");
  if (!Number.isSafeInteger(height) || height < 1) reject("HEIGHT_REJECTED", "the requested height is not a whole number of pixels");
  if (!Number.isFinite(fps) || fps <= 0) reject("FPS_REJECTED", "the requested frame rate is not a positive number");

  // The pin first: nothing from the upstream is loaded before its bytes are checked.
  let pin;
  try {
    pin = JSON.parse(readFileSync(PIN_FILE, "utf8"));
  } catch (error) {
    reject("PIN_UNREADABLE", `the render pin could not be read: ${String(error?.message ?? error)}`);
    return;
  }

  const mismatched = [];
  for (const [relative, expected] of Object.entries(pin.loaded_module_sha256 ?? {})) {
    const path = resolve(upstreamRoot, relative);
    if (!contained(upstreamRoot, path)) { mismatched.push(relative); continue; }
    let actual;
    try { actual = sha256File(path); }
    catch { mismatched.push(relative); continue; }
    if (actual !== expected) mismatched.push(relative);
  }
  // The guard is ours, and it is pinned next to the upstream: a guard that was changed
  // without being re-pinned would be a guard nobody reviewed.
  for (const [relative, expected] of Object.entries(pin.guard_module_sha256 ?? {})) {
    const path = resolve(REPOSITORY_ROOT, relative);
    if (!contained(REPOSITORY_ROOT, path)) { mismatched.push(relative); continue; }
    let actual;
    try { actual = sha256File(path); }
    catch { mismatched.push(relative); continue; }
    if (actual !== expected) mismatched.push(relative);
  }
  const workerActual = sha256File(fileURLToPath(import.meta.url));
  if (workerActual !== pin.worker_sha256) mismatched.push("worker");

  if (mismatched.length > 0) {
    reject("UPSTREAM_PIN_MISMATCH", `the pinned render inputs are not intact: ${mismatched.join(", ")}`);
  }

  const mediaPolicy = await import(new URL("./media-process-policy.mjs", import.meta.url));
  mediaPolicy.installMediaProcessPolicy();

  // The guard goes in front of the pinned host module before the renderer is loaded.
  const hostUrl = pathToFileURL(resolve(upstreamRoot, "packages/openfilm/src/host.mjs")).href;
  const wrapperUrl = pathToFileURL(resolve(WORKER_DIRECTORY, pin.guard_wrapper_file)).href;
  const hooksUrl = pathToFileURL(resolve(WORKER_DIRECTORY, pin.guard_hooks_file)).href;
  process.env.NARRALENS_OPENFILM_ROOT = upstreamRoot;
  try {
    register(hooksUrl, { data: { host_url: hostUrl, wrapper_url: wrapperUrl, marker: GUARD_QUERY } });
  } catch (error) {
    reject("OFFLINE_GUARD_NOT_INSTALLED", `the offline guard could not be loaded: ${String(error?.message ?? error)}`);
    return;
  }

  let renderModule;
  let filmDocModule;
  try {
    renderModule = await import(pathToFileURL(resolve(upstreamRoot, pin.render_module)).href);
    filmDocModule = await import(pathToFileURL(resolve(upstreamRoot, pin.film_doc_module)).href);
  } catch (error) {
    reject("UPSTREAM_IMPORT_FAILED", `the pinned upstream could not be loaded: ${String(error?.message ?? error)}`);
    return;
  }
  if (typeof renderModule.render !== "function" || typeof filmDocModule.readFilmFile !== "function") {
    reject("UPSTREAM_SEAM_MISSING", "the pinned upstream does not export the render seam");
  }
  // The guard has to be in place, not merely loaded: the worker refuses to render a
  // film with a browser that may reach the network.
  if (globalThis[GUARD_MARKER]?.installed !== true) {
    reject("OFFLINE_GUARD_NOT_INSTALLED", "the offline guard did not take effect in front of the renderer");
  }

  // The film's own size decides the scale. The delivery has to come out at the exact
  // size that was asked for, so the size has to scale the stage exactly; a film that is
  // 1280 wide cannot become 1920 without a scale that would make 1080 into something
  // else, and pretending otherwise would deliver a film of a different shape.
  let stage;
  try {
    const read = filmDocModule.readFilmFile(readFileSync(filmPath, "utf8"));
    if (read?.doc == null) {
      reject("FILM_DOCUMENT_INVALID", `the film's edit does not read: ${(read?.problems ?? []).join("; ")}`);
      return;
    }
    stage = read.doc.stage ?? { w: 1920, h: 1080 };
  } catch (error) {
    reject("FILM_DOCUMENT_UNREADABLE", `the film's edit could not be read: ${String(error?.message ?? error)}`);
    return;
  }

  const factor = width / stage.w;
  if (!Number.isFinite(factor) || factor <= 0) {
    reject("SIZE_NOT_A_MULTIPLE", `the requested width ${width} does not scale the film's width ${stage.w}`);
  }
  // The height has to come out exactly as it was asked for. A film of a different shape
  // would have to be cropped or stretched to fit, and both change what the viewer sees.
  const scaledHeight = stage.h * factor;
  if (Math.abs(scaledHeight - height) > 0.5 || Math.round(scaledHeight) !== height) {
    reject("ASPECT_MISMATCH", `the requested height ${height} does not match the film's shape (${stage.w}x${stage.h})`);
  }

  const options = {
    root: projectRoot,
    out: outPath,
    fps,
    scale: factor,
    workers: 1,
    samples: 1,
    shutter: 0.5,
    format: {
      video: ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-threads", "1",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"],
      audio: ["-c:a", "aac", "-b:a", "192k", "-threads", "1"],
    },
    // The fast-seeking copies are not made. They are made by running ffmpeg over the
    // source videos, and they are a cache of the sources rather than part of the film.
    seekable: false,
  };

  const started = Date.now();
  let result;
  try {
    result = await renderModule.render([filmPath], options);
    const problems = mediaPolicy.nativeOutputProblems(result);
    if (problems.length > 0) throw new Error("native content validation failed");
  } catch (error) {
    writeResponse(responsePath, {
      ok: false,
      error: {
        code: error?.name === "UsageError" ? "RENDER_USAGE_REJECTED" : "RENDER_FAILED",
        message: redact(error?.message ?? String(error), roots),
      },
      elapsed_ms: Date.now() - started,
    });
    process.exit(1);
    return;
  }

  writeResponse(responsePath, {
    ok: true,
    out: outPath,
    lines: Array.isArray(result?.lines) ? result.lines.map((line) => redact(line, roots)) : [],
    stage: { w: stage.w, h: stage.h },
    scale: factor,
    elapsed_ms: Date.now() - started,
  });
  process.exit(0);
}

await main();
