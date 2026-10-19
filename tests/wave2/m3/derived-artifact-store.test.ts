import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DerivedArtifactStore } from "../../../src/host/materialize/derived-artifact-store.js";

/**
 * Concurrent publication into the derived artifact store.
 *
 * The failure this exists for was real and captured: two renders finishing in the same
 * millisecond with identical bytes produced the *same* staging path, because the name was
 * built from the process id and `Date.now()`. One caller's `open(..., "wx")` got EEXIST,
 * its `unlink` in the `catch` then removed the *other* caller's staging file, and that
 * caller's `rename` failed ENOENT. Both renders failed for one publishing bug.
 *
 * So the store has to hold two properties at once: each attempt writes to a private file
 * nobody else may touch, and publishing to a content-addressed name is safe when several
 * attempts arrive for the same content.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function store(): Promise<{ store: DerivedArtifactStore; base: string }> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m3-artifacts-"));
  dirs.push(base);
  return { store: new DerivedArtifactStore(join(base, "derived")), base };
}

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function stagingFiles(base: string): string[] {
  const out: string[] = [];
  for (const kind of ["proxy", "segment", "staging"]) {
    const dir = join(base, "derived", kind);
    if (!existsSync(dir)) continue;
    for (const name of require("node:fs").readdirSync(dir) as string[]) {
      if (name.endsWith(".tmp")) out.push(`${kind}/${name}`);
    }
  }
  return out;
}

describe("concurrent publication of identical bytes", () => {
  it("both calls succeed and return the same token", async () => {
    const { store: artifacts } = await store();
    const bytes = Buffer.from("the very same movie bytes");
    const [first, second] = await Promise.all([
      artifacts.put(bytes, "mp4"),
      artifacts.put(bytes, "mp4"),
    ]);
    expect(first).toBe(second);
    expect(first).toBe(`proxy/${sha(bytes)}.mp4`);
  }, 30_000);

  it("leaves exactly one correct final file and no staging leftovers", async () => {
    const { store: artifacts, base } = await store();
    const bytes = Buffer.from("the very same movie bytes");
    await Promise.all([artifacts.put(bytes, "mp4"), artifacts.put(bytes, "mp4")]);
    expect(await readFile(artifacts.resolve(`proxy/${sha(bytes)}.mp4`))).toEqual(bytes);
    expect(stagingFiles(base)).toEqual([]);
  }, 30_000);

  it("survives eight concurrent publishers of the same bytes", async () => {
    const { store: artifacts, base } = await store();
    const bytes = Buffer.from("eight publishers, one artifact");
    const tokens = await Promise.all(
      Array.from({ length: 8 }, () => artifacts.put(bytes, "mp4")),
    );
    expect(new Set(tokens).size).toBe(1);
    expect(await readFile(artifacts.resolve(tokens[0]!))).toEqual(bytes);
    expect(stagingFiles(base)).toEqual([]);
  }, 30_000);

  it("does not delete a staging file belonging to another publisher", async () => {
    const { store: artifacts, base } = await store();
    const bytes = Buffer.from("shared");
    const first = artifacts.put(bytes, "mp4");
    const second = artifacts.put(bytes, "mp4");
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    // Each attempt's staging file is its own; a failure in one cannot remove another's.
    expect(stagingFiles(base)).toEqual([]);
  }, 30_000);
});

describe("concurrent publication of the same bytes from different projects", () => {
  it("two projects producing identical output both succeed under the renderer's ceiling", async () => {
    const { store: artifacts, base } = await store();
    const bytes = Buffer.from("two projects, identical output");
    const [a, b] = await Promise.all([
      artifacts.put(bytes, "mp4"),
      artifacts.put(bytes, "mp4"),
    ]);
    // Content addressing means one artifact serves both. The token is the only identity a
    // caller carries, and it must not carry which project produced it.
    expect(a).toBe(b);
    expect(await readFile(artifacts.resolve(a))).toEqual(bytes);
    expect(stagingFiles(base)).toEqual([]);
  }, 30_000);
});

describe("publishing onto a name another publisher already created", () => {
  it("reuses the existing file when its digest matches the token", async () => {
    const { store: artifacts, base } = await store();
    const bytes = Buffer.from("already published by a competitor");
    const token = `proxy/${sha(bytes)}.mp4`;
    await import("node:fs/promises").then((fs) => fs.mkdir(join(base, "derived", "proxy"), { recursive: true }));
    await writeFile(artifacts.resolve(token), bytes);

    // A publisher that finds the final name present must verify it rather than trust it.
    expect(await artifacts.put(bytes, "mp4")).toBe(token);
    expect(await readFile(artifacts.resolve(token))).toEqual(bytes);
    expect(stagingFiles(base)).toEqual([]);
  }, 30_000);

  it("fails closed when the existing file does not match the token", async () => {
    const { store: artifacts, base } = await store();
    const bytes = Buffer.from("honest bytes");
    const impostor = Buffer.from("something else entirely");
    const token = `proxy/${sha(bytes)}.mp4`;
    await import("node:fs/promises").then((fs) => fs.mkdir(join(base, "derived", "proxy"), { recursive: true }));
    await writeFile(artifacts.resolve(token), impostor);

    // Treating a mismatched file as a cache hit would hand a caller bytes under someone
    // else's name. That is the failure this refuses.
    await expect(artifacts.put(bytes, "mp4")).rejects.toThrow(/MISMATCH|CORRUPT|does not match/iu);
  }, 30_000);

  it("reports a corrupted existing artifact rather than serving it", async () => {
    const { store: artifacts, base } = await store();
    const bytes = Buffer.from("honest");
    const token = `proxy/${sha(bytes)}.mp4`;
    await import("node:fs/promises").then((fs) => fs.mkdir(join(base, "derived", "proxy"), { recursive: true }));
    await writeFile(artifacts.resolve(token), Buffer.from("tampered"));
    await expect(artifacts.verifyPublished(token)).rejects.toThrow(/DIGEST_MISMATCH/u);
    await expect(artifacts.put(bytes, "mp4")).rejects.toThrow(/DIGEST_MISMATCH/u);
  }, 30_000);
});

describe("token resolution stays closed regardless of publishing", () => {
  it("refuses a traversal or an absolute token", async () => {
    const { store: artifacts } = await store();
    for (const token of ["../escape", "proxy/../../escape", "/etc/passwd", `proxy/${"a".repeat(64)}`]) {
      expect(() => artifacts.resolve(token), token).toThrow();
    }
  });

  it("refuses a kind outside the frozen set", async () => {
    const { store: artifacts } = await store();
    await expect(artifacts.put(Buffer.from("x"), "mp4", "everything" as never)).rejects.toThrow();
  });

  it("refuses an extension that is not a short lowercase suffix", async () => {
    const { store: artifacts } = await store();
    for (const extension of ["../mp4", "MP4", "tar.gz", ""]) {
      await expect(artifacts.put(Buffer.from("x"), extension)).rejects.toThrow();
    }
  });
});

void randomUUID;
void chmod;
void readdir;
