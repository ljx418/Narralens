/**
 * The rules of the offline guard.
 *
 * They are in their own module, apart from the guard that installs them, for two
 * reasons: the guard has to load the pinned upstream (which needs the upstream's
 * dependencies), and these rules have to be checkable without it. A test can hand this
 * module a browser that is not a browser and see that the restrictions are really
 * applied — that the context is closed to service workers, that every WebSocket is
 * closed at the door, and that the browser is launched with flags that leave it no way
 * out.
 *
 * The rules are deliberately in one place, because they are one decision: a render may
 * load the film it was given, and nothing else.
 */

/**
 * The flags the browser is launched with.
 *
 * The proxy is the load-bearing one: every request that is not loopback goes to a
 * closed port, so it fails without leaving the machine. The resolver rule is the second
 * layer for the same reason, and the rest turn off the background traffic a browser
 * starts on its own.
 *
 * The last two are about the traffic the proxy does not carry: QUIC runs over UDP, and
 * WebRTC can pick a UDP path of its own. Both are turned off explicitly, because a
 * proxy that cannot see the traffic cannot stop it.
 */
export const BLOCKING_FLAGS = Object.freeze([
  "--proxy-server=http://127.0.0.1:1",
  "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  "--disable-quic",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
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

/**
 * The options a page is opened with.
 *
 * The page may load only from its own origin; every other request is blocked by the
 * upstream's own route handler and recorded as a problem with the page.
 */
export function guardedPageOptions(options = {}) {
  return { ...options, offline: true, network: { allow: [] } };
}

/**
 * The options a browser context is made with.
 *
 * `serviceWorkers: "block"` is what stops a page from installing a worker and
 * fetching through it: a service worker's requests do not pass the context's route
 * handler, so the route alone would not be enough.
 */
export function guardedContextOptions(options = {}) {
  return { ...options, serviceWorkers: "block" };
}

/** The flags a browser is launched with, after the caller's own. */
export function guardedLaunchArgs(args = []) {
  return [...args, ...BLOCKING_FLAGS];
}

/**
 * A browser whose contexts are closed to the network.
 *
 * Two things are done to every context it makes:
 *
 * - Service workers are blocked, so that nothing can fetch through one.
 * - WebSockets are closed at the browser's own door. A WebSocket is not an HTTP
 *   request: it does not pass the route handler that blocks pages from leaving their
 *   origin, and a page that opened one to a loopback service would have a channel the
 *   page's own rules do not cover. Every socket is closed instead of being routed.
 */
export function guardBrowser(browser) {
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => {
    const context = await originalNewContext(guardedContextOptions(options));
    if (context === null || context === undefined || typeof context.routeWebSocket !== "function") {
      await context?.close?.();
      throw new Error("The browser cannot enforce the WebSocket guard");
    }
    await context.routeWebSocket("**/*", (socket) => { void socket.close(); });
    return context;
  };
  return browser;
}
