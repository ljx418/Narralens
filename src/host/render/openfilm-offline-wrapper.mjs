import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The offline guard for the pinned native renderer.
 *
 * The upstream renderer draws the film in a headless browser, and a browser can reach
 * the network. A render of a film whose pages mention an outside address would fetch
 * it — and a delivery must not depend on what the outside world answered, must not
 * spend the network, and must not leak the fact that a render is happening.
 *
 * The upstream's own `FilmPage.open` already knows how to refuse: it takes `offline`
 * and a list of origins that are allowed, and it records every request it blocks as a
 * problem with the page. What the upstream's `render()` does *not* do is pass those
 * options on — it calls `FilmPage.open` itself, deep inside, with only a scale.
 *
 * So the guard is a wrapper: the same module, with `FilmPage.open` and `launch` wrapped.
 * The upstream's bytes are never edited; the wrapper is a separate module that the
 * pinned `host.mjs` is replaced by at load time (see `openfilm-offline-hooks.mjs`).
 *
 * Three layers, because one layer has holes:
 *
 * 1. `FilmPage.open` is called with `offline: true` and an empty allow list, so the page
 *    may load only from its own origin and every other request is blocked *and
 *    recorded* — a film that reaches outside fails visibly instead of quietly.
 * 2. The browser is launched with a proxy that points at a closed port and a bypass
 *    list that keeps loopback. Anything that is not the film's own server therefore has
 *    nowhere to go, including a WebSocket to an address that is written as a number.
 * 3. Service workers are blocked in the browser context, so a page cannot install one
 *    and fetch through it.
 *
 * The wrapper fails closed: if it cannot find the upstream it refuses to load, and the
 * worker refuses to render when the guard did not take effect.
 */

/** The marker the worker looks for to know the guard is in place. */
export const GUARD_MARKER = "__narralensOfflineGuard";

/** The query the guard uses to reach the original module. */
const MARKER = "?narralens-original";

/**
 * The flags the browser is launched with.
 *
 * The proxy is the load-bearing one: every request that is not loopback goes to a
 * closed port, so it fails without leaving the machine. The resolver rule is the second
 * layer for the same reason, and the rest turn off the background traffic a browser
 * starts on its own.
 */
export const BLOCKING_FLAGS = Object.freeze([
  "--proxy-server=http://127.0.0.1:1",
  "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-client-side-phishing-detection",
  "--disable-default-apps",
  "--disable-domain-reliability",
  "--disable-sync",
  "--disable-breakpad",
  "--metrics-recording-only",
  "--no-default-browser-check",
  "--no-first-run",
  "--no-pings",
  "--safebrowsing-disable-auto-update",
  "--disable-features=ServiceWorker,BackgroundNetworking,OptimizationHints,MediaRouter,AutofillServerCommunication,CertificateTransparencyComponentUpdater,InterestFeedContentSuggestions,Translate",
]);

const upstreamRoot = process.env.NARRALENS_OPENFILM_ROOT;
if (typeof upstreamRoot !== "string" || upstreamRoot.length === 0) {
  throw new Error("NARRALENS_OPENFILM_ROOT is not set; the offline guard refuses to load");
}

const host = await import(`${pathToFileURL(join(upstreamRoot, "packages/openfilm/src/host.mjs")).href}${MARKER}`);

export const SEEK_INSIDE_FRAME = host.SEEK_INSIDE_FRAME;
export const FILM_CLOCK = host.FILM_CLOCK;
export const HOST_FLAG = host.HOST_FLAG;
export const folderFiles = host.folderFiles;
export const frameDuration = host.frameDuration;
export const serve = host.serve;
export const holdPages = host.holdPages;
export const injectFirst = host.injectFirst;
export const closeBrowsers = host.closeBrowsers;
export const FrameError = host.FrameError;

/**
 * The browser, with the contexts it makes closed to the network.
 *
 * `serviceWorkers: "block"` is what stops a page from installing a worker and fetching
 * through it: a service worker's requests do not pass the context's route handler, so
 * the route alone would not be enough.
 */
function guardBrowser(browser) {
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => await originalNewContext({
    ...options,
    serviceWorkers: "block",
  });
  return browser;
}

/**
 * Launch the browser, closed to the network.
 *
 * The upstream's `launch` takes `args`, and Chromium takes the last of a repeated flag,
 * so the guard's flags are appended and win.
 */
export async function launch(options = {}) {
  const browser = await host.launch({
    ...options,
    args: [...(options.args ?? []), ...BLOCKING_FLAGS],
  });
  return guardBrowser(browser);
}

/**
 * The page, opened offline.
 *
 * The options the caller passed are kept, and the two that decide the network are
 * forced: the page may load only from its own origin, and every request to another
 * origin is blocked and recorded as a problem with the page.
 */
export const FilmPage = host.FilmPage;

const originalOpen = host.FilmPage.open;
host.FilmPage.open = (browser, origin, entry, options = {}) =>
  originalOpen(browser, origin, entry, { ...options, offline: true, network: { allow: [] } });

/** The guard is in place. The worker refuses to render when this is missing. */
globalThis[GUARD_MARKER] = { installed: true, upstream_root: upstreamRoot };
