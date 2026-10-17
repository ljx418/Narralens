import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPinnedOpenFilmUpstream, openFilmAvailability, OPENFILM_PIN, verifyPinnedFiles,
} from "../../src/adapters/openfilm/openfilm-upstream.js";
import productionLock from "../../contracts/openfilm-upstream-lock.json" with { type: "json" };
import spikeLock from "../../spikes/openfilm-m1b/upstream-lock.json" with { type: "json" };

/**
 * M-04 (external review): a pinned commit is not proof of the bytes that will execute.
 *
 * The loader used to check `.git/HEAD` only, so a checkout at the right commit with a
 * locally modified `film.mjs` still loaded the modified code while `engine_upstream_sha`
 * claimed the pinned one.
 *
 * These tests run entirely on synthetic checkouts under /tmp; no real upstream tree is
 * touched. A synthetic tree can never satisfy the real digest pins, so it proves the
 * refusal path rather than the acceptance path; the acceptance path is covered by the real
 * upstream probe.
 */

const copies: string[] = [];
afterEach(async () => { await Promise.all(copies.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

/** Build a checkout whose digests all match the pin, so only one thing can be wrong at a time. */
async function syntheticCheckout(mutate: (root: string) => Promise<void> = async () => undefined): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "narralens-openfilm-lock-"));
  copies.push(root);
  const { createHash } = await import("node:crypto");
  const write = async (relative: string, contents: string): Promise<void> => {
    const path = resolve(root, relative);
    await rm(path, { force: true });
    await (await import("node:fs/promises")).mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  };
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");

  const moduleBody = (name: string) => `export const ${name} = () => undefined;\n`;
  for (const [relative, digest] of Object.entries(OPENFILM_PIN.loaded_module_sha256)) {
    void digest;
    await write(relative, moduleBody("placeholder"));
  }
  await write(OPENFILM_PIN.package_file, "package-json");
  await write(OPENFILM_PIN.lockfile_file, "lockfile");
  await write(OPENFILM_PIN.license_file, "license");

  await mutate(root);
  void sha;
  return root;
}

async function checkoutWithPinnedHead(): Promise<string> {
  const root = await syntheticCheckout();
  await mkdir(resolve(root, ".git"), { recursive: true });
  await writeFile(resolve(root, ".git/HEAD"), `${OPENFILM_PIN.full_sha}\n`, "utf8");
  return root;
}

async function withFakeGit(body: string, run: (root: string) => Promise<void>): Promise<void> {
  const bin = await mkdtemp(resolve(tmpdir(), "narralens-fake-git-"));
  copies.push(bin);
  const git = resolve(bin, "git");
  await writeFile(git, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(git, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try { await run(await checkoutWithPinnedHead()); }
  finally { process.env.PATH = previous; }
}

describe("M-04 pinned OpenFilm checkout verification", () => {
  it("pins every file the loader is about to execute, plus package, lock and licence", () => {
    const files = Object.keys(OPENFILM_PIN.loaded_module_sha256);
    expect(files).toContain("packages/openfilm/studio/server/film.mjs");
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const [relative, digest] of Object.entries(OPENFILM_PIN.loaded_module_sha256)) {
      expect(digest, relative).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(OPENFILM_PIN.package_json_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(OPENFILM_PIN.lockfile_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(OPENFILM_PIN.license_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps the production lock consistent with the M1B recorded upstream lock", () => {
    expect(OPENFILM_PIN.full_sha).toBe(spikeLock.full_sha);
    expect(OPENFILM_PIN.full_sha).toBe(productionLock.full_sha);
    expect(OPENFILM_PIN.package_json_sha256).toBe(spikeLock.package_json_sha256);
    expect(OPENFILM_PIN.lockfile_sha256).toBe(spikeLock.lockfile_sha256);
    expect(OPENFILM_PIN.license_sha256).toBe(spikeLock.license_sha256);
    expect(OPENFILM_PIN.package).toBe(spikeLock.package);
    expect(OPENFILM_PIN.license).toBe(spikeLock.license);
    expect(OPENFILM_PIN.full_sha).toMatch(/^[a-f0-9]{40}$/u);
  });

  it("refuses a checkout with no git HEAD", async () => {
    const root = await syntheticCheckout();
    const availability = await openFilmAvailability(root);
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/git HEAD/u);
  });

  it("fails closed when git status cannot be executed", async () => {
    const previous = process.env.PATH;
    process.env.PATH = "/definitely/missing";
    try {
      const availability = await openFilmAvailability(await checkoutWithPinnedHead());
      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(/cannot verify.*clean/u);
      expect(availability.checked).not.toContain("git_clean");
    } finally { process.env.PATH = previous; }
  });

  it("fails closed when git status exits non-zero", async () => {
    await withFakeGit("exit 7", async (root) => {
      const availability = await openFilmAvailability(root);
      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(/cannot verify.*clean/u);
    });
  });

  it("fails closed when git status times out", async () => {
    await withFakeGit("/bin/sleep 1", async (root) => {
      const availability = await openFilmAvailability(root, 10);
      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(/cannot verify.*clean/u);
    });
  });

  it("rejects a tracked dirty checkout and records git_clean only after a successful check", async () => {
    await withFakeGit("printf ' M packages/openfilm/studio/server/film.mjs\\n'", async (root) => {
      const dirty = await openFilmAvailability(root);
      expect(dirty.available).toBe(false);
      expect(dirty.reason).toMatch(/local modifications/u);
      expect(dirty.checked).toContain("git_clean");
    });
    await withFakeGit("exit 0", async (root) => {
      const clean = await openFilmAvailability(root);
      expect(clean.available).toBe(false);
      expect(clean.checked).toContain("git_clean");
      expect(clean.reason).toMatch(/not intact/u);
    });
  });

  it("refuses when the seam module was tampered with", async () => {
    const root = await syntheticCheckout();
    const clean = await verifyPinnedFiles(root);
    expect(clean.ok).toBe(false);
    await writeFile(resolve(root, "packages/openfilm/studio/server/film.mjs"),
      "export const readProjectFilm = () => ({});\n", "utf8");
    const tampered = await verifyPinnedFiles(root);
    expect(tampered.ok).toBe(false);
    expect(tampered.mismatched).toContain("packages/openfilm/studio/server/film.mjs");
    expect(tampered.reason).toMatch(/digest mismatch packages\/openfilm\/studio\/server\/film\.mjs/u);
  });

  it("refuses when any other loaded module, package, lock or licence changes", async () => {
    for (const relative of [...Object.keys(OPENFILM_PIN.loaded_module_sha256),
      OPENFILM_PIN.package_file, OPENFILM_PIN.lockfile_file, OPENFILM_PIN.license_file]) {
      const root = await syntheticCheckout();
      await writeFile(resolve(root, relative), "tampered", "utf8");
      const verdict = await verifyPinnedFiles(root);
      expect(verdict.ok, relative).toBe(false);
      expect([...verdict.mismatched, ...verdict.missing], relative).toContain(relative);
    }
  });

  it("reports a missing pinned file as missing rather than as a digest mismatch", async () => {
    const root = await syntheticCheckout();
    await rm(resolve(root, OPENFILM_PIN.lockfile_file));
    const verdict = await verifyPinnedFiles(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toContain(OPENFILM_PIN.lockfile_file);
    expect(verdict.reason).toMatch(/missing pnpm-lock\.yaml/u);
  });

  it("refuses to load rather than loading a module whose digest does not match", async () => {
    const root = await syntheticCheckout();
    await expect(createPinnedOpenFilmUpstream(root)).rejects.toMatchObject({
      status: 503, code: "ENGINE_UNAVAILABLE",
    });
  });

  it("never lets a caller supply the vendor path through a request", async () => {
    // The vendor root is a composition-time argument of the loader, never a request field.
    const source = await readFile("src/adapters/openfilm/openfilm-upstream.ts", "utf8");
    expect(source).not.toMatch(/request\.|req\.|body\./u);
    expect(source).toContain("createPinnedOpenFilmUpstream(vendorRoot: string)");
    // No shell, no process spawning with caller-controlled arguments.
    expect(source).not.toMatch(/\bexecSync\b|\bspawnSync\b|child_process"\)\s*;?\s*$/mu);
    expect(source).not.toMatch(/shell:\s*true/);
    // The only subprocess is a fixed-argv git status with no caller-supplied argument.
    expect(source).toContain('run("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"]');
  });
});
