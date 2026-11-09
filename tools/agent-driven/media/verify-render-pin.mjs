import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The render pin probe.
 *
 * It reports whether the bytes a render would execute are the bytes that were pinned:
 * the upstream checkout at its commit and clean, the eight modules of the render's
 * import graph matching their digests, and the worker that loads them matching its own.
 *
 * An absent checkout is an environment fact and is reported as `NOT_RUN` with exit 0 —
 * it is neither a pass nor a failure. A checkout that is present and does not match is
 * a real finding and exits 1, because "the bytes we execute are not the bytes we froze"
 * is exactly what this probe exists to catch.
 *
 *   pnpm exec tsx tools/agent-driven/media/verify-render-pin.mjs [--upstream <dir>]
 */

const upstreamRoot = resolve(
  process.argv.includes("--upstream")
    ? process.argv[process.argv.indexOf("--upstream") + 1]
    : process.env.NARRALENS_OPENFILM_VENDOR
      ?? "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm",
);

console.log(`upstream_root=${upstreamRoot}`);

if (!existsSync(upstreamRoot)) {
  console.log("status=NOT_RUN");
  console.log("reason=PINNED_OPENFILM_ABSENT: no checkout at this path; nothing was probed or claimed");
  process.exitCode = 0;
} else {
  await probe();
}

async function probe() {
  // The production module is TypeScript with `.js` import specifiers, so it is loaded
  // through tsx exactly as the modules that use it load it.
  const { RENDER_PIN, verifyRenderPin } = await import("tsx/esm").then(
    async () => import("../../../src/host/render/upstream-pin.ts"),
  );

  console.log(`expected_sha=${RENDER_PIN.upstream_sha}`);
  console.log(`worker_sha256=${RENDER_PIN.worker_sha256}`);

  const verdict = await verifyRenderPin(upstreamRoot);
  console.log(`ok=${verdict.ok}`);
  console.log(`reason=${verdict.reason}`);
  console.log(`checked=${JSON.stringify(verdict.checked)}`);
  console.log(`missing=${JSON.stringify(verdict.missing)}`);
  console.log(`mismatched=${JSON.stringify(verdict.mismatched)}`);

  if (verdict.ok) {
    console.log("status=OK: the pinned upstream and the worker match their digests");
    process.exitCode = 0;
    return;
  }
  console.log("status=FAIL: the pinned render inputs are not intact; the renderer stays un-composed");
  process.exitCode = 1;
}
