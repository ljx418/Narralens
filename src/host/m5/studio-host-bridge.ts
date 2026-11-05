/**
 * The Studio bridge script (Wave 3 `04` §1).
 *
 * The upstream Studio reads `globalThis.openfilmHost` when its own modules load
 * (`packages/openfilm/studio/ui/src/lib/host.ts`). That is a hard ordering constraint:
 * the host has to exist *before* the Studio's deferred module scripts run, so the bridge
 * is a **classic** script placed at the end of the body — it runs while the document is
 * still being parsed, and the module scripts run after it.
 *
 * A module script would be too late, and the failure would be silent: the Studio would
 * simply have no host, and the page would look like an ordinary editor with no panel.
 *
 * The script is served by the Gateway from the Host's own process, so it carries no
 * secret: the panel reaches the Host through the Gateway's session cookie and the
 * Gateway's service surface, never through a Narralens Host bearer.
 */
export const STUDIO_HOST_BRIDGE_SCRIPT = `/* The Narralens panel's bridge into the pinned OpenFilm Studio. */
(function () {
  "use strict";
  /* The target project id is read *now*, before the Studio's own modules run: the Studio
     rewrites the address when it routes to a project, and it does not carry an unknown
     query parameter along. The panel therefore gets the id from here, not from the URL it
     might find later. */
  window.narralensTarget = new URLSearchParams(window.location.search).get("target") || "";

  var mount = document.createElement("div");
  mount.id = "narralens-m5-panel";
  mount.setAttribute("data-studio-host-panel", "");
  mount.setAttribute("role", "region");
  mount.setAttribute("aria-label", "Narralens 导演面板");
  var attach = function () {
    if (document.body && !document.body.contains(mount)) document.body.appendChild(mount);
  };
  attach();
  document.addEventListener("DOMContentLoaded", attach);

  /* The pinned Studio's timeline scroller is programmatically scrollable but carries no
     focus target. The integration owns the composed page, so it closes that keyboard
     accessibility seam without forking the pinned upstream. */
  var repairScrollableRegions = function () {
    var timeline = document.querySelector(".tl-scroll");
    if (timeline && !timeline.hasAttribute("tabindex")) {
      timeline.setAttribute("tabindex", "0");
      timeline.setAttribute("aria-label", "原生时间线滚动区域");
    }
  };
  document.addEventListener("DOMContentLoaded", repairScrollableRegions);
  new MutationObserver(repairScrollableRegions).observe(document.documentElement, { childList: true, subtree: true });

  var listeners = [];
  var panelListeners = [];
  var panelState = { open: true, width: 380, assetsOpen: false, assetsBottom: 0 };
  var notify = function () {
    for (var index = 0; index < panelListeners.length; index += 1) {
      try { panelListeners[index](panelState); } catch (error) { /* a listener must not break the panel */ }
    }
  };

  /* The Studio asks the app what is selected, and tells the app when it changes. */
  var host = {
    version: 1,
    name: "Narralens",
    onSelection: function (selection) {
      var event = new CustomEvent("narralens:studio-selection", { detail: selection });
      window.dispatchEvent(event);
    },
    onCommand: function (listener) {
      listeners.push(listener);
    },
    panel: {
      label: "Narralens",
      open: true,
      width: 380,
      setOpen: function (open) { panelState.open = Boolean(open); notify(); },
      setWidth: function (width) { panelState.width = Number(width) || 0; notify(); },
      onChange: function (listener) { panelListeners.push(listener); listener(panelState); },
    },
  };
  window.openfilmHost = host;

  /* The panel asks the Studio to show something, through the seam the Studio offered. */
  window.narralensStudio = {
    command: function (command) {
      for (var index = 0; index < listeners.length; index += 1) {
        try { listeners[index](command); } catch (error) { /* a command must not break the panel */ }
      }
    },
    panel: function () { return panelState; },
  };

  /* The panel itself is a module: it may use the module syntax the rest of the app uses. */
  var style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "/narralens/panel.css";
  document.head.appendChild(style);

  var script = document.createElement("script");
  script.type = "module";
  script.src = "/narralens/panel.js";
  script.onerror = function () {
    mount.textContent = "Narralens 面板未构建（dist/m5/narralens-panel.js 缺失）";
    mount.setAttribute("data-narralens-panel", "missing");
  };
  document.head.appendChild(script);
})();
`;
