/**
 * The loader hooks that put the offline guard in front of the pinned renderer.
 *
 * The guard is a separate module (`openfilm-offline-wrapper.mjs`). This file makes the
 * pinned `host.mjs` resolve to it, without touching a byte of the upstream: the hooks
 * answer the resolution, the loader reads the upstream's own bytes for the guard to
 * wrap, and the guard's own import of the upstream carries a marker so that it is not
 * redirected into itself.
 *
 * The hooks run in their own thread and know only what `register` gave them: the URL of
 * the pinned module to replace, the URL of the guard, and the marker. They decide
 * nothing else, and they change nothing else: a module that is not the pinned one is
 * resolved and loaded exactly as Node would.
 */

let state = null;

export async function initialize(data) {
  state = data;
}

export async function resolve(specifier, context, nextResolve) {
  if (state === null) return await nextResolve(specifier, context);

  const marker = state.marker;
  if (typeof specifier === "string" && specifier.includes(marker)) {
    // The guard's own import of the upstream: the marker is dropped and the upstream's
    // real URL is resolved, so the guard wraps the pinned module itself.
    const base = specifier.slice(0, specifier.indexOf(marker));
    const resolved = await nextResolve(base, context);
    return { url: resolved.url, format: resolved.format, shortCircuit: true };
  }

  const resolved = await nextResolve(specifier, context);
  if (resolved.url === state.host_url) {
    return { url: state.wrapper_url, format: "module", shortCircuit: true };
  }
  return resolved;
}

export async function load(url, context, nextLoad) {
  return await nextLoad(url, context);
}
