import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
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
  for (const [relative, expected] of Object.entries({...pin.guard_module_sha256,...pin.implementation_module_sha256})) {
    const path = resolve(REPOSITORY_ROOT, relative);
    if (!contained(REPOSITORY_ROOT, path)) { mismatched.push(relative); continue; }
    let actual;
    try { actual = sha256File(path); }
    catch { mismatched.push(relative); continue; }
    if (actual !== expected) mismatched.push(relative);
  }
  if(!pin.implementation_module_sha256?.['src/host/render/native-subtitle-burn-source.mjs'])mismatched.push('native-subtitle-burn-source');
  if(!pin.loaded_module_sha256?.['packages/openfilm/studio/server/captions.mjs']||!pin.loaded_module_sha256?.['packages/openfilm/studio/server/film-subtitle.mjs'])mismatched.push('native-captions-closure');
  const workerActual = sha256File(fileURLToPath(import.meta.url));
  if (workerActual !== pin.worker_sha256) mismatched.push("worker");

  if (mismatched.length > 0) {
    reject("UPSTREAM_PIN_MISMATCH", `the pinned render inputs are not intact: ${mismatched.join(", ")}`);
  }

  // Native transcript reads may consult OPENFILM_HOME for links. This attempt owns
  // its own namespace; HOME itself is never changed or used as a writable run root.
  const privateHome=resolve(stagingRoot,'native-home');
  try{
    if(realpathSync(stagingRoot)!==resolve(stagingRoot)||realpathSync(projectRoot)!==resolve(projectRoot))reject('STAGING_ROOT_REJECTED','native staging must be canonical');
    mkdirSync(privateHome,{mode:0o700});process.env.OPENFILM_HOME=privateHome;process.env.OPENFILM_NO_UPDATE_CHECK='1';
  }catch(error){reject('NATIVE_HOME_UNAVAILABLE','the private native metadata root could not be created');}
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
  let nativeDoc;
  try {
    const read = filmDocModule.readFilmFile(readFileSync(filmPath, "utf8"));
    if (read?.doc == null) {
      reject("FILM_DOCUMENT_INVALID", `the film's edit does not read: ${(read?.problems ?? []).join("; ")}`);
      return;
    }
    nativeDoc=read.doc;
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

  let renderPath=filmPath;
  try{
    const captions=await import(pathToFileURL(resolve(upstreamRoot,'packages/openfilm/studio/server/captions.mjs')).href);
    const nativeSubtitles=await import(pathToFileURL(resolve(upstreamRoot,'packages/openfilm/studio/server/film-subtitle.mjs')).href);
    if(typeof captions.subtitlesForExport!=='function'||typeof captions.clipCues!=='function'||typeof nativeSubtitles.parseFilmSubtitleStyle!=='function')throw new Error('fixed native subtitle seam absent');
    const data=await captions.subtitlesForExport(projectRoot);
    // Match the exact JSON domain the original Studio export serializes into its page.
    const cues=JSON.parse(JSON.stringify(data.cues)),style=JSON.parse(JSON.stringify(data.style));
    if(!Array.isArray(cues)||!style||typeof style.on!=='boolean')throw new Error('invalid native caption facts');
    const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
    let plan;
    try{plan=JSON.parse(readFileSync(resolve(projectRoot,'draft-plan.json'),'utf8'));}
    catch(error){if(error?.code!=='ENOENT')throw new Error('invalid native draft source plan');}
    if(plan!==undefined){
      if(plan.format!=='narralens.native-draft-plan@1'||plan.timing_basis!=='storyboard_plan'||plan.fps?.num!==30||plan.fps?.den!==1||!Array.isArray(plan.storyboard?.shots))throw new Error('invalid planned native subtitle facts');
      const lines=[];let frame=0;
      for(const shot of plan.storyboard.shots){
        if(!Number.isSafeInteger(shot.duration_frames)||shot.duration_frames<=0||typeof shot.caption!=='string')throw new Error('invalid planned cue interval');
        const startMs=Math.round(frame*1000/30);frame+=shot.duration_frames;
        if(!Number.isSafeInteger(frame))throw new Error('invalid planned frame total');
        if(shot.caption)lines.push({text:shot.caption.replace(/\s+/g,' ').trim(),startMs,endMs:Math.round(frame*1000/30)});
      }
      if(frame!==request.frame_count)throw new Error('source frame count does not match the planned native film');
      let expected=[];
      if(lines.length){
        const voice=nativeDoc.tracks.flatMap(track=>track.clips).find(clip=>clip.id==='narration');
        if(!voice||filmDocModule.clipKind(voice.src)!=='sound'||!/^assets\/vo\/[A-Za-z0-9_.-]+$/.test(voice.src)||voice.time!=null||(voice.at??0)!==0||(voice.speed??1)!==1)throw new Error('the complete planned narration is not present');
        const transcripts=await import(pathToFileURL(resolve(upstreamRoot,'packages/openfilm/studio/server/transcripts.mjs')).href);
        const transcript=await transcripts.readTranscript(projectRoot,voice.src);
        if(!transcript||transcript.cut!==true||transcript.lines.length!==lines.length||lines.some((line,i)=>line.text!==transcript.lines[i]?.text||line.startMs!==transcript.lines[i]?.startMs||line.endMs!==transcript.lines[i]?.endMs))throw new Error('the planned source transcript is missing or changed');
        const derived=await import(pathToFileURL(resolve(upstreamRoot,'packages/openfilm/studio/server/derived.mjs')).href);
        const media=await derived.probe(projectRoot,voice.src),seconds=media.duration;
        // Match the existing ceil-to-source-frame model without stretching/trimming
        // the real recording. A subframe tail is transformed by the native span logic.
        if(!Number.isFinite(seconds)||seconds<=(frame-1)/30-0.000001||seconds>frame/30+0.000001)throw new Error('narration duration differs from verified source frames');
        const span=filmDocModule.clipSpan(voice,seconds);
        expected=captions.clipCues(lines,{fromMs:span.from*1000,startMs:(voice.at??0)*1000,durMs:span.length*1000,speed:span.speed},{cut:true});
      }
      if(expected.length!==cues.length||expected.some((c,i)=>c.text!==cues[i]?.text||Math.abs(c.startMs-cues[i]?.startMs)>1||Math.abs(c.durMs-cues[i]?.durMs)>1))throw new Error('planned native captions were not reproduced');
      const rawStyle=JSON.parse(readFileSync(resolve(projectRoot,'.film/subtitles.json'),'utf8'));
      if(canonical(rawStyle)!==canonical(nativeSubtitles.parseFilmSubtitleStyle(rawStyle))||canonical(style)!==canonical(rawStyle))throw new Error('native project subtitle style was not preserved');
    }
    if(style.on&&cues.length){
      if(fps!==30||!Number.isSafeInteger(request.frame_count)||request.frame_count<=0)throw new Error('native subtitle burn requires verified source frames at 30fps');
      const helper=await import(new URL('./native-subtitle-burn-source.mjs',import.meta.url));
      const wrapped=helper.buildPinnedNativeSubtitleBurnSource({width:stage.w,height:stage.h,frame_count:request.frame_count,cues,style,subtitle_module_bytes:readFileSync(resolve(upstreamRoot,'packages/openfilm/studio/server/film-subtitle.mjs'))});
      let current=projectRoot;
      for(const name of ['.film','cache']){
        current=resolve(current,name);try{mkdirSync(current,{mode:0o700});}catch(error){if(error?.code!=='EEXIST')throw error;}
        if(!lstatSync(current).isDirectory()||lstatSync(current).isSymbolicLink()||realpathSync(current)!==current)throw new Error('unsafe native subtitle cache');
      }
      // Reserved per-attempt directory: never overwrite source or an old attempt's cache.
      mkdirSync(resolve(current,'narralens-subtitle-burn'),{mode:0o700});
      for(const file of wrapped.files){const target=resolve(projectRoot,file.relative_path);if(!contained(resolve(current,'narralens-subtitle-burn'),target))throw new Error('invalid subtitle wrapper path');writeFileSync(target,file.bytes,{flag:'wx',mode:0o600});}
      renderPath=resolve(projectRoot,wrapped.entry);
    }
  }catch(error){reject('NATIVE_SUBTITLE_PREPARATION_FAILED',String(error?.message??'native subtitle preparation failed'));}

  const started = Date.now();
  let result;
  try {
    result = await renderModule.render([renderPath], options);
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
