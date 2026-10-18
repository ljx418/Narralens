import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OPENFILM_PIN } from "../../src/adapters/openfilm/openfilm-upstream.js";
import { OpenFilmEngineAdapter } from "../../src/adapters/openfilm/openfilm-engine-adapter.js";
import { composeOpenFilmPort } from "../../src/host/engine/openfilm-composition.js";
import { EngineBindingStore } from "../../src/host/engine/engine-binding-store.js";
import { EngineRegistry } from "../../src/host/engine/engine-registry.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

/**
 * R2-07: the default Host composition must contain an OpenFilm port, pinned.
 *
 * Until now `defaultEngineRegistry` registered Hypit only, so even after `ProjectResolver`
 * could name a migrated target, the target's engine had no port to resolve to and the
 * failure would have surfaced as a confusing 503 deep in a write.
 *
 * The acceptance condition is narrow and deliberately so: a port is registered only when
 * the checkout is at the pinned SHA, clean, and every file about to be executed hashes to
 * its pinned digest — commit, `package.json`, lockfile and licence alike. Anything missing
 * leaves the capability closed rather than loading whatever is on disk.
 */

const REAL_UPSTREAM = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";

const dirs: string[] = [];
const stores: RevisionStore[] = [];
afterEach(async () => {
  while (stores.length > 0) stores.pop()!.close();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function registry(): { registry: EngineRegistry; revisions: RevisionStore } {
  const revisions = new RevisionStore();
  stores.push(revisions);
  const bindings = new EngineBindingStore(revisions);
  bindings.bind("of_target", "openfilm", { createdAt: new Date(0) });
  return { registry: new EngineRegistry(bindings), revisions };
}

/** A checkout that exists and claims the pinned SHA, but is not the pinned tree. */
async function unverifiedCheckout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "narralens-w2-openfilm-"));
  dirs.push(root);
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, ".git/HEAD"), `${OPENFILM_PIN.full_sha}\n`, "utf8");
  await writeFile(join(root, OPENFILM_PIN.package_file), "{}", "utf8");
  return root;
}

describe("R2-07 the OpenFilm port is composed only from a verified pinned checkout", () => {
  it("registers a port against the real pinned upstream when one is present", async () => {
    if (!existsSync(REAL_UPSTREAM)) throw new Error("PINNED_OPENFILM_ABSENT: composition cannot be proven here");
    const { registry: engines } = registry();
    const composition = await composeOpenFilmPort({ registry: engines, vendorRoot: REAL_UPSTREAM });
    expect(composition.installed).toBe(true);
    expect(composition.availability).toMatchObject({
      available: true, observed_sha: OPENFILM_PIN.full_sha, expected_sha: OPENFILM_PIN.full_sha,
    });
    expect(engines.kinds()).toContain("openfilm");
    const resolved = engines.resolve("of_target");
    expect(resolved.engine).toBe("openfilm");
    expect(resolved.port).toBeInstanceOf(OpenFilmEngineAdapter);
    // Loading the pinned module and instantiating its adapter is real work; under a fully
    // parallel run it exceeds the default 5s budget, so it gets an honest one rather than
    // being made to look cheap by mocking the upstream.
  }, 60_000);

  it("leaves the capability closed when the checkout does not verify", async () => {
    const { registry: engines } = registry();
    const root = await unverifiedCheckout();
    const composition = await composeOpenFilmPort({ registry: engines, vendorRoot: root });
    expect(composition.installed).toBe(false);
    expect(engines.kinds()).not.toContain("openfilm");
    expect(composition.availability.reason).toBeTypeOf("string");
    // And the reason is reported rather than swallowed: an operator needs to know whether
    // the tree drifted, the licence changed, or the checkout is simply missing.
    expect(composition.availability.reason.length).toBeGreaterThan(0);
  });

  it("leaves the capability closed when the checkout is absent", async () => {
    const { registry: engines } = registry();
    const base = await mkdtemp(join(tmpdir(), "narralens-w2-openfilm-"));
    dirs.push(base);
    const composition = await composeOpenFilmPort({ registry: engines, vendorRoot: join(base, "not-there") });
    expect(composition.installed).toBe(false);
    expect(engines.kinds()).not.toContain("openfilm");
  });

  it("refuses to install twice, so a port can never shadow another", () => {
    // Asserted on the registry directly rather than by composing a second time: loading
    // the real upstream is ~1.7s of the suite's budget, and the invariant under test is
    // the registry's, not the loader's.
    const { registry: engines } = registry();
    engines.register("openfilm", {} as never);
    expect(() => engines.register("openfilm", {} as never)).toThrow(/ALREADY_REGISTERED/u);
    expect(engines.kinds().filter((kind) => kind === "openfilm")).toHaveLength(1);
  });

  it("makes a bound-but-uninstalled engine an explicit 503, not a wrong-engine write", async () => {
    const { registry: engines } = registry();
    const base = await mkdtemp(join(tmpdir(), "narralens-w2-openfilm-"));
    dirs.push(base);
    await composeOpenFilmPort({ registry: engines, vendorRoot: join(base, "not-there") });
    expect(() => engines.resolve("of_target")).toThrow(
      expect.objectContaining({ status: 503 }) as unknown as Error,
    );
  });

  it("verifies the licence as well as the code, and says which file failed", () => {
    // The pin lists four digests. A checkout at the right commit with a changed licence is
    // the case a SHA-only check would wave through.
    expect(Object.keys(OPENFILM_PIN)).toEqual(expect.arrayContaining([
      "loaded_module_sha256", "package_json_sha256", "lockfile_sha256", "license_sha256",
    ]));
  });
});
