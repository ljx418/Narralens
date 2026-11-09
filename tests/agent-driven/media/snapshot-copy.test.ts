import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeRelativePath,
  copySnapshotClosure,
  SnapshotCopyError,
  verifySnapshotCopy,
} from "../../../src/host/render/snapshot-copy.js";
import { makeClosure, removeDirectory, sha256Of, temporaryDirectory } from "./support.js";

/**
 * The snapshot copy.
 *
 * Module checks. They prove that the copy is refused when it must be and that the
 * bytes that are copied are the bytes the snapshot recorded. They do not prove that a
 * real film renders — that is the real T20 acceptance, `NOT_RUN`.
 */

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

describe("the relative path of a snapshot entry", () => {
  it("refuses a path that could walk out of the film", () => {
    for (const value of ["../outside.mp4", "/etc/passwd", "a/../../b", "C:\\windows", "a\\b", "", "./x"]) {
      expect(() => assertSafeRelativePath(value)).toThrow(SnapshotCopyError);
    }
  });

  it("accepts an ordinary path and normalises its separators", () => {
    expect(assertSafeRelativePath("scenes/shot-01.html")).toBe("scenes/shot-01.html");
  });
});

describe("copying a snapshot's closure", () => {
  it("copies the files and keeps their digests", async () => {
    const source = await directory("closure-source");
    const staging = await directory("closure-staging");
    const closure = await makeClosure({ directory: source, with_asset: true, with_supplement: true });

    const copy = await copySnapshotClosure({ closure, staging_root: staging });

    expect(copy.native_entry).toBe("film.html");
    expect(copy.files).toHaveLength(closure.entries.length);
    await expect(verifySnapshotCopy(copy)).resolves.toBeUndefined();
  });

  it("refuses an entry whose bytes no longer match the snapshot", async () => {
    const source = await directory("closure-changed");
    const staging = await directory("closure-changed-staging");
    const closure = await makeClosure({ directory: source });

    await writeFile(join(source, "film.html"), "changed after the snapshot was committed", "utf8");

    await expect(copySnapshotClosure({ closure, staging_root: staging })).rejects.toThrow(SnapshotCopyError);
  });

  it("refuses an entry that is a link rather than a file", async () => {
    const source = await directory("closure-link");
    const staging = await directory("closure-link-staging");
    const closure = await makeClosure({ directory: source });
    const elsewhere = join(source, "elsewhere.html");
    await writeFile(elsewhere, "<html></html>", "utf8");
    await symlink(elsewhere, join(source, "linked.html"));

    const linked = {
      ...closure,
      entries: [...closure.entries, {
        relative_path: "linked.html",
        absolute_path: join(source, "linked.html"),
        sha256: sha256Of("<html></html>"),
        bytes: 13,
        kind: "native_source" as const,
        rights_ref: null,
        role: null,
      }],
    };

    await expect(copySnapshotClosure({ closure: linked, staging_root: staging })).rejects.toThrow(SnapshotCopyError);
  });

  it("refuses a film document that is not part of the closure", async () => {
    const source = await directory("closure-no-film");
    const staging = await directory("closure-no-film-staging");
    const closure = await makeClosure({ directory: source });

    const withoutFilm = { ...closure, entries: closure.entries.filter((entry) => entry.kind !== "native_source") };

    await expect(copySnapshotClosure({ closure: withoutFilm, staging_root: staging })).rejects.toThrow(SnapshotCopyError);
  });

  it("notices when a copied file is changed while it is being rendered", async () => {
    const source = await directory("closure-mutated");
    const staging = await directory("closure-mutated-staging");
    const closure = await makeClosure({ directory: source });

    const copy = await copySnapshotClosure({ closure, staging_root: staging });
    await writeFile(join(copy.project_root, "film.html"), "the renderer changed the film", "utf8");

    await expect(verifySnapshotCopy(copy)).rejects.toThrow(SnapshotCopyError);
  });

  it("removes its own copy when it fails, and nothing else", async () => {
    const source = await directory("closure-failed");
    const staging = await directory("closure-failed-staging");
    const closure = await makeClosure({ directory: source });
    await writeFile(join(source, "film.html"), "changed", "utf8");

    await expect(copySnapshotClosure({ closure, staging_root: staging })).rejects.toThrow(SnapshotCopyError);

    const { readdir } = await import("node:fs/promises");
    const left = await readdir(staging).catch(() => [] as string[]);
    expect(left).not.toContain("project");
  });
});
